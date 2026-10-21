// The ONE rule for "which product does this link name?".
//
// The storefront links to a product in three ways:
//
//   * by the card's own id — the row the card opens, prices and carts;
//   * by a colour row's id — a shared link, an old bookmark, a cart line, a
//     review that names one colour;
//   * by an id that no longer exists — the product was deleted or hidden.
//
// All three are resolved here, so a card, a search result and a product page
// can never point at different products, and a link to a product that is gone
// resolves to NOTHING (which is how the product page shows "Product not
// found" instead of quietly opening somebody else's product).

/**
 * Index the catalogue.
 *
 * `byId`     — every id the site may link with → the card (design) it belongs
 *               to. A card's own id and every one of its colour rows' ids all
 *               resolve to that same card, so a shared link and a shop card
 *               always open the same page.
 * `variants` — every colour row's id → that row, so a link that names a
 *               colour opens THAT colour and not the first one.
 *
 * The first id wins, exactly as the storefront has always resolved ids: a
 * repeated id can never send a shopper to a different design.
 */
export function indexProducts(products) {
  const byId = new Map()
  const variants = new Map()
  for (const p of products || []) {
    if (!p || !p.id) continue
    if (!byId.has(p.id)) byId.set(p.id, p)
    for (const c of p.colors || []) {
      if (!c || !c.id) continue
      if (!variants.has(c.id)) variants.set(c.id, c)
      if (!byId.has(c.id)) byId.set(c.id, p)
    }
  }
  return { byId, variants }
}

/**
 * The card a link names, or null when the product is gone.
 *
 * Null is the answer for a deleted or hidden product — the caller shows the
 * "not found" page rather than opening a different product.
 */
export const findProduct = (index, id) => index?.byId?.get(id) || null

/**
 * The exact colour row a link names, or null when the link names a design
 * that has no colours of its own (or no product at all).
 */
export const findVariant = (index, id) => index?.variants?.get(id) || null
