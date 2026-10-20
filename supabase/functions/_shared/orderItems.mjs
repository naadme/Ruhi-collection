// The facts about one ordered line that every place that reports an order
// needs: the Product ID and the colour.
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
