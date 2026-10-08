import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
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
    // One card per design, but every colour stays its own Supabase row with
    // its own price. The card advertises a price the shopper really pays when
    // they tap it, so the *cheapest* colour row carries `price`/`compare` —
    // and hands over its `id`, which is the row the card opens on, the row
    // the cart adds and the row `create_order()` prices server-side. All three
    // therefore name the same row and can never disagree. When every colour
    // costs the same (the normal case) that row *is* the first one, so nothing
    // changes: same id, same price, same card as before.
    const priced = group.reduce(
      (best, r) => ((Number(r.price) || 0) < (Number(best.price) || 0) ? r : best),
      lead,
    )
    out.push({
      ...lead,
      id: priced.id,
      price: priced.price,
      compare: priced.compare,
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

  // Monotonic token for "who is allowed to write state". Every read takes the
  // next number; a row we have just verified in Supabase takes one too. Only
  // the newest holder may update React state, so a slow, older response can
  // never overwrite data that is already newer — that is what stops a stale
  // fetch (or a stale realtime patch) from rolling a saved product back.
  const seq = useRef(0)

  // True once Supabase has actually answered with this store's catalogue.
  // After that the bundled seed is *never* allowed to replace it: the seed is
  // a first-paint fallback for a database that has never spoken, not a second
  // source of truth.
  const fromDb = useRef(false)

  const reload = useCallback(async () => {
    // A watchdog so the grid can never sit on its skeletons: if the request
    // stalls (offline, blocked host) the bundled catalogue renders anyway and
    // the request keeps running — it will simply overwrite the state if it
    // eventually lands.
    const mine = ++seq.current
    const watchdog = setTimeout(() => { if (mine === seq.current) setLoading(false) }, 8000)
    try {
      // One attempt only: supabase-js otherwise retries a dead endpoint for
      // ~8s (1s/2s/4s backoff), which would leave the grid on its skeletons
      // through an outage. Falling back immediately is safe — the bundled
      // catalogue is this same client catalogue.
      const { data, error } = await supabase
        .from('products').select('*')
        .order('created_at', { ascending: true })
        .retry(false)
      if (mine !== seq.current) return true // a newer read or a verified row already won
      if (error) {
        // Keep whatever is already on screen. Falling back to the bundled
        // catalogue here would hide a product the database just saved.
        setError(error.message)
        if (!fromDb.current) setSource('seed')
      } else {
        const rows = (data || []).filter(isClientProduct)
        if (rows.length) {
          fromDb.current = true
          setAll(rows.map(toProduct))
          setSource('database')
        } else if (fromDb.current) {
          // Supabase answered and holds nothing this store can show (the rows
          // were retired, hidden or removed). The database is the source of
          // truth, so that emptiness is what the store shows — the bundled
          // seed must never resurrect products Supabase no longer returns.
          setAll([])
          setSource('database')
        } else {
          // Never spoken to: the real catalogue has not been seeded yet.
          setAll(seed)
          setSource('seed')
        }
        setError(null)
      }
    } catch (e) {
      if (mine === seq.current) setError(e?.message || 'Unavailable')
    } finally {
      clearTimeout(watchdog)
      if (mine === seq.current) setLoading(false)
    }
    return true
  }, [])

  // Install one row that Supabase has just confirmed (the `.select().single()`
  // answer of an admin write, or a realtime event's actual row). This — and
  // never a locally built value — is how the dashboard updates itself.
  const applyRow = useCallback((row) => {
    if (!row?.id) return
    // Anything still in flight predates this row and must not overwrite it.
    seq.current += 1
    setLoading(false)
    const keep = isClientProduct(row) ? toProduct(row) : null
    setAll((prev) => {
      const at = prev.findIndex((p) => p.id === row.id)
      if (!keep) return at < 0 ? prev : prev.filter((p) => p.id !== row.id)
      if (at < 0) return [...prev, keep]
      const next = [...prev]
      next[at] = keep
      return next
    })
    fromDb.current = true
    setSource('database')
    setError(null)
  }, [])

  const removeRow = useCallback((id) => {
    if (!id) return
    seq.current += 1
    setLoading(false)
    setAll((prev) => (prev.some((p) => p.id === id) ? prev.filter((p) => p.id !== id) : prev))
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
  // tab refreshes itself. The event carries the row Supabase actually stored,
  // so that row is what lands in React state — never a locally built value and
  // never the bundled seed. A delete drops the row; anything the payload
  // doesn't describe (or a subscription that can't carry payloads) simply
  // refetches, which is still Supabase. Silently a no-op if realtime is off.
  useEffect(() => {
    let channel
    try {
      channel = supabase
        .channel('products-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
          if (payload?.eventType === 'DELETE') removeRow(payload.old?.id)
          else if (payload?.new?.id) applyRow(payload.new)
          else reload()
        })
        .subscribe()
    } catch { /* realtime optional */ }
    return () => { if (channel) { try { supabase.removeChannel(channel) } catch { /* noop */ } } }
  }, [applyRow, removeRow, reload])

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

  // The *exact* catalogue row behind an id — the row Supabase holds and the
  // row `create_order()` prices from. Colour rows are distinct rows with
  // distinct prices, so anything that charges money (cart lines, checkout
  // summaries) reads this, never the grouped card's price.
  const rowsById = useMemo(() => new Map(all.map((r) => [r.id, r])), [all])
  const getRow = useCallback((id) => rowsById.get(id) || null, [rowsById])

  // Memoised so a consumer only re-renders when one of these actually changes.
  const value = useMemo(
    () => ({ products, all, getProduct, getRow, reload, applyRow, removeRow, loading, error, source }),
    [products, all, getProduct, getRow, reload, applyRow, removeRow, loading, error, source],
  )

  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  )
}
