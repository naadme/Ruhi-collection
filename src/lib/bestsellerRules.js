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
 * A pick may be written as a plain id (the shape the panel used for years) or
 * as `{ product_id, is_active }` (the shape the table now holds, so a design
 * can be switched off without losing its place in the order).
 *
 * These two helpers read both, so every caller can keep using whichever shape
 * it already has.
 */
export const pickId = (pick) => (
  pick && typeof pick === 'object'
    ? String(pick.product_id || '').trim()
    : String(pick || '').trim()
)

/** A pick that has not been switched off is live. */
export const pickActive = (pick) => !(pick && typeof pick === 'object' && pick.is_active === false)

/**
 * The card an id names: the card itself, or ANY colour row inside it.
 *
 * This is the ONE matching rule of this module — `locatePicks` resolves
 * through it, and every caller that has to ask the same question ("does this
 * id belong to that design?") asks it here, so the panel and the homepage can
 * never disagree about which picks are live.
 */
const cardForId = (list, id) => list.find(
  (c) => c?.id === id || (Array.isArray(c?.colors) && c.colors.some((v) => v?.id === id)),
)

/**
 * The list the owner can actually see, mapped back to where each entry lives in
 * the saved id list.
 *
 * Returns `[{ index, pick, product_id, cardId, card, active }]` in display
 * order — one entry per design that renders. `index` is the position of the
 * ORIGINAL id in `picks`, which is what makes it safe to reorder: the visible
 * list and the saved list are not the same length or the same indexing,
 * because a pick may name a colour row rather than the card, two picks may
 * share one card, and a pick whose design is hidden or deleted resolves to
 * nothing yet still occupies a slot. Anything that indexes `picks` using a
 * position read off the rendered list therefore moves (or removes) the wrong
 * row.
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
    const id = pickId(pick)
    if (!id || seen.has(id)) return
    const card = cardForId(list, id)
    if (!card || seen.has(card.id)) return
    seen.add(id)
    seen.add(card.id)
    out.push({ index, pick: id, product_id: id, cardId: card.id, card, active: pickActive(pick) })
  })
  return out
}

/**
 * EVERY saved pick that renders as the design `cardId` — the card's own id,
 * any colour row of the same design, and any stored duplicate of either.
 *
 * `locatePicks` deliberately reports ONE entry per design (that is what keeps
 * the row on screen honest), so it cannot be used to work out what to REMOVE:
 * only the first pick would be collected, every other pick naming that design
 * would survive the save, and the design would come straight back — which is
 * exactly what "remove does not work correctly" looked like to the owner.
 *
 * The ids come back in saved order, so the caller can hand them to
 * `withoutPicks` and leave everything else untouched.
 */
export function picksForCard(picks, cardId, cards) {
  const list = Array.isArray(cards) ? cards : []
  const out = []
  const seen = new Set()
  for (const pick of Array.isArray(picks) ? picks : []) {
    const id = pickId(pick)
    if (!id || seen.has(id)) continue
    const card = cardForId(list, id)
    if (!card || card.id !== cardId) continue
    seen.add(id)
    out.push(id)
  }
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
 * A pick the owner has switched off is left out: the design keeps its place in
 * the saved order, it is simply not in the shop window.
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
  return locatePicks(picks, cards)
    .filter((entry) => entry.active)
    .slice(0, limit)
    .map((entry) => entry.card)
}

/** Normalise what the admin saved into a clean, de-duplicated, in-order id
 *  list. Trims, drops empties and never invents an id. */
export function normalizePicks(productIds) {
  return [...new Set((Array.isArray(productIds) ? productIds : [])
    .map((id) => pickId(id))
    .filter(Boolean))]
}

/**
 * The picks left after the ids in `drop` are taken out — and nothing else.
 *
 * The id has to be read OFF every pick (`pickId`), because a saved pick may be
 * either a plain id or a `{ product_id, is_active }` row. Comparing the pick
 * itself against a Set of id strings matches nothing, so every pick survives
 * the filter: that is exactly what made the panel's remove button a silent
 * no-op that never reached the database.
 *
 * The input array is never mutated; when nothing matches, the SAME array is
 * returned so a caller's state update can be skipped.
 */
export function withoutPicks(picks, drop) {
  const source = Array.isArray(picks) ? picks : []
  const ids = new Set([...(drop || [])].map((id) => pickId(id)).filter(Boolean))
  if (!ids.size) return source
  return source.filter((pick) => !ids.has(pickId(pick)))
}

// ---- the row the homepage shows when the owner has chosen nothing ----------
//
// Four real catalogue styles, never two colourways of the same garment.
// `styleKey` drops the trailing " - Colour", so "Denim Shirt - Black" and
// "Denim Shirt - Blue" are one style and only the first colourway is a
// candidate. Selection runs purely over the live catalogue, so the row can
// never advertise a product the store does not have. Categories come from
// the client's own list, and any category that appears in the catalogue but
// is not in that list yet still gets a bucket, so no product can be skipped.
//
// The rule lives here, apart from the network, so it can be tested in plain
// Node — and so the homepage cannot drift away from it.

/** The design a card belongs to: its title without the trailing colour. */
export const styleKey = (title) => {
  const t = String(title ?? '')
  return t.includes(' - ') ? t.slice(0, t.lastIndexOf(' - ')) : t
}

/**
 * The derived Best Sellers row: one style per category, round-robin, so the
 * row always reads as Tops + Co-ord Sets + Dresses + one more.
 *
 * Every entry is a catalogue card, so each one carries its OWN product id and
 * opens its own product page (see src/lib/productLinks.js).
 */
export function derivedBestsellers(list, catKeys, n = 4) {
  const products = Array.isArray(list) ? list : []
  // One entry per style, grouped by category.
  const keys = [...new Set([...(catKeys || []), ...products.map((p) => p.type)])]
  const styleBuckets = keys.map((key) => {
    const first = new Map()
    for (const p of products) {
      if (p.type !== key) continue
      const k = styleKey(p.title)
      if (!first.has(k)) first.set(k, p)
    }
    return [...first.values()]
  })

  const out = []
  const seen = new Set()
  // Round-robin: every category gets one style before any category gets a
  // second, so the row always reads as Tops + Co-ord Sets + Dresses + one more.
  for (let round = 0; out.length < n && round < n; round++) {
    for (const bucket of styleBuckets) {
      const cand = bucket[round]
      if (!cand || seen.has(styleKey(cand.title))) continue
      seen.add(styleKey(cand.title))
      out.push(cand)
      if (out.length >= n) break
    }
  }
  return out
}

/**
 * The same list, but as the rows the table holds: the id and whether the
 * design is switched on. A design that was never switched off is switched on.
 */
export function normalizePickRows(picks) {
  const seen = new Set()
  const out = []
  for (const pick of Array.isArray(picks) ? picks : []) {
    const product_id = pickId(pick)
    if (!product_id || seen.has(product_id)) continue
    seen.add(product_id)
    out.push({ product_id, is_active: pickActive(pick) })
  }
  return out
}
