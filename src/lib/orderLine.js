// The facts about one ordered line, as the customer's side of the shop sees
// them — the same two rules the emails and the spreadsheet use
// (supabase/functions/_shared/orderItems.mjs), kept in step here so a line
// never reads "Blue" in the mail and nothing on the page.
//
// The colour is part of the title the order snapshots — the catalogue writes
// a product's title as "Design - Colour" — so it is read back out of that
// title rather than looked up again. The Product ID is the line's own
// snapshot (`order_items.sku`), which can never drift onto another product.

/**
 * The colour of an ordered line, from the title the order snapshotted.
 *
 * "Solid Shirt and Denim pant Combo - Black" -> "Black"
 * "Cotton Dress"                             -> "" (no colour was recorded)
 */
export function orderLineColour(title) {
  const text = String(title ?? '')
  const at = text.lastIndexOf(' - ')
  if (at < 0) return ''
  const colour = text.slice(at + 3).trim()
  // A suffix that is not a word is part of the name, not a colour.
  if (!colour || colour.length > 24) return ''
  return /^[A-Za-z][A-Za-z ]*$/.test(colour) ? colour : ''
}

/** The design's name, without the colour suffix the snapshot carries. */
export function orderLineName(title) {
  const text = String(title ?? '')
  const colour = orderLineColour(text)
  if (!colour) return text
  return text.slice(0, text.lastIndexOf(' - ')).trim() || text
}

/**
 * The Product ID of an ordered line — the six characters the product
 * carried when it was bought. A line placed before the column existed has
 * none, and then there is nothing to show; nothing is invented.
 */
export function orderLineSku(item) {
  return String(item?.sku ?? '').trim()
}

/** "Blue · Size M · ×2 · 0101BL" — the line's facts, in the shop's order. */
export function orderLineDetail(item) {
  return [
    orderLineColour(item?.title),
    item?.size ? `Size ${item.size}` : '',
    item?.qty ? `×${item.qty}` : '',
    orderLineSku(item),
  ].filter(Boolean).join(' · ')
}
