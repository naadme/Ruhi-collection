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
//   * the product's web address and its six-character Product ID,
//   * the badge and the description of EVERY colour of the design (not just
//     the row the card happens to lead with),
//   * the sizes the design and each of its colours are stocked in,
//   * the colours themselves, from the grouped card's colour list *and* from
//     the row's own `colour` column. That second source matters: a row whose
//     title carries no " - Colour" suffix is never pooled, so it never gets a
//     `colors` array — searching "blue" used to miss every such product.
//
// WHERE a search looks
// ---------------------
// A search looks at the WHOLE catalogue, never at one category or one size:
// searching "red" returns every product that is genuinely red, in every
// category and in every size it is stocked in. `matchesProducts` below is
// that one rule, and both the results page and the header's live search read
// it, so the two can never disagree.
//
// A WORD THAT IS A COLOUR IS TREATED AS A COLOUR
// ----------------------------------------------
// Searching "blue" must find the products that are actually blue — and only
// those. The old rule matched the word anywhere, so a product whose
// description merely mentioned "blue" came back for a colour search, and a
// product in "Navy Blue" came back for a search of "navy" even though its
// saved colour is "Blue". That is the difference between a colour filter and
// a word search, and the client asked for the filter.
//
// So a word that names one of the catalogue's own colours is matched against
// the SAVED colour only: the row's `colour` column, the colour of any of the
// design's variants, or the " - Colour" suffix of the title. It is never
// matched against a product name, description, badge or code. Every other
// word keeps the ordinary behaviour, so searching "denim" still finds a
// product that only says "denim" in its description.
//
// The colour list is the catalogue's own: the words the store has actually
// used, plus the two-word spellings ("royal blue" is one colour, not two).

/** Lower-cased with every separator folded into a single space. */
const flat = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Lower-cased with every separator removed — "royal blue" -> "royalblue",
 *  so the two spellings of one colour can find each other. */
const squash = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * The colours this catalogue knows about.
 *
 * The list is the one the catalogue itself groups by (src/lib/productGrouping.js
 * keeps the same words), plus the spellings a shopper would type. A colour
 * that is not on the list is treated as an ordinary word — so a product whose
 * saved colour is something new is still findable by its name, and the word is
 * simply not treated as a colour filter.
 */
export const COLOUR_WORDS = [
  'babypink', 'beige', 'black', 'blue', 'brown', 'grey', 'maroon', 'neon green',
  'olive green', 'orange', 'pink', 'purple', 'red', 'royalblue', 'royal blue',
  'sky blue', 'skyblue', 'white', 'yellow', 'lavender', 'green',
]

const COLOUR_SET = new Set(COLOUR_WORDS.map((c) => squash(c)))

/** Is this word (or word pair) the name of one of the catalogue's colours? */
export function isColourWord(word) {
  return COLOUR_SET.has(squash(word))
}

/** Everything one product is searchable by, as text. `colors` is the grouped
 *  card's list; the colour column, description and sizes of every member are
 *  folded in so a design is never half-searchable. */
export function searchWords(p) {
  if (!p) return ''
  const colours = Array.isArray(p.colors) ? p.colors.map((c) => c?.color) : []
  const descriptions = Array.isArray(p.colors)
    ? p.colors.map((c) => c?.desc ?? c?.description)
    : []
  // The sizes a design comes in, and the sizes each of its colours comes in:
  // a shopper who types "XL" wants the styles that are actually stocked in
  // XL, in whichever colour they are.
  const sizes = Array.isArray(p.sizes) ? p.sizes : []
  const variantSizes = Array.isArray(p.colors)
    ? p.colors.flatMap((c) => (Array.isArray(c?.sizes) ? c.sizes : []))
    : []
  return [
    p.title, p.type, p.id, p.sku, p.badge,
    p.colour, p.color, p.desc, p.description,
    ...sizes, ...variantSizes,
    ...colours, ...descriptions,
  ].filter(Boolean).join(' ')
}

/**
 * The identifiers a product answers to: its web address, its Product ID and
 * the address of every colour row it is made of.
 *
 * A Product ID typed in full finds that product — see `matchesProduct`.
 */
export function productIdentifiers(p) {
  if (!p) return []
  return [
    p.id,
    p.sku,
    ...(Array.isArray(p.colors) ? p.colors.map((c) => c?.id) : []),
  ].filter(Boolean)
}

/**
 * The colours a product actually comes in.
 *
 * Only SAVED colour data counts: the row's own `colour` column, the colour of
 * any of the design's variants, and the " - Colour" suffix of a title. A
 * colour that only appears in the prose of a description is not a colour the
 * product comes in.
 */
export function productColours(p) {
  if (!p) return []
  const out = []
  const add = (v) => {
    const colour = String(v ?? '').trim()
    if (colour) out.push(colour)
  }
  add(p.colour)
  add(p.color)
  if (Array.isArray(p.colors)) for (const c of p.colors) add(c?.color)
  // A title that ends in " - Colour" names its colour, whatever the columns
  // say — that is how the catalogue has always been written.
  const title = String(p.title ?? '')
  const at = title.lastIndexOf(' - ')
  if (at >= 0) add(title.slice(at + 3))
  return out
}

/** Does a saved colour value satisfy one colour term from the query? */
const matchesColour = (saved, term) => {
  const wanted = squash(term)
  const value = squash(saved)
  return !!wanted && (value === wanted || value.includes(wanted))
}

/**
 * Split a query into terms.
 *
 * Two adjacent words that together name one colour ("royal blue") are ONE
 * term, so neither of them is left to be matched as an ordinary word — which
 * is what would otherwise let a product that merely mentions "royal" in its
 * description come back for a colour search.
 */
export function queryTerms(query) {
  const q = flat(query)
  if (!q) return []
  const words = q.split(/\s+/).filter(Boolean)
  const terms = []
  for (let i = 0; i < words.length; i += 1) {
    if (i + 1 < words.length && isColourWord(`${words[i]} ${words[i + 1]}`)) {
      terms.push({ text: `${words[i]} ${words[i + 1]}`, colour: true })
      i += 1
      continue
    }
    terms.push({ text: words[i], colour: isColourWord(words[i]) })
  }
  return terms
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
 * Every term must match (so "blue dress" narrows, as it always has), and an
 * empty query matches everything — which is what restores the normal listing
 * when the search box is cleared.
 *
 * An identifier typed in full — the product's Product ID, its web address, or
 * the address of one of its colour rows — finds that product whatever else it
 * happens to spell: the owner filed a row as "Pink" and its file name still
 * says "red", and a shopper who copies that id down must still find it.
 */
export function matchesProduct(p, query, typeLabel) {
  const terms = queryTerms(query)
  if (!terms.length) return true
  const code = squash(query)
  if (code && productIdentifiers(p).some((c) => squash(c) === code)) return true
  const forms = searchForms(p, typeLabel)
  const colours = productColours(p).map((c) => squash(c))

  return terms.every(({ text, colour }) => {
    // A colour is a case-insensitive match against SAVED colour data only.
    // “blue” may match a saved “Sky Blue” variant, but never a product name
    // containing “blue” or unrelated copy that happens to mention blue.
    if (colour) {
      return colours.some((c) => matchesColour(c, text))
    }
    return forms.flat.includes(text) || forms.squashed.includes(squash(text))
  })
}

/**
 * The colours a query is asking for — used by the results page to say what
 * was searched for ("Blue") rather than only echoing the raw words.
 */
export function queryColours(query) {
  return queryTerms(query).filter((t) => t.colour).map((t) => t.text)
}

/**
 * The catalogue as the shopper asked for it.
 *
 * A SEARCH looks at the WHOLE catalogue. Searching "red" means every product
 * that is genuinely red — in every category, in every size it is stocked in —
 * and never "the red ones in the one category this page happened to be
 * showing". A category filter narrows the catalogue only when there is no
 * search: the two are two different ways of looking at the same shop, and the
 * search always wins, because a shopper who typed a word wants that word's
 * results and not a filtered subset of them.
 *
 * The rule lives here, next to the matcher it uses, so the results page, the
 * header's live search and the tests can never disagree about it.
 */
export function matchesProducts(products, { q = '', type = '', typeLabel } = {}) {
  const list = Array.isArray(products) ? products : []
  const query = String(q ?? '').trim()
  if (query) return list.filter((p) => matchesProduct(p, query, typeLabel))
  const category = String(type ?? '').trim()
  return category ? list.filter((p) => p.type === category) : list
}

/**
 * The cards a search should DISPLAY.
 *
 * A grouped design keeps one card, but a colour search must show the matching
 * colour's photo, price and link — not the design's default (often a totally
 * different colour). This is deliberately a projection after filtering: the
 * design remains one result, while tapping it opens the exact variant shown.
 */
export function searchResultProducts(products, { q = '', type = '', typeLabel } = {}) {
  const query = String(q ?? '').trim()
  const results = matchesProducts(products, { q: query, type, typeLabel })
  const wantedColours = queryTerms(query).filter((term) => term.colour)
  if (!wantedColours.length) return results

  return results.map((product) => {
    const variants = Array.isArray(product?.colors) ? product.colors : []
    const shown = variants.find((variant) =>
      wantedColours.every(({ text }) => matchesColour(variant?.color ?? variant?.colour, text)),
    )
    if (!shown) return product

    return {
      ...product,
      ...shown,
      // The shared design name is clearer than the raw row title, while the
      // id, photos, price and sizes all belong to the matching colour row.
      title: product.title,
      desc: product.desc,
      badge: product.badge,
      colors: product.colors,
    }
  })
}

/**
 * The address a NEW search goes to.
 *
 * A search covers the whole catalogue, so the category filter it would narrow
 * is left out — otherwise a shopper who searched from inside one category
 * would be shown that category only and would think the shop had nothing
 * else. The SORT is kept: sorting never hides a result, so it is not an
 * incompatible filter.
 *
 * The words are trimmed and keep the shopper's own spelling; matching is
 * case-insensitive either way.
 */
export function searchPath(query, { sort = '' } = {}) {
  const params = new URLSearchParams()
  const text = String(query ?? '').trim()
  if (text) params.set('q', text)
  const order = String(sort ?? '').trim()
  if (order) params.set('sort', order)
  const qs = params.toString()
  return qs ? `/shop?${qs}` : '/shop'
}
