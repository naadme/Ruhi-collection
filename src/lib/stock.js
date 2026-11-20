// What "sold out" means in this shop (20 Nov 2026, Sold_Out_Proposal_2026-11-20.html).
//
// The shop does not count stock. Each colour row, in each size, is either in
// stock or sold out: `sold_out_sizes` (supabase/migrations/20261120210000_sold_out.sql)
// names the sizes of that colour that have run out. Everything else is derived
// here, so the product page, the lists, the cart and the feed all agree:
//
//   * a SIZE is sold out when its colour's row names it;
//   * a COLOUR is sold out when every size it is made in is;
//   * a DESIGN is sold out when every one of its colours is.
//
// "Hidden" (is_active false) is a different thing: we stopped selling it.
//
// Pure, so tests/soldOut.test.js can run it without a browser.

const list = (v) => (Array.isArray(v) ? v : [])

/** The sizes of this colour that have run out. */
export const soldOutSizes = (row) => list(row?.sold_out_sizes)

/** Whether this colour is sold out in `size`. */
export const isSizeSoldOut = (row, size) => Boolean(size) && soldOutSizes(row).includes(size)

/** The sizes of this colour a shopper can buy, in the colour's own order. */
export const inStockSizes = (row) => {
  const out = soldOutSizes(row)
  const sizes = list(row?.sizes)
  return out.length ? sizes.filter((s) => !out.includes(s)) : sizes
}

/** Every size this colour is made in has run out. */
export const isColourSoldOut = (row) => list(row?.sizes).length > 0 && inStockSizes(row).length === 0

/** The colour rows of a design card (a card without colours is its own row). */
export const designRows = (design) => {
  if (!design) return []
  return list(design.colors).length ? design.colors : [design]
}

/** Every colour of the design is sold out. */
export const isDesignSoldOut = (design) => {
  const rows = designRows(design)
  return rows.length > 0 && rows.every(isColourSoldOut)
}

/** The size a page describes before the shopper picks one: the first in stock. */
export const firstInStockSize = (row) => inStockSizes(row)[0] || list(row?.sizes)[0]

/**
 * The rows every LIST may show: live colours with at least one size in stock,
 * each carrying only its sizes in stock. Grouped into cards, a design with a
 * sold-out colour then leads with a colour in stock, a size search ("XL")
 * matches only colours with that size in stock, and a design sold out in
 * every colour is never listed. Its own page still opens from a link: product
 * pages, the cart and the wishlist read the whole catalogue, not this.
 *
 * Rows with nothing sold out are passed through untouched.
 */
export function listableRows(rows) {
  const out = []
  for (const row of list(rows)) {
    if (!row || row.is_active === false) continue
    if (!soldOutSizes(row).length) { out.push(row); continue }
    const sizes = inStockSizes(row)
    if (sizes.length) out.push({ ...row, sizes })
  }
  return out
}
