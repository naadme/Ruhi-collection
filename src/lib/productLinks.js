// The ONE rule for "where does this product live".
//
// Every card on the homepage, every card in the shop, every search result and
// every banner builds its link here, so a product can never be advertised
// under one address and open under another.
//
// The id in the link is the product's OWN row id in the database — the same id
// the cart adds, the same row `create_order()` prices and the same row the
// product page opens. Nothing is hardcoded and nothing is invented.
//
// A product that has no id has NO page of its own, and it gets NO link at
// all. It is never sent to the shop listing and never to somebody else's
// product: a card that cannot name its product simply is not a link. (The
// old fallback pointed at "/shop", which is exactly the "it opened the
// listing page instead of the product" behaviour this rule exists to
// prevent.)

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
 * Returns an empty string when the product has no id — there is nowhere to
 * go, and the caller renders the card without a link rather than sending the
 * shopper somewhere else.
 */
export const productHref = (product) => {
  const id = productId(product)
  return id ? `/product/${encodeURIComponent(id)}` : ''
}
