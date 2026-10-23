// Paging for the homepage's Best Sellers row.
//
// The row is four cards across from `lg` up (the shared ProductGrid is
// `grid-cols-2 lg:grid-cols-4`), so anything beyond four designs has to be
// reachable — but four or fewer designs simply belong on the screen, with no
// arrows pointing at a second page that does not exist.
//
// The rule lives apart from src/components/Sections.jsx so it can be tested in
// plain Node, following the same split as `bestsellerRules.js` /
// `categoryTiles.js`: the homepage renders whatever these functions say, so
// the row cannot drift away from what the tests prove.
//
// Nothing here invents, reorders or copies a design — every function returns
// entries of the list it was given, in the order they already had.

/** How many designs the row shows at a time: four across on a desktop, two
 *  rows of two on a phone. */
export const BESTSELLER_PER_VIEW = 4

/** A count of things: anything that is not a positive whole number is nothing. */
const toCount = (value) => {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** A window size: never smaller than one card, whatever it was given. */
const toSize = (value) => Math.max(1, Math.trunc(Number(value)) || 1)

/** True only when there is more to see than fits: four or fewer designs are
 *  shown as they are, with no arrows at all. */
export function bestsellerArrows(total, perView = BESTSELLER_PER_VIEW) {
  return toCount(total) > toSize(perView)
}

/** How many pages the row has — one, while everything fits on the screen. */
export function bestsellerPages(total, perView = BESTSELLER_PER_VIEW) {
  const n = toCount(total)
  const per = toSize(perView)
  return Math.max(1, Math.ceil(n / per))
}

/**
 * The designs on `page`, keeping their order.
 *
 * While there are more than `perView` designs the window is always FULL: the
 * start is clamped to `length - perView`, so the last page slides back over
 * earlier designs rather than showing one lonely card in a four-up row (five
 * designs → 1-4 then 2-5; six → 1-4 then 3-6). A page number from a list that
 * has since shrunk is clamped too, so a design removed from the admin can
 * never leave the row empty or off the end.
 */
export function bestsellerSlice(items, page = 0, perView = BESTSELLER_PER_VIEW) {
  const list = Array.isArray(items) ? items : []
  const per = toSize(perView)
  if (list.length <= per) return list.slice()

  const pages = Math.max(1, Math.ceil(list.length / per))
  const at = Math.min(Math.max(0, Math.trunc(Number(page) || 0)), pages - 1)
  const start = Math.min(at * per, list.length - per)
  return list.slice(start, start + per)
}
