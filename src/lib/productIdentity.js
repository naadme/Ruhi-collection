// The product's identity, in one place.
//
// The shop has exactly TWO identifiers: the Order ID (DDMMYYNN, on the
// order) and the Product ID (CCPPCL, on the product). There is no third
// one, and nothing here invents one.
//
// The Product ID is six characters:
//
//   CC   the category's number — 01, 02, 03 …
//   PP   the product's number inside that category — 01, 02, 03 …
//   CL   the colour's two letters — BU for Blue, BL for Black, RE for Red
//
// so 0101BU is the first product of category 01, in the colour Blue.
//
// The database assigns it (`public.assign_product_sku`), keeps it the same
// across edits, and stamps it onto every ordered line
// (`order_items.sku`), so an order always names the exact product that was
// bought. It is shown everywhere and typed nowhere.
//
// A product's row key (`products.id`) is its WEB ADDRESS — the
// "solid-shirts-blue" in its URL. It is not an identifier, it is a link, and
// it is never shown where the Product ID belongs.

/**
 * The Product ID of a product row — the six characters the customer quotes.
 *
 * A row that has never been saved has none, and then there is nothing to
 * show; nothing is invented and the web address is never passed off as one.
 */
export function productId(p) {
  return String(p?.sku ?? '').trim()
}

/** The Product ID of an ordered line — its own snapshot of the product's. */
export function orderLineProductId(item) {
  return String(item?.sku ?? '').trim()
}

/** "0101BU" — true when the value has the shape of a Product ID. */
export const PRODUCT_ID_RE = /^[0-9]{2}[0-9]{2}[A-Z]{2}$/

/** True when the value is a well-formed Product ID. */
export const isProductId = (v) => PRODUCT_ID_RE.test(String(v ?? '').trim())

/**
 * The Product ID split into its three parts — the category number, the
 * product number and the colour letters — for anything that wants to show
 * them one by one. Returns nulls for a value that is not a Product ID.
 */
export function productIdParts(v) {
  const id = String(v ?? '').trim()
  if (!isProductId(id)) return { category: '', product: '', colour: '', valid: false }
  return {
    category: id.slice(0, 2),
    product: id.slice(2, 4),
    colour: id.slice(4, 6),
    valid: true,
  }
}
