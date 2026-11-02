import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { clearVisitor, detailsFromOrders, newEventId, pageEntry, pageKey, pageShown, pushToDataLayer } from '../lib/tracking'

// How long the first page view of a signed-in visit waits for their orders
// before going out with what the session alone knows. A late answer is still
// pushed as soon as it arrives.
const DETAILS_TIMEOUT_MS = 1500

const ORDER_COLUMNS = 'full_name, phone, city, state, pincode, payment_status, payment_method, status, created_at'

/**
 * Pushes the brief's page entry (Section 2) into the GTM data layer on every
 * page of the site, admin included. Renders nothing.
 *
 * Mounted once in main.jsx, inside the router and the auth provider.
 */
export default function PageTracker() {
  const { pathname, search } = useLocation()
  const { ready, user } = useAuth()
  const userId = user?.id || null

  // A signed-in visitor's name, phone and address are only on their orders.
  const [lookup, setLookup] = useState({ userId: undefined, details: null, settled: false })

  useEffect(() => {
    if (!ready) return undefined
    if (!userId) {
      setLookup({ userId: null, details: null, settled: true })
      return undefined
    }
    let alive = true
    setLookup({ userId, details: detailsFromOrders([], user), settled: false })
    const settle = () => setLookup((s) => (s.userId === userId ? { ...s, settled: true } : s))
    const timer = setTimeout(() => { if (alive) settle() }, DETAILS_TIMEOUT_MS)
    supabase
      .from('orders')
      .select(ORDER_COLUMNS)
      // The filter is not optional: row-level security lets an admin read
      // EVERY order, and an admin browsing the shop must not be described
      // with a customer's details.
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (!alive) return
        clearTimeout(timer)
        if (error) { settle(); return }
        setLookup({ userId, details: detailsFromOrders(data || [], user), settled: true })
      }, () => { if (alive) { clearTimeout(timer); settle() } })
    return () => { alive = false; clearTimeout(timer) }
    // Keyed on the id: the session hands back a fresh user object on every
    // token refresh, and that is not a different visitor.
  }, [ready, userId])

  const key = pageKey(pathname, search)
  const settled = ready && lookup.userId === userId && lookup.settled
  const last = useRef({ key: null, userId: undefined, details: null })

  useEffect(() => {
    if (!settled) return undefined
    const prev = last.current
    const pageChanged = key !== prev.key
    if (!pageChanged && userId === prev.userId && lookup.details === prev.details) return undefined

    // Deferred by a tick so a page that immediately redirects (<Navigate>,
    // /catalog → /shop) is never counted, and StrictMode's double run in
    // development pushes once.
    const timer = setTimeout(() => {
      if (prev.userId && prev.userId !== userId) clearVisitor()
      // Same page, new details (a sign-in, a sign-out, orders arriving late):
      // update what GTM knows without counting another page view.
      const entry = pageEntry({ pathname, search, user, details: lookup.details, eventId: pageChanged ? newEventId() : undefined })
      if (!pageChanged) delete entry.event
      pushToDataLayer(entry)
      last.current = { key, userId, details: lookup.details }
      // The page's own events (src/lib/tracking.js) were waiting for this.
      pageShown(key)
    }, 0)
    return () => clearTimeout(timer)
  }, [settled, key, userId, lookup.details])

  return null
}
