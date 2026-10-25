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

// Rows -> one entry per design, in input order. Nothing is merged on a guess
// and nothing is rewritten: every row arrives exactly as it was stored, with
// its own colour and its own title. What the entry ADDS is `name` — the design
// name with the " - Colour" suffix decoded — which is what every list, card
// and editor reads as the product's name (see `groupedCards` below).
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
 * The description as the page renders it.
 *
 * Line breaks inside the text are the owner's own and survive untouched —
 * `whitespace-pre-line` on the product page depends on them. Only the two
 * things a textarea leaves behind that are NOT description are removed: the
 * Windows line ending, and whitespace at the very start and end. A row whose
 * description is nothing but spaces then counts as having none at all, and
 * the page shows an empty block rather than a paragraph that looks broken.
 */
export const shownDescription = (value) => String(value ?? '').replace(/\r\n/g, '\n').trim()

/**
 * The badge a design shows.
 *
 * Like the description, the badge belongs to the design — the admin panel
 * writes it to every colour of a design at once — so the card shows the
 * first badge any of the design's rows carries. A design marked "Bestseller"
 * is never left without its badge because the row that happens to speak for
 * the card does not carry one.
 */
export const designBadge = (rows) => {
  const list = Array.isArray(rows) ? rows : []
  for (const row of list) {
    const badge = String(row?.badge ?? '').trim()
    if (badge) return row.badge
  }
  return null
}

/**
 * One design -> the single card the storefront shows.
 *
 * A design with no colour is returned untouched (its title, id and image stay
 * exactly as stored — there is no suffix to decode). A design that carries a
 * colour becomes ONE card; where several colours exist ONE row speaks for it:
 * the cheapest colour row.
 *
 * EVERY row-specific field on the card comes from that one row — its id, its
 * price, its photograph, its gallery, its sizes — so the card a shopper taps
 * always opens the product it shows, at the price it shows, in the sizes it
 * shows. That row is also the row the cart adds and the row
 * `create_order()` prices server-side, so all four always name the same row.
 * When every colour costs the same (the normal case) that row IS the first
 * one, so ids and prices are unchanged from before grouping existed.
 *
 * The card used to take its PHOTOGRAPH from the group's first row while
 * taking its id and price from the cheapest one. When a design's colours cost
 * different amounts the two rows are different, and the card then showed one
 * colour's photograph and opened another: the live "Denim Shirt" card showed
 * the black shirt (₹2,010) and opened the blue one. The card and the product
 * it opens are now always the same product.
 *
 * The description and the badge are the DESIGN's — the first colour row that
 * actually carries them — and the title loses the " - Colour" suffix so the
 * shopper sees the design, not one colourway of it.
 */
export function groupedCards(rows) {
  const out = []
  for (const { parts, rows: group } of groupRows(rows)) {
    const lead = group[0]
    // A row that names no colour IS the design — there is no suffix to decode,
    // so its stored title is already the name the shopper should read.
    if (!parts) { out.push(lead); continue }

    // ONE colour row still has a design name. The stored title is written as
    // "Design - Colour" (see src/lib/productForm.js `buildTitle`), and for
    // years that suffix was only decoded when a design had several colours to
    // choose between — so a design the owner had photographed in a single
    // colour showed the shopper "Maxi dress - Brown" where she had typed
    // "Maxi dress". The name is the design's in every case; only the choice
    // of a second colour is what makes a selector.
    //
    // The colour leaves the NAME but never the card: it is written back into
    // `colour` when the row does not already carry it, so the colour search,
    // the cart's colour line and the editor all still read the same value
    // they read before the suffix stopped being printed.
    if (group.length < 2) {
      out.push({ ...lead, title: parts.name, colour: lead.colour || parts.colour })
      continue
    }

    const priced = group.reduce(
      (best, r) => ((Number(r.price) || 0) < (Number(best.price) || 0) ? r : best),
      lead,
    )
    out.push({
      ...priced,
      title: parts.name,
      desc: designDescription(group),
      badge: designBadge(group),
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
