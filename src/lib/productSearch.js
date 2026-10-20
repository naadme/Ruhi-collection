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
//   * the product id and the six-character Product ID,
//   * the badge and the description of EVERY colour of the design (not just
//     the row the card happens to lead with),
//   * the colours themselves, from the grouped card's colour list *and* from
//     the row's own `colour` column. That second source matters: a row whose
//     title carries no " - Colour" suffix is never pooled, so it never gets a
//     `colors` array — searching "blue" used to miss every such product.
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
// matched against the description, the badge or anything else. Every other
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

/**
 * The product's own names and codes — everything that IDENTIFIES it, and
 * nothing that merely describes it.
 *
 * A colour word is matched against this and against the saved colour. The
 * description is deliberately left out: a product whose description happens
 * to say "blue" is not a blue product, and the client asked for a colour
 * filter rather than a word search.
 */
export function searchIdentity(p, typeLabel) {
  if (!p) return ''
  const colours = Array.isArray(p.colors) ? p.colors.map((c) => c?.color) : []
  const label = typeof typeLabel === 'function' ? typeLabel(p?.type) : ''
  return [
    p.title, p.type, p.id, p.sku,
    p.colour, p.color,
    label,
    ...colours,
  ].filter(Boolean).join(' ')
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
 */
export function matchesProduct(p, query, typeLabel) {
  const terms = queryTerms(query)
  if (!terms.length) return true
  const forms = searchForms(p, typeLabel)
  const identity = searchIdentity(p, typeLabel)
  const identityFlat = flat(identity)
  const identitySquashed = squash(identity)
  const colours = productColours(p).map((c) => squash(c))

  return terms.every(({ text, colour }) => {
    // A word that names a colour is matched against the SAVED colour and the
    // product's own names and codes — never against its description.
    if (colour) {
      const wanted = squash(text)
      if (colours.some((c) => c === wanted || c.includes(wanted))) return true
      return identityFlat.includes(text) || identitySquashed.includes(wanted)
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
