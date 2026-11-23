// The "Recommended" order of a category page (/shop?type=…), 23 Nov 2026.
//
//   1. Bestsellers: designs whose Badge says "Bestseller" (Admin → product →
//      Badge), the one with the most orders first.
//   2. New arrivals: designs first added in the last 14 days, newest first.
//      A new colour of an older design does not make the design new.
//   3. Everything else: most orders received first, then most viewed.
//
// "Most orders, then most viewed" is one position per design, worked out
// every hour by the database (supabase/migrations/20261123120000_
// product_rank.sql) because orders are private; `ranks` maps a design to it.
// A design without a position (no ranking yet, or the read failed) goes after
// the ranked ones in its group, newest first, so the page never waits on it
// to be usable. Pure: no React, no database, so it is tested in plain Node.

export const NEW_ARRIVAL_DAYS = 14
const DAY = 24 * 60 * 60 * 1000

/** True when the card's Badge reads "Bestseller" ("Best seller", "BESTSELLER"…). */
export const isBestseller = (card) => /^best[\s-]*seller$/i.test(String(card?.badge ?? '').trim())

/** The design a card is: its design ID, else its own Product ID. */
export const designOf = (card) => card?.design_id || card?.id || ''

const time = (value) => {
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

/** When the design was first added: the earliest of its colours, or null. */
export function firstAdded(card) {
  const rows = Array.isArray(card?.colors) && card.colors.length ? card.colors : [card]
  let first = null
  for (const r of rows) {
    const t = time(r?.created_at)
    if (t !== null && (first === null || t < first)) first = t
  }
  return first
}

/** True when the design was first added within the last NEW_ARRIVAL_DAYS. */
export function isNewArrival(card, now = Date.now()) {
  const t = firstAdded(card)
  return t !== null && now - t <= NEW_ARRIVAL_DAYS * DAY
}

/**
 * The cards in Recommended order. `ranks` is a Map of design → position (1 is
 * the most ordered, then most viewed); `now` is for tests. Never changes the
 * array it is given.
 */
export function recommendedOrder(cards, { ranks, now = Date.now() } = {}) {
  const positions = ranks instanceof Map ? ranks : new Map()
  const rankOf = (card) => {
    const p = Number(positions.get(designOf(card)))
    return Number.isFinite(p) ? p : Infinity
  }
  const entries = (cards || []).map((card, index) => ({
    card,
    index,
    group: isBestseller(card) ? 0 : isNewArrival(card, now) ? 1 : 2,
    rank: rankOf(card),
    added: firstAdded(card) ?? -Infinity,
  }))
  const newestFirst = (a, b) => (b.added > a.added ? 1 : b.added < a.added ? -1 : 0)
  entries.sort((a, b) => {
    if (a.group !== b.group) return a.group - b.group
    if (a.group !== 1 && a.rank !== b.rank) return a.rank < b.rank ? -1 : 1
    return newestFirst(a, b) || a.index - b.index
  })
  return entries.map((e) => e.card)
}
