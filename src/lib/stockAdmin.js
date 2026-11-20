// The admin's side of sold out (20 Nov 2026): what the Stock screen, the
// product list and the sold-out alert say about a design. What "sold out"
// means is src/lib/stock.js; this file only summarises it for the owner.
//
// Pure, so tests/soldOut.test.js can run it without a browser.

import { inStockSizes, isColourSoldOut, soldOutSizes } from './stock.js'

const list = (v) => (Array.isArray(v) ? v : [])
const live = (rows) => list(rows).filter((r) => r && r.is_active !== false)

/** A design's stock in numbers: sold-out sizes, sold-out colours, and whether every colour is. */
export function stockSummary(rows) {
  const on = live(rows)
  const sizes = on.reduce((n, r) => n + list(r.sizes).length, 0)
  const sizesOut = on.reduce((n, r) => n + soldOutSizes(r).length, 0)
  const coloursOut = on.filter(isColourSoldOut).length
  return { colours: on.length, sizes, sizesOut, coloursOut, allOut: on.length > 0 && coloursOut === on.length }
}

/** "1 size sold out", "4 of 15 sizes sold out", "All sold out"; '' when all is in stock. */
export function stockLabel({ sizes = 0, sizesOut = 0, allOut = false } = {}) {
  if (allOut) return 'All sold out'
  if (!sizesOut) return ''
  return sizesOut === 1 ? '1 size sold out' : `${sizesOut} of ${sizes} sizes sold out`
}

/**
 * Whether marking `sizes` of row `rowId` sold out leaves every live colour of
 * the design sold out: the one tap that asks before it acts, because it takes
 * the design out of every list and out of the ads.
 */
export function sellsOutDesign(rows, rowId, sizes) {
  const on = live(rows)
  if (!on.length) return false
  return on.every((r) => {
    const out = new Set(soldOutSizes(r))
    if (r.id === rowId) list(sizes).forEach((s) => out.add(s))
    const all = list(r.sizes)
    return all.length > 0 && all.every((s) => out.has(s))
  })
}

/**
 * The colour to point an ad at when `soldOutId` sells out: another live colour
 * of the same design that is in stock, the one with the most paid pieces
 * (`pieces`: product id → pieces, last 30 days), then the most sizes in stock,
 * then the catalogue's order. Null when no colour of the design is in stock.
 */
export function bestColourInStock(rows, soldOutId, pieces = new Map()) {
  const ranked = live(rows)
    .map((r, order) => ({ r, order, sold: Number(pieces.get(r.id)) || 0, sizes: inStockSizes(r).length }))
    .filter((x) => x.r.id !== soldOutId && x.sizes > 0)
    .sort((a, b) => b.sold - a.sold || b.sizes - a.sizes || a.order - b.order)
  return ranked.length ? ranked[0].r : null
}

/** After this long sold out, the alert becomes a reminder to change the ad (the owner's 24 hours). */
export const REMIND_AFTER_MS = 24 * 60 * 60 * 1000

/** `{ due, hoursLeft }` for an alert that started at `soldOutAt` (ISO time). */
export function alertTiming(soldOutAt, now = Date.now()) {
  const since = Date.parse(soldOutAt)
  if (!Number.isFinite(since)) return { due: false, hoursLeft: 24 }
  const left = since + REMIND_AFTER_MS - now
  return { due: left <= 0, hoursLeft: Math.max(1, Math.ceil(left / 3600000)) }
}
