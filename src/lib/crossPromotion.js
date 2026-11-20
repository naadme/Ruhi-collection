// What a sold-out page offers instead (20 Nov 2026, proposal section 5).
//
// The block takes the buy buttons' place when the colour on screen is sold
// out, or when the shopper taps a sold-out size. It offers, in this order:
//
//   1. the same set in other colours that are in stock (in her size, if she
//      picked one) — one tap switches the page and keeps her size;
//   2. similar sets in stock, up to 6 designs:
//        - the same category first;
//        - only designs in stock in her size, if she picked one, each shown
//          in a colour that has her size;
//        - ordered: the owner's best-seller picks, then the most reviewed and
//          best rated, then the newest;
//        - never the sold-out design itself;
//        - fewer than 4 found → filled up from other categories, same rules.
//
// `listable` is the catalogue every list uses (src/lib/stock.js
// `listableRows`, grouped into cards): live designs with a size in stock,
// carrying only their sizes in stock. Pure, so tests/soldOut.test.js runs it
// without a browser.

import { inStockSizes } from './stock.js'

const list = (v) => (Array.isArray(v) ? v : [])

export const SIMILAR_LIMIT = 6
export const SIMILAR_FILL = 4

/**
 * A listable card, led by a colour that is in stock in `size`; the card
 * itself when no size is asked for or its own colour already has it; null
 * when no colour of the design has `size` in stock.
 */
export function cardInSize(card, size) {
  if (!card) return null
  if (!size) return card
  const colours = list(card.colors)
  if (!colours.length) return inStockSizes(card).includes(size) ? card : null
  if (colours.some((c) => c.id === card.id && inStockSizes(c).includes(size))) return card
  const lead = colours.find((c) => inStockSizes(c).includes(size))
  if (!lead) return null
  // The same shape the grouping gives a card (src/lib/productGrouping.js):
  // the colour row's own id, photo, price and sizes, under the design's name.
  return { ...lead, title: card.title, desc: card.desc, badge: card.badge, colors: card.colors }
}

/** The design's other colours a shopper can buy (in `size`, if given). */
export function otherColours(design, currentId, size) {
  return list(design?.colors).filter((c) => {
    if (!c || c.id === currentId || c.is_active === false) return false
    const sizes = inStockSizes(c)
    return size ? sizes.includes(size) : sizes.length > 0
  })
}

/**
 * The block's contents: `{ colours, similar }`.
 *
 * `picks` are the owner's best-seller product ids in her order; `rating(card)`
 * gives `{ average, count }` or null (src/context/RatingsContext.jsx).
 */
export function crossPromotion({
  design, currentId, size = '', listable = [], picks = [], rating = () => null,
  limit = SIMILAR_LIMIT, fill = SIMILAR_FILL,
} = {}) {
  if (!design) return { colours: [], similar: [] }
  const colours = otherColours(design, currentId, size)

  const own = new Set([design.id, ...list(design.colors).map((c) => c.id)])
  const placeOf = new Map(list(picks).map((id, i) => [String(id), i]))
  const pickOf = (card) => Math.min(
    ...[card.id, ...list(card.colors).map((c) => c.id)].map((id) => (placeOf.has(id) ? placeOf.get(id) : Infinity)),
  )

  const found = []
  list(listable).forEach((card, order) => {
    if (!card || own.has(card.id) || list(card.colors).some((c) => own.has(c.id))) return
    const shown = cardInSize(card, size)
    if (!shown) return
    const r = rating(card) || {}
    found.push({ card: shown, type: card.type, order, pick: pickOf(card), count: Number(r.count) || 0, average: Number(r.average) || 0 })
  })
  found.sort((a, b) => a.pick - b.pick || b.count - a.count || b.average - a.average || a.order - b.order)

  const same = found.filter((x) => x.type === design.type).slice(0, limit)
  if (same.length < fill) same.push(...found.filter((x) => x.type !== design.type).slice(0, fill - same.length))
  return { colours, similar: same.map((x) => x.card) }
}
