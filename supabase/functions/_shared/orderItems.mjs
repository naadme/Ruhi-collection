// The facts about one ordered line that every place that reports an order
// needs: the colour, the product's own link and (team-side only) the
// Product ID.
//
// The Product ID is SNAPSHOT onto the line when the order is placed
// (`public.order_items.sku`), so it is the ID of the exact product that was
// bought and it can never drift onto another product.
//
// The colour is part of the title the order snapshots — the catalogue writes
// a product's title as "Design - Colour" — so it is read back out of that
// title rather than looked up again. A product with no colour recorded has no
// " - Colour" suffix and therefore no colour here either; nothing is guessed.

/**
 * The colour of an ordered line, from the title the order snapshotted.
 *
 * "Solid Shirt and Denim pant Combo - Black" -> "Black"
 * "Cotton Dress"                             -> "" (no colour was recorded)
 */
export function orderItemColour(title) {
  const text = String(title ?? '')
  const at = text.lastIndexOf(' - ')
  if (at < 0) return ''
  const colour = text.slice(at + 3).trim()
  // A suffix that is not a word is part of the name, not a colour.
  if (!colour || colour.length > 24) return ''
  return /^[A-Za-z][A-Za-z ]*$/.test(colour) ? colour : ''
}

/**
 * The Product ID of an ordered line.
 *
 * The line's own snapshot is used. A line written before the column existed
 * has none; the caller may then fall back to the product it names, and to
 * nothing at all if that product is gone.
 */
export function orderItemSku(item) {
  const sku = String(item?.sku ?? '').trim()
  return sku
}

/** The shop's public address. Product links in mails and sheets point here. */
export const SHOP_URL = 'https://www.ruhi-collections.com'

/**
 * The direct link to the exact product of an ordered line — the colour's own
 * page, `/product/<product_id>`, the same address the site opens for it.
 *
 * The customer's mail shows this instead of the Product ID (26 Nov 2026): a
 * link she can tap names the exact design and colour, a six-character code
 * did not. A line with no product id has no page, and gets no link.
 */
export function orderItemLink(item) {
  const id = String(item?.product_id ?? '').trim()
  return id ? `${SHOP_URL}/product/${encodeURIComponent(id)}` : ''
}
