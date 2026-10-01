import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { products as seedProducts, TYPES } from '../data/products'

const Ctx = createContext(null)
export const useProducts = () => useContext(Ctx)

// This store sells the client's women's catalogue in three categories and
// nothing else. Anything else that reaches the `products` table — leftovers of
// the retired demo catalogue, men's rows, stock photography — is dropped here,
// once, before it can reach a card, a filter, search, a related-products list
// or the dashboard. Photo hosts used by that retired catalogue are rejected
// too, so an old row can never render an outside image.
const VALID_TYPES = new Set(TYPES.map((t) => t.key))
const OUTSIDE_PHOTO = /unsplash\.com|placehold|placeholder|picsum|loremflickr|pexels\.com|shutterstock|gettyimages/i
const isClientProduct = (r) =>
  VALID_TYPES.has(r.type) &&
  (r.gender === null || r.gender === undefined || r.gender === 'women') &&
  ![r.image, r.hover, ...(Array.isArray(r.gallery) ? r.gallery : [])]
    .filter(Boolean)
    .every((src) => !OUTSIDE_PHOTO.test(String(src)))

// Database row -> the exact shape the storefront already consumes
// (see src/data/products.js; `description` maps to the legacy `desc`).
// `gallery` holds every photo of the product; rows written before that column
// existed fall back to just main + hover.
const shots = (r) => [...new Set([
  ...(Array.isArray(r.gallery) ? r.gallery : []),
  r.image,
  r.hover,
].filter(Boolean))]

const toProduct = (r) => {
  const gallery = shots(r)
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    price: Number(r.price) || 0,
    compare: r.compare === null || r.compare === undefined ? null : Number(r.compare),
    rating: Number(r.rating) || 0,
    reviews: Number(r.reviews) || 0,
    image: r.image || gallery[0] || null,
    hover: r.hover || r.image || gallery[0] || null,
    gallery,
    badge: r.badge,
    sizes: Array.isArray(r.sizes) && r.sizes.length ? r.sizes : ['S', 'M', 'L', 'XL'],
    desc: r.description || '',
    is_active: r.is_active !== false,
  }
}

const seed = seedProducts.map((p) => ({ ...p, is_active: true }))

export function ProductsProvider({ children }) {
  const [all, setAll] = useState(seed)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [source, setSource] = useState('seed')

  const reload = useCallback(async () => {
    // A watchdog so the grid can never sit on its skeletons: if the request
    // stalls (offline, blocked host) the bundled catalogue renders anyway and
    // the request keeps running — it will simply overwrite the state if it
    // eventually lands.
    const watchdog = setTimeout(() => setLoading(false), 8000)
    try {
      // One attempt only: supabase-js otherwise retries a dead endpoint for
      // ~8s (1s/2s/4s backoff), which would leave the grid on its skeletons
      // through an outage. Falling back immediately is safe — the bundled
      // catalogue is this same client catalogue.
      const { data, error } = await supabase
        .from('products').select('*')
        .order('created_at', { ascending: true })
        .retry(false)
      if (error) {
        // Keep the bundled catalogue so the storefront never breaks.
        setError(error.message); setSource('seed')
      } else {
        const rows = (data || []).filter(isClientProduct)
        // If the table holds nothing but retired demo rows (or nothing at all)
        // the real catalogue has not been seeded yet, so serve the bundled one:
        // the site must never show anything but the client's own products.
        setAll(rows.length ? rows.map(toProduct) : seed)
        setError(null)
        setSource(rows.length ? 'database' : 'seed')
      }
    } catch (e) {
      setError(e?.message || 'Unavailable'); setSource('seed')
    } finally {
      clearTimeout(watchdog)
      setLoading(false)
    }
    return true
  }, [])

  // First fetch must happen *after* the Supabase session is restored — otherwise
  // an admin loading /admin straight would receive the anonymous, hidden-filtered
  // view and never see unpublished rows. Re-fetch on sign-in/out too, so the
  // visible set always matches the caller's permissions.
  //
  // That probe can stall when Supabase is unreachable (it retries token
  // refreshes), which would leave the storefront on its skeletons, so it is
  // raced against a short timeout: the catalogue is fetched either way, and a
  // late session re-fetches once so the admin view is still correct.
  useEffect(() => {
    let alive = true
    let fired = false
    const kick = async () => {
      if (fired) return
      fired = true
      await reload()
    }
    const timer = setTimeout(kick, 600)
    supabase.auth.getSession()
      .then(({ data }) => {
        clearTimeout(timer)
        if (!fired) kick()
        // A signed-in admin must re-read the table after the probe: only their
        // view includes unpublished rows, so the anonymous answer above is not
        // the one they should keep.
        else if (data?.session && alive) reload()
      })
      .catch(() => { clearTimeout(timer); if (!fired) kick() })
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') reload()
    })
    return () => { alive = false; clearTimeout(timer); sub.subscription.unsubscribe() }
  }, [reload])

  // Live updates: edit something in the dashboard and any open storefront
  // tab refreshes itself. Silently a no-op if realtime is unavailable.
  useEffect(() => {
    let channel
    try {
      channel = supabase
        .channel('products-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => { reload() })
        .subscribe()
    } catch { /* realtime optional */ }
    return () => { if (channel) { try { supabase.removeChannel(channel) } catch { /* noop */ } } }
  }, [reload])

  const products = useMemo(() => all.filter((p) => p.is_active), [all])
  // The storefront only ever resolves *visible* products, regardless of who is
  // signed in — hidden items live exclusively in the dashboard.
  const getProduct = useCallback((id) => all.find((p) => p.id === id && p.is_active) || null, [all])

  return (
    <Ctx.Provider value={{ products, all, getProduct, reload, loading, error, source }}>
      {children}
    </Ctx.Provider>
  )
}
