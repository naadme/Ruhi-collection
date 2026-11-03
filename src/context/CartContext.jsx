import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useProducts } from './ProductsContext'
import { useCategories } from './CategoriesContext'
import { totalFor } from '../lib/pricing'
import { MAX_QTY } from '../lib/checkout'
import { newEventId, trackEcommerce } from '../lib/tracking'
import { cartEvent, cartLineItem } from '../lib/trackingItems'

/**
 * Restore a persisted array, never anything else.
 *
 * `JSON.parse` succeeds on `"{}"`, `"\"x\""` and `"7"` — none of which are
 * arrays — and the old `|| []` passed them straight through, so a partial
 * write or a hand-edited key reached `.find` / `.filter` / `.map` and took the
 * basket down on the very first render. Anything that is not an array reads as
 * empty, which is recoverable; cart lines must also be objects that actually
 * carry an id, because a line with no id can never resolve to a product.
 */
const readStoredArray = (key, requireId = false) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key))
    if (!Array.isArray(parsed)) return []
    if (!requireId) return parsed
    return parsed.filter((line) => line && typeof line === 'object' && line.id != null && line.id !== '')
  } catch {
    return []
  }
}
const Ctx = createContext(null)
export const useCart = () => useContext(Ctx)

/**
 * One stored line → the line the basket, the drawer and checkout show, or
 * null when its product no longer resolves.
 */
const resolveLine = (i, getProduct, getRow) => {
  const product = getProduct(i.id)
  if (!product) return null
  // The line can name a colour row of a grouped design. Resolve it so the
  // basket, drawer and checkout all show that colour's name and photo —
  // `color` covers lines saved before this existed, the lookup covers any
  // line saved without it.
  const variant = (product.colors || []).find((c) => c.id === i.id)
  const color = i.color || (variant ? variant.color : undefined)
  // Price the line from the exact catalogue row in the cart — the same row
  // `create_order()` reads server-side. The grouped card carries one
  // colour's price and must never be charged for another.
  const row = getRow(i.id)
  const price = Number(row ? row.price : product.price) || 0
  return { ...i, color, price, image: (variant && variant.image) || product.image, product, row }
}

export function CartProvider({ children }) {
  const { getProduct, getRow, loading, answered, source } = useProducts()
  const { typeLabel } = useCategories()
  const [items, setItems] = useState(() => readStoredArray('cart', true))
  const [open, setOpen] = useState(false)
  useEffect(() => localStorage.setItem('cart', JSON.stringify(items)), [items])

  // The basket as of the last change, read synchronously. GTM's add_to_cart
  // and remove_from_cart describe only the units that actually moved, and a
  // second click landing before React re-renders must count from the first
  // click's result, not from the screen.
  const latest = useRef(items)
  const commit = useCallback((next) => { latest.current = next; setItems(next) }, [])

  // The catalogue as of the last render, for describing a line to GTM from
  // inside the stable callbacks below.
  const catalogue = useRef(null)
  catalogue.current = { getProduct, getRow, typeLabel }

  // add_to_cart / remove_from_cart (tracking brief, Annexure A4 and A5), sent
  // once the basket has changed — never for a click that changed nothing.
  // Emptying the basket after a purchase and pruning lines the shop no longer
  // sells are not the shopper's doing, so `clear` and `prune` send nothing.
  const track = useCallback((event, moved) => {
    const { getProduct: product, getRow: row, typeLabel: label } = catalogue.current
    const described = moved.map(({ line, units }) => {
      const shown = resolveLine(line, product, row)
      return shown && cartLineItem(shown, { category: label(shown.row?.type || shown.product.type), quantity: units })
    })
    const message = cartEvent(event, described, { eventId: newEventId() })
    if (message) trackEcommerce(message)
  }, [])

  // `color` is the colour chosen on the product page. Lines stay keyed by
  // id + size: a grouped design's colour rows keep their own ids, so two
  // colours are already two distinct lines.
  // `openDrawer: false` is for "Buy it now", which goes straight to checkout:
  // the drawer would only cover the page it is heading to.
  const add = useCallback((id, qty = 1, size = 'M', color, { openDrawer = true } = {}) => {
    const wanted = Math.min(MAX_QTY, Math.max(1, qty))
    const c = latest.current
    const k = c.find((i) => i.id === id && i.size === size)
    // Clamp the *sum*, not just the increment: a line already at 10 must not
    // be pushed to 11 by adding one more.
    const line = k
      ? { ...k, qty: Math.min(MAX_QTY, k.qty + wanted) }
      : { id, qty: wanted, size, ...(color ? { color } : {}) }
    commit(k ? c.map((i) => (i === k ? line : i)) : [...c, line])
    if (openDrawer) setOpen(true)
    const units = line.qty - (k ? k.qty : 0)
    if (units > 0) track('add_to_cart', [{ line, units }])
  }, [commit, track])
  const setQty = useCallback((id, size, qty) => {
    const c = latest.current
    const k = c.find((i) => i.id === id && i.size === size)
    if (!k) return
    const line = { ...k, qty: Math.min(MAX_QTY, Math.max(1, qty)) }
    commit(c.map((i) => (i === k ? line : i)))
    if (line.qty > k.qty) track('add_to_cart', [{ line, units: line.qty - k.qty }])
    if (line.qty < k.qty) track('remove_from_cart', [{ line, units: k.qty - line.qty }])
  }, [commit, track])
  const remove = useCallback((id, size) => {
    const c = latest.current
    const gone = c.filter((i) => i.id === id && i.size === size)
    if (!gone.length) return
    commit(c.filter((i) => !(i.id === id && i.size === size)))
    track('remove_from_cart', gone.map((line) => ({ line, units: line.qty })))
  }, [commit, track])
  // The shopper's own "Empty the cart": every line is removed, so every line
  // goes into one remove_from_cart.
  const empty = useCallback(() => {
    const gone = latest.current
    if (!gone.length) return
    commit([])
    track('remove_from_cart', gone.map((line) => ({ line, units: line.qty })))
  }, [commit, track])
  const clear = useCallback(() => commit([]), [commit])
  // Drop lines whose product no longer resolves (deleted or hidden by the
  // owner). Kept separate from `lines` so the UI can warn before pruning.
  //
  // It must never run against the *bundled seed*. On a hard refresh of
  // /checkout the first commit still holds `seed`, so every line the seed does
  // not contain — i.e. any product created in the dashboard after launch —
  // would be filtered out and immediately written back to localStorage, emptying
  // a full basket at the moment of purchase intent, silently. `loading` alone is
  // not enough — the 8 s watchdog clears it while the seed is still showing —
  // so this waits for the database itself to have answered.
  const prune = useCallback(() => {
    if (loading || !answered || source !== 'database') return
    const kept = latest.current.filter((i) => !!getProduct(i.id))
    if (kept.length !== latest.current.length) commit(kept)
  }, [getProduct, loading, answered, source, commit])
  // Derived in one pass and memoised: the basket view, the header badge and the
  // checkout summary all read these, and they must not be rebuilt on renders
  // that only touch `open`.
  const { lines, unavailable, count, subtotal } = useMemo(() => {
    const built = []
    let missing = 0
    let qty = 0
    let sub = 0
    for (const i of items) {
      const line = resolveLine(i, getProduct, getRow)
      if (!line) { missing += 1; continue }
      built.push(line)
      qty += i.qty
      sub += i.qty * line.price
    }
    return { lines: built, unavailable: missing, count: qty, subtotal: sub }
  }, [items, getProduct, getRow])
  const total = useMemo(() => totalFor(subtotal), [subtotal])
  // Every line as GTM's `items` describe it (view_cart, begin_checkout and the
  // checkout steps). A line the catalogue cannot name yet is left out.
  const trackedItems = useMemo(
    () => lines.map((l) => cartLineItem(l, { category: typeLabel(l.row?.type || l.product.type) })).filter(Boolean),
    [lines, typeLabel],
  )
  const value = useMemo(
    () => ({ lines, trackedItems, unavailable, prune, clear, empty, count, subtotal, total, add, setQty, remove, open, setOpen }),
    [lines, trackedItems, unavailable, prune, clear, empty, count, subtotal, total, add, setQty, remove, open],
  )
  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  )
}
