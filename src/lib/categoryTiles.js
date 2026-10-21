// The homepage's "Shop by Category" tiles, in one place.
//
// The tiles are built here — not in the homepage and not in the Collections
// page — so a category's photo and the link it points at can never disagree
// between the two screens, and so both can be tested without a browser.
//
// Two rules the tiles follow:
//
//   * the LINK is always the shop page for that exact category
//     (`/shop?type=<key>`), which is where the shop's own Type filter reads
//     it from — so a shopper lands on that category's products, not on the
//     whole catalogue;
//   * the PHOTO is the one the owner chose in the admin panel first, then the
//     default photo that ships with the site, and only then the first product
//     photo in that category. A category with no photograph at all is left
//     out rather than shown as a broken circle.

import { categoryFallbackImage } from '../data/products.js'

/**
 * The shop URL for a category.
 *
 * The key is encoded, so a category whose key ever carries a character that
 * means something in a query string still produces a URL the shop can read.
 */
export const categoryShopUrl = (key) => `/shop?type=${encodeURIComponent(String(key ?? ''))}`

/**
 * The photo a category tile shows.
 *
 * The owner's choice comes first — that is the whole point of the admin
 * panel — and the default photograph is only used when nothing has been
 * chosen, so the site looks exactly as it does today until the owner
 * changes something.
 *
 * A photograph the owner has switched OFF is not used: the category keeps it,
 * so it can be switched on again without choosing it again, but the site
 * falls back to the photograph that ships with the shop (or the first product
 * photo in that category) exactly as it does for a category that has no
 * photograph of its own.
 */
export const categoryImage = (category, products) => {
  const active = category?.image_active !== false
  const chosen = active ? String(category?.image ?? '').trim() : ''
  if (chosen) return chosen
  const fallback = categoryFallbackImage(category?.key)
  if (fallback) return fallback
  const list = Array.isArray(products) ? products : []
  return list.find((p) => p?.type === category?.key && p?.image)?.image || null
}

/**
 * The tiles the Collections page shows.
 *
 * Two rules it follows that the page used to get wrong:
 *
 *   * the PHOTOGRAPH goes through `categoryImage`, so a photograph the owner
 *     has switched OFF is not shown here while every other screen falls back
 *     — one switch, one answer, on the homepage and on this page alike;
 *   * the tiles come from the live category list, never from the four launch
 *     tiles alone: a category the client deleted or renamed can no longer
 *     appear here under its old name and photograph, and a category added
 *     later gets a tile of its own.
 *
 * The curated four keep their place at the front, and their copy, because
 * that is the client's own wording for the ranges she launched with.
 *
 * `categories` may be empty — before the list arrives, or when Supabase is
 * unreachable — in which case the curated tiles are shown as they ship, so
 * the page is never blank while it waits.
 */
export const collectionPageTiles = (categories, products, curated) => {
  const list = Array.isArray(categories) ? categories : []
  const tiles = Array.isArray(curated) ? curated : []
  const known = list.length ? new Map(list.map((c) => [c.key, c])) : null

  const leading = tiles
    .map((tile) => {
      const key = String(tile.to ?? '').split('?type=')[1] || ''
      const category = known ? known.get(key) : null
      // A category that is no longer on the client's list has no tile: the
      // link would open a shop filter for a category that cannot be chosen
      // again, and the photograph would be the deleted category's.
      if (known && !category) return null
      return {
        ...tile,
        key,
        title: category?.label || tile.title,
        image: category ? categoryImage(category, products) || tile.image : tile.image,
        to: categoryShopUrl(key),
      }
    })
    .filter(Boolean)

  const done = new Set(leading.map((t) => t.key))
  const extra = list
    .filter((c) => !done.has(c.key))
    .map((c) => ({
      key: c.key,
      title: c.label,
      text: 'New in this collection',
      image: categoryImage(c, products),
      to: categoryShopUrl(c.key),
    }))
    .filter((t) => t.image)

  return [...leading, ...extra]
}

/** One tile per category, with its photo and its link. */
export const categoryTiles = (categories, products) =>
  (Array.isArray(categories) ? categories : [])
    .map((c) => ({
      key: c.key,
      label: c.label,
      image: categoryImage(c, products),
      to: categoryShopUrl(c.key),
    }))
    .filter((t) => t.image)

/**
 * The categories the store actually stocks, in catalogue order.
 *
 * The homepage hero and the "Shop by Category" row only advertise a category
 * that has at least one live product, so a newly added (still empty)
 * category can never promise a shopper something the shop does not have. With
 * an empty catalogue nothing can be judged, so every pictured category is
 * shown — the same rule the Collections page applies to its tiles.
 */
export const stockedCategoryTiles = (categories, products) => {
  const all = categoryTiles(categories, products)
  const withStock = all.filter((t) =>
    (Array.isArray(products) ? products : []).some((p) => p?.type === t.key))
  return withStock.length ? withStock : all
}

/**
 * Every category with a product in it, in catalogue order, whether or not it
 * is one the client's list still offers — the same gap `withTypeOption`
 * covers in the pickers. A category that still holds products has to stay
 * reachable from the homepage; `stockedCategoryTiles` keeps the curated four
 * leading and the empty ones out, and this supplies what it would miss.
 */
export const extraCategoryTiles = (categories, products) => {
  const known = new Set(categoryTiles(categories, products).map((t) => t.key))
  const extra = []
  for (const p of Array.isArray(products) ? products : []) {
    if (known.has(p?.type) || !p?.image || extra.some((c) => c.key === p.type)) continue
    known.add(p.type)
    extra.push({ key: p.type, label: p.type, image: p.image, to: categoryShopUrl(p.type) })
  }
  return extra
}
