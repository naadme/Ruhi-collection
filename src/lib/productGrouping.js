// The catalogue's ONE rule for "which rows are the same design". Both the
// storefront (src/context/ProductsContext.jsx) and the admin dashboard read it
// from here, so the shop card a shopper sees and the group an admin manages can
// never disagree — there is deliberately no second grouping implementation.
//
// The data model stays what it always was: `products` is a flat table with one
// row per colour ("Stripes Dress - Pink"). A design's rows are tied together by
// their shared design name, carried in the title as a " - Colour" suffix, and —
// since the admin panel gained a colour field — by the row's `colour` column.
// Nothing is merged on a guess: a row only joins a design when its colour is
// known (explicit column or a colour word this catalogue actually uses), and
// designs never pool across categories, so a black shirt and a black dress can
// never become one product.

// Only these words appear in the client's own titles. They are the fallback
// for rows written before the `colour` column existed; a suffix outside this
// list is treated as part of the product name, which is why an unknown suffix
// can never group two unrelated rows.
export const COLOUR_WORDS = new Set([
  'Babypink', 'Beige', 'Black', 'Blue', 'Brown', 'Grey', 'Maroon',
  'Neon Green', 'Olive Green', 'Orange', 'Pink', 'Purple', 'Red',
  'Royalblue', 'Sky Blue', 'White', 'Yellow',
])

const clean = (v) => String(v ?? '').trim()

// "Stripes Dress - Pink" -> { name: 'Stripes Dress', colour: 'Pink' }.
// Anything without a real colour suffix returns null and is never grouped.
export const splitColour = (title) => {
  const t = String(title ?? '')
  const at = t.lastIndexOf(' - ')
  if (at < 0) return null
  const colour = t.slice(at + 3).trim()
  if (!COLOUR_WORDS.has(colour)) return null
  return { name: t.slice(0, at).trim(), colour }
}

// The same split WITHOUT the whitelist: any " - Suffix" is a colour. Used only
// to load a stored title into the admin editor and write it back unchanged —
// never to group, so a typo'd or novel colour can never pool two designs.
export const splitTitle = (title) => {
  const t = String(title ?? '')
  const at = t.lastIndexOf(' - ')
  if (at < 0) return null
  const colour = t.slice(at + 3).trim()
  if (!colour) return null
  return { name: t.slice(0, at).trim(), colour }
}

/** The colour a row carries FOR GROUPING: the explicit column first, then a
 *  whitelisted title suffix. Empty means "this row names no colour". */
export const groupingColour = (row) => clean(row?.colour) || splitColour(row?.title)?.colour || ''

/** The design a row belongs to, or null when it carries no colour (such a row
 *  gets a key only it can hold and is never pooled with anything). */
export const partsOf = (row) => {
  const colour = groupingColour(row)
  if (!colour) return null
  const title = String(row?.title ?? '')
  const suffix = ` - ${colour}`
  const name = title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title.trim()
  // A colour column without a matching suffix keeps the whole title as the
  // design name — the title is never thrown away to make a group fit.
  return { name: name || title.trim() || colour, colour }
}

// Rows -> one entry per design, in input order. A design with a single row is
// left exactly as it was — including the colour in its title, which would
// otherwise be thrown away with no swatch to show it.
export function groupRows(rows) {
  const buckets = new Map()
  ;(rows || []).forEach((row) => {
    if (!row) return
    const parts = partsOf(row)
    // A row with no colour suffix gets a key only it can hold, so it is never
    // pooled with anything else.
    const key = parts ? `${row.type}\u0000${parts.name}` : `\u0000${row.id}`
    if (!buckets.has(key)) buckets.set(key, { key, parts, rows: [] })
    buckets.get(key).rows.push(row)
  })
  return [...buckets.values()].map((g) => ({
    ...g,
    // Display name for the admin panel: the design name, or the full title for
    // a row that carries no colour.
    name: g.parts ? g.parts.name : String(g.rows[0]?.title ?? ''),
  }))
}

// ---- storefront card building ---------------------------------------------
// Moved verbatim out of src/context/ProductsContext.jsx so the card a shopper
// taps can be unit-tested beside the rule that groups it.

/**
 * The description a design shows.
 *
 * A design is ONE product with several colour rows, and the description is a
 * property of the design — but the description is stored on EVERY row, so the
 * rows can disagree. They do disagree when one row was edited on its own, or
 * when the row that happened to be opened had no description while another
 * did.
 *
 * Reading the first row's description blindly is what made the admin editor
 * show an empty box for a description that WAS saved, and made saving the form
 * write that empty text over every other colour's description. So the first
 * description that actually has text wins, and an empty one is only used when
 * every row is empty — which is what an owner who cleared it means.
 *
 * The same rule is used by the storefront card and by the editor, so the text
 * the owner wrote is exactly the text the shopper reads.
 */
export const designDescription = (rows) => {
  const list = Array.isArray(rows) ? rows : []
  for (const row of list) {
    const text = String(row?.desc ?? row?.description ?? '').trim()
    if (text) return row.desc ?? row.description ?? ''
  }
  return list.length ? String(list[0]?.desc ?? list[0]?.description ?? '') : ''
}

/**
 * One design -> the single card the storefront shows.
 *
 * A design with no colour, or only one row, is returned untouched (its title,
 * id and image stay exactly as stored — nothing to choose, so nothing to
 * rewrite). A design with several colours becomes ONE card: `title` loses the
 * " - Colour" suffix, `colors` carries every row verbatim — each with its own
 * id, image, gallery and price — and the card's own `id`/`price`/`compare` come
 * from the *cheapest* colour row: that is the price the card advertises, and
 * the id is the row the card opens on, the row the cart adds, and the row
 * `create_order()` prices server-side, so all three always name the same row.
 * When every colour costs the same (the normal case) that row *is* the first
 * one, so ids and prices are unchanged from before grouping existed.
 *
 * The description is the design's, not a colour's: it is the first one in the
 * group that actually has text. A design whose first colour row has no
 * description — and another colour does — used to show an empty description
 * on its page even though the admin had written one.
 */
export function groupedCards(rows) {
  const out = []
  for (const { parts, rows: group } of groupRows(rows)) {
    const lead = group[0]
    if (!parts || group.length < 2) { out.push(lead); continue }
    const priced = group.reduce(
      (best, r) => ((Number(r.price) || 0) < (Number(best.price) || 0) ? r : best),
      lead,
    )
    out.push({
      ...lead,
      id: priced.id,
      price: priced.price,
      compare: priced.compare,
      title: parts.name,
      desc: designDescription(group),
      colors: group.map((r) => ({ ...r, color: partsOf(r)?.colour || '' })),
    })
  }
  return out
}

/**
 * The variant a colour choice resolves to: the row the route's id names, else
 * the first colour, else null (a product with no colourways at all). Exact
 * semantics of the selector the product page has always used — a shared link
 * or old bookmark opens on the colour it names, anything else lands on the
 * first colour the catalogue holds.
 */
export const variantFor = (colors, id) =>
  (colors || []).find((c) => c.id === id) || (colors || [])[0] || null
