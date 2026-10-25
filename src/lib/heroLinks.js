// Where a homepage hero slide takes the shopper.
//
// The hero slides two kinds of photograph (see src/lib/heroSlider.js): the
// banners the owner saved — each with the destination she chose for it, which
// this module never touches — and, still on the END of the list so the arrows
// never disappear, the category photographs the store has always slid between.
//
// A category photograph is very often a product's photograph. The fallback for
// a category with no photograph of its own IS the first product photograph in
// that category (src/lib/categoryTiles.js), and the owner regularly uploads one
// of her own product shots as the category photograph too. So a slide whose
// photograph belongs to a product opens that product's page — and when the
// photograph is one COLOUR's photograph, that colour's own page.
//
// What it must never do is guess.
//
//   The rule this module exists to enforce: a slide is sent to a product only
//   when some row of the catalogue OWNS the photograph it shows, and otherwise
//   it keeps the destination the tile already had — the category page the owner
//   configured. It used to fall back to "the first product in the category",
//   which invented a destination: a Tops photograph opened the Denim Shirt, a
//   Trousers photograph opened the Mulmul Cotton Trousers, and a coord
//   photograph opened the Acid Wash coord set — three of the five slides
//   pointing at a product that had nothing to do with the picture clicked.
//
// The reference used to decide ownership is the photograph itself, matched
// against EVERY photograph a product owns — its main image, its hover image,
// its whole gallery, and the same three for each of its colour rows. Matching
// only the card's main image is what made the old rule so easy to miss a
// product: the second photo of a gallery, or the photo of a colour that is not
// the cheapest, resolved to nothing and fell through to the guess.
//
// The route is then built by src/lib/productLinks.js from the row's OWN id, so
// a slide can never be sent to a different product than the one photographed.

import { productHref } from './productLinks.js'

/** The photographs one row owns: its main image, its hover image and its
 *  gallery. Empty strings and blanks are dropped — an empty photograph must
 *  never match another empty photograph and name a product. */
const photosOf = (row) => {
  if (!row || typeof row !== 'object') return []
  const list = [row.image, row.hover, ...(Array.isArray(row.gallery) ? row.gallery : [])]
  return list
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
}

/**
 * The key two photographs are compared by.
 *
 * The full stored address, with a query string or a fragment trimmed off and
 * the address decoded — the same object written twice with different escaping
 * is the same photograph. Returns '' for anything that is not a photograph, so
 * a missing image can never match a missing image and name a product.
 */
export const photoKey = (value) => {
  if (typeof value !== 'string') return ''
  const bare = value.trim().split(/[?#]/).at(0)
  if (!bare) return ''
  try {
    return decodeURIComponent(bare)
  } catch {
    return bare
  }
}

/**
 * Every photograph in the catalogue, keyed by its address, naming the exact
 * row that owns it.
 *
 * Colour rows are indexed BEFORE the card speaks for itself, because a colour
 * row's photograph is the more precise answer: it opens the product on THAT
 * colour, which is where the shopper was looking when they clicked. The first
 * owner of a photograph wins, so a photograph two products somehow share can
 * never resolve differently from one moment to the next.
 */
export function photoIndex(products) {
  const index = new Map()
  for (const product of Array.isArray(products) ? products : []) {
    if (!product) continue
    for (const colour of Array.isArray(product.colors) ? product.colors : []) {
      for (const key of photosOf(colour)) if (!index.has(key)) index.set(key, { product, row: colour })
    }
    for (const key of photosOf(product)) if (!index.has(key)) index.set(key, { product, row: product })
  }
  return index
}

/**
 * The hero's category slides, each pointing at the product it actually shows.
 *
 * A tile whose photograph belongs to a product is sent to that product —
 * `/product/<the row's own id>`, which the product page opens on that exact
 * colour. A tile whose photograph belongs to nobody keeps `tile.to`: the
 * category page, which is the destination the tile has always had and the one
 * the owner can see in the admin panel.
 */
export function heroFallbackSlides(tiles, products) {
  const index = photoIndex(products)
  return (Array.isArray(tiles) ? tiles : []).filter(Boolean).map((tile) => {
    const owner = index.get(photoKey(tile.image))
    const to = owner
      ? productHref(owner.row) || productHref(owner.product) || tile.to
      : tile.to
    return { key: tile.key, image: tile.image, to, label: tile.label }
  })
}
