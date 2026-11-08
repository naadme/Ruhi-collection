// Star ratings wherever a shopper decides: product cards, the product page's
// photo and title, next to the buy buttons, the phone buy bar, the cart and
// the checkout. Every number here is worked out from PUBLISHED reviews only
// (`product_reviews`, status 'approved' — the only rows the storefront can
// read). The numbers typed into the product editor (`products.rating`,
// `products.reviews`) are never shown: a rating on the site is what customers
// said.
//
// Pure: src/context/RatingsContext.jsx fetches the rows and hands them here.

/** product_id -> { sum, count } from rows of { product_id, rating }. */
export function ratingTotals(rows = []) {
  const totals = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const rating = Math.round(Number(r?.rating))
    if (!r?.product_id || !(rating >= 1 && rating <= 5)) continue
    const t = totals.get(r.product_id) || { sum: 0, count: 0 }
    t.sum += rating
    t.count += 1
    totals.set(r.product_id, t)
  }
  return totals
}

/** Every catalogue row a card or product stands for: its colours, else itself.
 *  A shopper reads a card as "this dress", whichever colour a reviewer bought. */
export function designIds(product) {
  const colours = Array.isArray(product?.colors) ? product.colors.map((c) => c?.id).filter(Boolean) : []
  const ids = colours.length ? colours : [product?.id].filter(Boolean)
  return [...new Set(ids)]
}

/** A design's { average, count }, or null when it has no published review —
 *  the caller then shows nothing rather than "0.0 (0)". */
export function designRating(totals, product) {
  if (!(totals instanceof Map)) return null
  let sum = 0
  let count = 0
  for (const id of designIds(product)) {
    const t = totals.get(id)
    if (t) { sum += t.sum; count += t.count }
  }
  return count ? { average: sum / count, count } : null
}

/** The whole shop's { average, count } across every published review. */
export function shopRating(totals) {
  if (!(totals instanceof Map)) return null
  let sum = 0
  let count = 0
  for (const t of totals.values()) { sum += t.sum; count += t.count }
  return count ? { average: sum / count, count } : null
}

/** "4.8" — one decimal, never above 5 or below 0. */
export const ratingText = (average) => Math.min(5, Math.max(0, Number(average) || 0)).toFixed(1)

/** "12 reviews" / "1 review". */
export const reviewCountText = (count) => {
  const n = Number(count) || 0
  return `${n.toLocaleString('en-IN')} review${n === 1 ? '' : 's'}`
}

/** "1.2k" for big counts, the way Indian shopping apps show them on a card. */
export const shortCount = (count) => {
  const n = Number(count) || 0
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`
}

/** What a screen reader hears for a rating. */
export const ratingAria = ({ average, count }) =>
  `Rated ${ratingText(average)} out of 5 from ${reviewCountText(count)}`

/** How much of each of the five stars is filled, 0–1, to the nearest tenth of
 *  a star: 4.8 is four full stars and one 80% star. */
export function starFills(average) {
  const v = Math.round(Math.min(5, Math.max(0, Number(average) || 0)) * 10) / 10
  return [0, 1, 2, 3, 4].map((i) => Math.round(Math.min(1, Math.max(0, v - i)) * 10) / 10)
}

/**
 * "Top rated": the highest average (as shown, one decimal) first; equal
 * averages by more reviews; designs with no published review after them, in
 * the order they came.
 */
export function topRatedFirst(products, totals) {
  return (Array.isArray(products) ? products : [])
    .map((p, i) => ({ p, i, r: designRating(totals, p) }))
    .sort((a, b) => {
      if (a.r && !b.r) return -1
      if (!a.r && b.r) return 1
      if (a.r && b.r) {
        const byAverage = Number(ratingText(b.r.average)) - Number(ratingText(a.r.average))
        if (byAverage) return byAverage
        if (b.r.count !== a.r.count) return b.r.count - a.r.count
      }
      return a.i - b.i
    })
    .map(({ p }) => p)
}

// A quote beside the buy buttons is read in a glance: one or two lines.
const QUOTE_MIN = 25
const QUOTE_MAX = 140

/**
 * The one review quoted beside the buy buttons: the review that best answers
 * "will I like it?" in a glance. Highest rating first, then a review the owner
 * marked "Verified purchase", then one whose text reads in a line or two, then
 * the newest. Null when the design has no published review.
 */
export function highlightReview(reviews = []) {
  const list = (Array.isArray(reviews) ? reviews : []).filter((r) => r && String(r.body ?? '').trim())
  if (!list.length) return null
  const readable = (r) => {
    const n = String(r.body).trim().length
    return n >= QUOTE_MIN && n <= QUOTE_MAX ? 1 : 0
  }
  return list
    .map((r, i) => ({ r, i }))
    .sort((a, b) =>
      (Number(b.r.rating) || 0) - (Number(a.r.rating) || 0)
      || (b.r.verified === true) - (a.r.verified === true)
      || readable(b.r) - readable(a.r)
      || new Date(b.r.created_at || 0) - new Date(a.r.created_at || 0)
      || a.i - b.i)[0].r
}

/** A review's words cut to fit beside the buttons: whole words, with "…" only
 *  when something was cut. Line breaks become spaces. */
export function quoteText(body, max = QUOTE_MAX) {
  const text = String(body ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max + 1)
  const atWord = cut.lastIndexOf(' ')
  return `${(atWord > max * 0.6 ? cut.slice(0, atWord) : text.slice(0, max)).replace(/[\s,;:.–—-]+$/, '')}…`
}
