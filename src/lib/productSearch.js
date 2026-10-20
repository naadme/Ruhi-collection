// The ONE rule for "does this product match what the shopper typed".
//
// Both the results page (src/pages/Shop.jsx) and the header's live search
// (src/components/SearchBar.jsx) read it from here, so a query can never give
// two different answers depending on where it was typed — it used to: the
// header matched the whole phrase while the results page matched each word,
// so "royal blue" found "Royalblue" in one place and missed it in the other.
//
// What is searched
//   * the title and the design name,
//   * the category — both the stored key and the client's live label, so a
//     renamed category is found under its new name,
//   * the product id and the six-character SKU,
//   * the badge and the description of EVERY colour of the design (not just
//     the row the card happens to lead with),
//   * the colours themselves, from the grouped card's colour list *and* from
//     the row's own `colour` column. That second source matters: a row whose
//     title carries no " - Colour" suffix is never pooled, so it never gets a
//     `colors` array — searching "blue" used to miss every such product.
//
// Colour values are matched case-insensitively and without punctuation, so
// "Blue", "blue", "royal blue" and "Royalblue" are all found by any of their
// spellings. Nothing is stemmed or fuzzy-matched: a wrong word still finds
// nothing, which is what a shopper expects.

/** Lower-cased with every separator folded into a single space. */
const flat = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Lower-cased with every separator removed — "royal blue" -> "royalblue",
 *  so the two spellings of one colour can find each other. */
const squash = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** Everything one product is searchable by, as text. `colors` is the grouped
 *  card's list; the colour column and description of every member are folded
 *  in so a design is never half-searchable. */
export function searchWords(p) {
  if (!p) return ''
  const colours = Array.isArray(p.colors) ? p.colors.map((c) => c?.color) : []
  const descriptions = Array.isArray(p.colors)
    ? p.colors.map((c) => c?.desc ?? c?.description)
    : []
  return [
    p.title, p.type, p.id, p.sku, p.badge,
    p.colour, p.color, p.desc, p.description,
    ...colours, ...descriptions,
  ].filter(Boolean).join(' ')
}

/** The two normalised forms the matcher compares against. */
export function searchForms(p, typeLabel) {
  const label = typeof typeLabel === 'function' ? typeLabel(p?.type) : ''
  const all = [searchWords(p), label].filter(Boolean).join(' ')
  return { flat: flat(all), squashed: squash(all) }
}

/**
 * Does `p` match `query`?
 *
 * Every whitespace-separated word must match (so "blue dress" narrows, as it
 * always has), and an empty query matches everything — which is what restores
 * the normal listing when the search box is cleared.
 */
export function matchesProduct(p, query, typeLabel) {
  const q = flat(query)
  if (!q) return true
  const forms = searchForms(p, typeLabel)
  return q.split(/\s+/).filter(Boolean).every((tok) =>
    forms.flat.includes(tok) || forms.squashed.includes(squash(tok)))
}
