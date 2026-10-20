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
 */
export const categoryImage = (category, products) => {
  const chosen = String(category?.image ?? '').trim()
  if (chosen) return chosen
  const fallback = categoryFallbackImage(category?.key)
  if (fallback) return fallback
  const list = Array.isArray(products) ? products : []
  return list.find((p) => p?.type === category?.key && p?.image)?.image || null
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
