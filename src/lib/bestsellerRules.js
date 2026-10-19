// The pure (network-free) rules behind admin-managed Best Sellers.
//
// They live apart from `bestsellers.js` so the rules can be unit-tested in
// plain Node without the Supabase client, following the same split
// `categoryRules.js` / `categories.js` and `couponRules.js` / `coupons.js`
// already use. Nothing here touches the network or the database.
//
// The saved picks are product ids and a position — nothing else. No sales
// figure is calculated and no order data is consulted: this is a shop-window
// choice the owner makes, and the row derives from the catalogue only while
// the owner has made none.

/** How many designs the owner may put in the shop window at once. The
 *  homepage grid is 4-up on desktop, so this comfortably covers two rows
 *  without turning the section into a catalogue dump. */
export const MAX_BESTSELLERS = 8

/**
 * Turn picks into displayable shop cards, keeping the saved order.
 *
 * A pick names a PRODUCT ROW id, but the homepage renders CARDS: one per
 * design, whose `id` is that design's cheapest colour row and whose `colors`
 * carry every colour row (see src/lib/productGrouping.js). So a pick matches a
 * card when it names the card's own id OR any colour inside it — which is what
 * lets the owner promote a design by picking any one of its colours.
 *
 * A pick with no matching card is skipped rather than throwing, which is what
 * protects the homepage: a deleted, hidden or not-yet-loaded product can never
 * end up as a broken card. Two picks that resolve to the same design show once.
 */
export function resolveBestsellers(picks, cards, limit = MAX_BESTSELLERS) {
  if (!Array.isArray(picks) || !picks.length) return []
  const list = Array.isArray(cards) ? cards : []
  const out = []
  const seen = new Set()

  for (const pick of picks) {
    const id = pick && typeof pick.product_id === 'string' ? pick.product_id : ''
    if (!id || seen.has(id)) continue
    const card = list.find(
      (c) => c?.id === id || (Array.isArray(c?.colors) && c.colors.some((v) => v?.id === id)),
    )
    if (!card || seen.has(card.id)) continue
    seen.add(id)
    seen.add(card.id)
    out.push(card)
    if (out.length >= limit) break
  }
  return out
}

/** Normalise what the admin saved into a clean, de-duplicated, in-order id
 *  list. Trims, drops empties and never invents an id. */
export function normalizePicks(productIds) {
  return [...new Set((Array.isArray(productIds) ? productIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))]
}
