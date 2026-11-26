// What the homepage shows, worked out in one place.
//
// Every rule here is the rule the old homepage (src/components/Sections.jsx,
// since removed) already followed — the owner's saved banners first, her
// Bestseller picks,
// stocked categories only, sold-out designs left out — moved into hooks so the
// homepage (HomeModern) reads the same data, the same way, as before.
//
// No new reads on the way in: products, categories, ratings and banners are
// the reads the page already starts in its first milliseconds
// (src/boot/earlyStart.js). The one extra read — a handful of published
// reviews for the reviews row — waits until that row is about to scroll into
// view (`usePublishedQuotes`), so it never competes with the first screen.
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProducts } from '../../context/ProductsContext'
import { useCategories } from '../../context/CategoriesContext'
import { fetchBestsellers, resolveBestsellers } from '../../lib/bestsellers'
import { derivedBestsellers } from '../../lib/bestsellerRules'
import { extraCategoryTiles, stockedCategoryTiles } from '../../lib/categoryTiles'
import { productColours } from '../../lib/productSearch'

/**
 * The Bestsellers row: the owner's picks from Admin → Bestsellers once she
 * has saved any, otherwise four real catalogue styles chosen by
 * src/lib/bestsellerRules.js. Sold-out designs leave the row; if every pick is
 * sold out the row falls back to what is in stock (same rule as before).
 */
export function useBestsellers() {
  const { products: everything, listable: products, loading, source } = useProducts()
  const { categories } = useCategories()
  const catKeys = useMemo(() => categories.map((c) => c.key), [categories])
  const [picks, setPicks] = useState([])
  useEffect(() => {
    let alive = true
    fetchBestsellers()
      .then((rows) => { if (alive) setPicks(rows) })
      .catch(() => { if (alive) setPicks([]) })
    return () => { alive = false }
  }, [])
  const derived = useMemo(() => derivedBestsellers(products, catKeys), [products, catKeys])
  const chosen = useMemo(() => resolveBestsellers(picks, products), [picks, products])
  const ownerHasChosen = Array.isArray(picks) && picks.length > 0
  const picksAllSoldOut = useMemo(
    () => ownerHasChosen && !chosen.length && resolveBestsellers(picks, everything).length > 0,
    [ownerHasChosen, chosen, picks, everything],
  )
  const items = ownerHasChosen && !picksAllSoldOut ? chosen : derived
  return { items, loading: loading && source !== 'database', ownerHasChosen }
}

/**
 * The newest designs. The catalogue arrives newest first
 * (`order=created_at.desc`) and grouping keeps that order, so the first cards
 * of the listable catalogue ARE the latest arrivals. Designs already in the
 * Bestsellers row are skipped, so the two rows never repeat a card.
 */
export function useNewArrivals(count, exclude = []) {
  const { listable, loading, source } = useProducts()
  const excludeKey = exclude.map((p) => p?.design_id || p?.id).join('|')
  const skip = useMemo(() => new Set(excludeKey.split('|')), [excludeKey])
  const items = useMemo(
    () => listable.filter((p) => !skip.has(p.design_id || p.id)).slice(0, count),
    [listable, skip, count],
  )
  return { items, loading: loading && source !== 'database' }
}

/**
 * The category tiles, with how many styles each one has in stock — the same
 * tiles, photos and links as the old "Shop by Category" row and the
 * Collections page (src/lib/categoryTiles.js). Until the real catalogue and
 * categories have answered, `ready` is false and tiles keep their place
 * without a photo (the bundled photos used to download and be thrown away).
 */
export function useCategoryTiles() {
  const { listable, answered } = useProducts()
  const { categories, loading } = useCategories()
  const tiles = useMemo(() => {
    const counts = new Map()
    for (const p of listable) counts.set(p.type, (counts.get(p.type) || 0) + 1)
    return [...stockedCategoryTiles(categories, listable), ...extraCategoryTiles(categories, listable)]
      .map((t) => ({ ...t, count: counts.get(t.key) || 0 }))
  }, [categories, listable])
  return { tiles, ready: answered && !loading }
}

// Colour families for "Shop by colour". `q` is what the shop's search is
// asked for: a colour word the search treats as a COLOUR filter
// (src/lib/productSearch.js COLOUR_WORDS), which matches saved colours by
// substring — "pink" finds Bright Pink, Onion pink and Babypink. The count
// below uses the very same substring rule, so the number of styles behind a
// swatch is the number the shop shows. The swatch is a muted tone that sits
// with the cocoa/rose palette rather than a pure screen colour.
const FAMILIES = [
  { q: 'black', label: 'Black', hex: '#2B2522' },
  { q: 'white', label: 'White', hex: '#F7F2EC' },
  { q: 'pink', label: 'Pink', hex: '#E3A3AE' },
  { q: 'blue', label: 'Blue', hex: '#5D7FB0' },
  { q: 'green', label: 'Green', hex: '#7E8F5C' },
  { q: 'brown', label: 'Brown', hex: '#7A4E3A' },
  { q: 'yellow', label: 'Yellow', hex: '#E0BE57' },
  { q: 'red', label: 'Red', hex: '#B23B3B' },
  { q: 'orange', label: 'Orange', hex: '#D9793D' },
  { q: 'grey', label: 'Grey', hex: '#9C9792' },
  { q: 'beige', label: 'Beige', hex: '#D9C4A6' },
  { q: 'lavender', label: 'Lavender', hex: '#B8A7D4' },
  { q: 'maroon', label: 'Maroon', hex: '#6D2A34' },
]
const squash = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * The colours the shop actually has in stock right now, most styles first.
 * A family shows only when at least `min` designs come in it, so a swatch can
 * never open an empty search.
 */
export function useColourFamilies(min = 2) {
  const { listable } = useProducts()
  return useMemo(() => {
    const counts = new Map()
    for (const p of listable) {
      const seen = new Set()
      for (const c of productColours(p)) {
        const name = squash(c)
        for (const f of FAMILIES) if (name.includes(f.q)) seen.add(f.q)
      }
      for (const q of seen) counts.set(q, (counts.get(q) || 0) + 1)
    }
    return FAMILIES
      .map((f) => ({ ...f, count: counts.get(f.q) || 0 }))
      .filter((f) => f.count >= min)
      .sort((a, b) => b.count - a.count)
  }, [listable, min])
}

/** The lowest price in stock, for "from ₹…" lines. Null until priced products exist. */
export function useLowestPrice() {
  const { listable } = useProducts()
  return useMemo(() => {
    const prices = listable.map((p) => p.price).filter((n) => n > 0)
    return prices.length ? Math.min(...prices) : null
  }, [listable])
}

// A review is a good homepage quote when it is 5 stars, written in English
// letters (the row is read at a glance), long enough to say something and
// short enough to read in one look.
const QUOTE_MIN = 60
const QUOTE_MAX = 220
const latin = (s) => {
  const t = String(s || '')
  if (!t) return false
  const letters = t.replace(/[^\p{L}]/gu, '')
  if (!letters) return false
  return letters.replace(/[^A-Za-z]/g, '').length / letters.length > 0.9
}
// Hindi written in English letters ("bahut accha hai") passes the test above;
// these everyday words catch it, so the row reads as English throughout.
const HINGLISH = /\b(hai|hain|bahut|bohot|ka|ke|ki|kya|accha|acha|achha|bhi|mein|nahi|nahin|liye|ekdum|kaafi|bilkul|sundar|wala|wali|kapda|kapde|mast|paisa|vasool|vasul|ekdam|lagta|lagti|karo|tha|thi)\b/i
const english = (s) => latin(s) && !HINGLISH.test(String(s || ''))

/**
 * Published reviews for the homepage's reviews row, read only when that row
 * is about to come on screen (`ref` is the row's element). Each quote carries
 * the exact product row it was written for, so the photo and link beside it
 * are that product — a review whose product has since been hidden or deleted
 * is dropped. One design is quoted at most once. Until the read answers (or
 * if it fails), `quotes` is empty and the row shows its placeholders.
 */
export function usePublishedQuotes(ref, count = 8) {
  const { getProduct, getVariant, answered } = useProducts()
  const [rows, setRows] = useState(null)
  const started = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el || started.current) return undefined
    const start = () => {
      if (started.current) return
      started.current = true
      supabase
        .from('product_reviews')
        .select('id, product_id, rating, title, body, customer_name, reviewer_city, size_bought, created_at, verified')
        .eq('status', 'approved')
        .eq('rating', 5)
        .order('created_at', { ascending: false })
        .limit(60)
        .then(({ data }) => setRows(Array.isArray(data) ? data : []), () => setRows([]))
    }
    if (typeof IntersectionObserver === 'undefined') { start(); return undefined }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { start(); io.disconnect() }
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])

  const quotes = useMemo(() => {
    if (!rows || !answered) return []
    const out = []
    const designs = new Set()
    for (const r of rows) {
      const body = String(r.body || '').trim()
      if (body.length < QUOTE_MIN || body.length > QUOTE_MAX || !english(body)) continue
      const product = getVariant(r.product_id) || getProduct(r.product_id)
      if (!product) continue
      const design = getProduct(r.product_id)
      const key = design?.design_id || design?.id || product.id
      if (designs.has(key)) continue
      designs.add(key)
      // A title in another language is left off; the words below it are English.
      const title = english(r.title) ? String(r.title).trim() : ''
      out.push({ ...r, title, body, product, design })
      if (out.length >= count) break
    }
    return out
  }, [rows, answered, getProduct, getVariant, count])
  return { quotes, loaded: rows !== null }
}
