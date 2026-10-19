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
 * The list the owner can actually see, mapped back to where each entry lives in
 * the saved id list.
 *
 * Returns `[{ index, pick, cardId, card }]` in display order — one entry per
 * design that renders. `index` is the position of the ORIGINAL id in `picks`,
 * which is what makes it safe to reorder: the visible list and the saved list
 * are not the same length or the same indexing, because a pick may name a
 * colour row rather than the card, two picks may share one card, and a pick
 * whose design is hidden or deleted resolves to nothing yet still occupies a
 * slot. Anything that indexes `picks` using a position read off the rendered
 * list therefore moves (or removes) the wrong row.
 *
 * The matching rule is exactly `resolveBestsellers`' — a card matches an id it
 * carries itself OR one of its colour rows — so the panel and the homepage can
 * never disagree about which picks are live.
 */
export function locatePicks(picks, cards) {
  const list = Array.isArray(cards) ? cards : []
  const source = Array.isArray(picks) ? picks : []
  const out = []
  const seen = new Set()

  source.forEach((pick, index) => {
    const id = pick && typeof pick === 'string' ? pick : ''
    if (!id || seen.has(id)) return
    const card = list.find(
      (c) => c?.id === id || (Array.isArray(c?.colors) && c.colors.some((v) => v?.id === id)),
    )
    if (!card || seen.has(card.id)) return
    seen.add(id)
    seen.add(card.id)
    out.push({ index, pick: id, cardId: card.id, card })
  })
  return out
}

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
 *
 * Defined on top of `locatePicks` so there is only ever one matching rule to
 * reason about (and one to test) — the admin panel reads the same resolution
 * through `locatePicks`, and its saved positions come from that.
 */
export function resolveBestsellers(picks, cards, limit = MAX_BESTSELLERS) {
  if (!Array.isArray(picks) || !picks.length) return []
  const ids = picks.map((pick) => (pick && typeof pick.product_id === 'string' ? pick.product_id : ''))
  return locatePicks(ids, cards).slice(0, limit).map((entry) => entry.card)
}

/** Normalise what the admin saved into a clean, de-duplicated, in-order id
 *  list. Trims, drops empties and never invents an id. */
export function normalizePicks(productIds) {
  return [...new Set((Array.isArray(productIds) ? productIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))]
}
