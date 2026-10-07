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
// A row qualifies when it is one of the three categories, a women's item, and
// carries no photo from a retired host. NOTE the negation sits inside `every`,
// not outside it: `!every(x => !bad(x))` inverts the test and would instead
// keep *only* the retired demo rows — dropping every real product and leaving
// the storefront on the bundled catalogue forever.
const isClientProduct = (r) =>
  VALID_TYPES.has(r.type) &&
  (r.gender === null || r.gender === undefined || r.gender === 'women') &&
  [r.image, r.hover, ...(Array.isArray(r.gallery) ? r.gallery : [])]
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

// ---- colour grouping ------------------------------------------------------
// The client shoots one row per colour ("Stripes Dress - Blue", "… - Brown"),
// but a design is ONE product: the shop must show a single card and let the
// colour be chosen on the product page. Grouping is driven entirely by the
// data — the title has to end in a colour word this catalogue actually uses
// AND the rows have to share a type — so two unrelated products that merely
// look alike can never be merged, and nothing is invented.
//
// Only these words appear in the client's own titles. Adding a colour that
// isn't in the catalogue would risk grouping names that aren't colours.
const COLOUR_WORDS = new Set([
  'Babypink', 'Beige', 'Black', 'Blue', 'Brown', 'Grey', 'Maroon',
  'Neon Green', 'Olive Green', 'Orange', 'Pink', 'Purple', 'Red',
  'Royalblue', 'Sky Blue', 'White', 'Yellow',
])

// "Stripes Dress - Pink" -> { name: 'Stripes Dress', colour: 'Pink' }.
// Anything without a real colour suffix returns null and is never grouped.
const splitColour = (title) => {
  const at = title.lastIndexOf(' - ')
  if (at < 0) return null
  const colour = title.slice(at + 3).trim()
  if (!COLOUR_WORDS.has(colour)) return null
  return { name: title.slice(0, at).trim(), colour }
}

// Rows -> one entry per design, in catalogue order. The first row of a design
// becomes the card and keeps its own id, image and gallery (so the card shows
// the first colour), while every colour row is kept verbatim under `colors`.
// A design with a single row is left exactly as it was — including the colour
// in its title, which would otherwise be thrown away with no swatch to show it.
const groupColours = (rows) => {
  const buckets = new Map()
  rows.forEach((row) => {
    const parts = splitColour(row.title)
    // A row with no colour suffix gets a key only it can hold, so it is never
    // pooled with anything else.
    const key = parts ? `${row.type}\u0000${parts.name}` : `\u0000${row.id}`
    if (!buckets.has(key)) buckets.set(key, { parts, rows: [] })
    buckets.get(key).rows.push(row)
  })

  const out = []
  for (const { parts, rows: group } of buckets.values()) {
    const lead = group[0]
    if (!parts || group.length < 2) { out.push(lead); continue }
    out.push({
      ...lead,
      title: parts.name,
      colors: group.map((r) => ({ ...r, color: splitColour(r.title).colour })),
    })
  }
  return out
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

  // One card per design: colour rows collapse into their product here, once,
  // so the shop, search, wishlist, related lists and homepage all agree. Only
  // *visible* rows take part — a hidden colour is simply not offered.
  const products = useMemo(() => groupColours(all.filter((p) => p.is_active)), [all])
  // The storefront only ever resolves *visible* products, regardless of who is
  // signed in — hidden items live exclusively in the dashboard.
  //
  // Resolved through a Map rebuilt only when the catalogue changes: the same
  // lookup runs once per cart line, per related-products list and per review on
  // every render, so a linear scan would grow with the table. `first wins`
  // preserves the previous `Array.find` answer if an id were ever repeated.
  //
  // Colour rows resolve to their design too, so an old cart line, wishlist
  // heart, order or shared link naming "stripes-dress-pink" still opens the
  // Stripes Dress — on that colour.
  const activeById = useMemo(() => {
    const index = new Map()
    for (const p of products) {
      if (!index.has(p.id)) index.set(p.id, p)
      for (const c of p.colors || []) if (!index.has(c.id)) index.set(c.id, p)
    }
    return index
  }, [products])
  const getProduct = useCallback((id) => activeById.get(id) || null, [activeById])

  // Memoised so a consumer only re-renders when one of these actually changes.
  const value = useMemo(
    () => ({ products, all, getProduct, reload, loading, error, source }),
    [products, all, getProduct, reload, loading, error, source],
  )

  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  )
}
