// The ONE rule for "where does this product live".
//
// Every card on the homepage, every card in the shop, every search result and
// every banner builds its link here, so a product can never be advertised
// under one address and open under another.
//
// The id in the link is the product's OWN row id in the database — the same id
// the cart adds, the same row `create_order()` prices and the same row the
// product page opens. Nothing is hardcoded and nothing is invented: a product
// that has been deleted simply has no id, and then there is nothing to link
// to (the caller falls back to the shop rather than to some other product).

/**
 * The database row id a product (or one of its colour rows) is filed under.
 *
 * Returns an empty string for anything that carries no id, so a caller can
 * tell "no product" from "a product with a strange id".
 */
export const productId = (product) => String(product?.id ?? '').trim()

/**
 * The canonical route for a product: `/product/<its own id>`.
 *
 * A product with no id has no page of its own, so the shop is the honest
 * answer — never another product's page.
 */
export const productHref = (product) => {
  const id = productId(product)
  return id ? `/product/${encodeURIComponent(id)}` : '/shop'
}
