// The pure (network-free) rules behind client-editable categories.
//
// They live apart from `categories.js` so the rules can be unit-tested in
// plain Node without the Supabase client, and so every screen agrees on what
// a category key, a label and a duplicate actually are.
//
// The seed below is the SAME list src/data/products.js has always shipped
// (and the same four rows the migration writes): it is what the storefront
// renders while Supabase is unreachable or before
// supabase/migrations/20261019130000_client_editable_categories.sql has been
// applied, so the store never shows an empty category list.

import { TYPES } from '../data/products.js'

/** Mirrors the database: `categories.key ~ '^[a-z0-9][a-z0-9-]{0,38}$'`. */
export const CATEGORY_KEY_RE = /^[a-z0-9][a-z0-9-]{0,38}$/

/** Mirrors the database: `char_length(btrim(label)) between 1 and 60`. */
export const MAX_CATEGORY_LABEL = 60

/** The four categories the store launched with, in their original order and
 *  with their original labels — "Trousers & Pants" included, verbatim.
 *
 *  They carry the same fields a category row from the database carries: a
 *  photograph (none of these has one of its own yet), whether that photograph
 *  is switched on (it is), and the two-digit number the Product IDs of their
 *  products begin with (the database owns that, so the seed has none). */
export const SEED_CATEGORIES = TYPES.map((t, i) => ({
  key: t.key,
  label: t.label,
  position: i,
  image: null,
  image_active: true,
  code: null,
}))

/** A label as the store stores it: internal runs of space collapsed, trimmed,
 *  capped at the column's length. */
export const cleanLabel = (v) =>
  String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CATEGORY_LABEL)

/** The database key a label would produce: lower-cased, every run of
 *  non-alphanumerics folded into a single dash, edges trimmed — so "Trousers
 *  & Pants" is "trousers-pants" rather than a run of dashes. Returns '' when
 *  nothing usable is left (a name of only punctuation, say), which is the
 *  database's own answer too. */
export const categoryKey = (label) => {
  const clean = cleanLabel(label)
  const slug = clean
    .toLowerCase()
    // Runs of anything that is not a letter, digit or hyphen become a single
    // hyphen — so "&", punctuation and runs of space all collapse together,
    // and "Trousers & Pants" is "trousers-pants" rather than a run of dashes.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 39)
    .replace(/-+$/, '')
  // There must be a real letter or digit in the name, not just punctuation or
  // spaces — otherwise "!!!" or "   " would become a category of hyphens. The
  // test runs on the lower-cased name, or every ALL-CAPS name would be
  // refused while its lower-case twin was accepted.
  return (/[a-z0-9]/.test(clean.toLowerCase()) && CATEGORY_KEY_RE.test(slug)) ? slug : ''
}

/** The categories to show when the DATABASE answered.
 *
 *  The database is the truth on its own. The seed exists for a shop that has
 *  not reached the database yet — a migration not applied, a network that is
 *  down — and for a database that answers with nothing at all.
 *
 *  It is deliberately NOT merged in here. A category the owner has deleted in
 *  the admin panel has to disappear from the storefront as well: a filter
 *  that offers a category the shop has taken away opens a page with nothing
 *  on it. (The seed's "Night Wear" and "Kurta Sets" are two categories the
 *  client asked for by name and the shop does not stock — they must not be
 *  offered until they exist and hold something.)
 *
 *  The seed still stands in for a database that could not be reached; that is
 *  the caller's business, and it is decided where the read happens. */
export const categoriesFromDatabase = (rows) =>
  mergeCategories(Array.isArray(rows) ? rows : [], [])

/** The list to render a category picker from: exactly `list`, plus an option
 *  for `type` when the catalogue holds that category but the list does not.
 *
 *  That gap is real: `mergeCategories` drops a row it cannot match, so a
 *  product can carry a type no longer offered as a choice. Without this the
 *  option vanishes from the <select>, and a client editing such a product
 *  could silently reassign it to whichever category the browser showed by
 *  default. The name falls back to the raw key, which is what the rest of the
 *  store already shows for a category it has no label for. */
export const withTypeOption = (list, type) => {
  const out = Array.isArray(list) ? list : []
  const key = String(type ?? '')
  if (!key || out.some((c) => c && c.key === key)) return out
  return [...out, { key, label: key, position: 99 }]
}

/** How the store compares two labels for "is this the same category?": case,
 *  surrounding spaces and the difference between a hyphen and a space never
 *  make a second category — the same three things the database's unique index
 *  on `lower(btrim(label))` and the key derivation both fold away, so the UI
 *  can never allow what the database would then refuse. */
export const categoryLabelKey = (label) => cleanLabel(label).toLowerCase().replace(/-/g, ' ')

/** The category in `list` that already answers to this label — ignoring case,
 *  spacing and hyphenation — or null. Two rows are the same category either
 *  when their labels compare equal (see categoryLabelKey) or when their keys
 *  derive equal; both checks are needed because a category can be renamed
 *  without its key following. `skipKey` is the category being renamed, which
 *  is allowed to keep its own name.
 *
 *  An empty name is never a duplicate — not even of itself, which is the case
 *  `'' === ''` would otherwise make it — because the caller refuses an empty
 *  name outright. */
export const findDuplicate = (list, label, skipKey = '') => {
  const want = categoryLabelKey(label)
  if (!want) return null
  // `wantKey` is '' only for a name with nothing usable in it, which the empty
  // label test above already ruled out; the comparison is kept explicit so an
  // empty candidate can never match an unrelated row's empty key.
  const wantKey = categoryKey(label)
  return (Array.isArray(list) ? list : []).find(
    (c) => c
      && c.key !== skipKey
      && (categoryLabelKey(c.label) === want
        || (wantKey !== '' && c.key === wantKey)
        || (wantKey !== '' && categoryKey(c.label) === wantKey)),
  ) || null
}

/** The client's label for a category key — the key itself when the list has
 *  no answer, which is what the shop has always fallen back to. */
export const typeLabelOf = (list, key) =>
  (Array.isArray(list) ? list : []).find((c) => c && c.key === key)?.label || key

/** One list from two sources: whatever the database answered, then any seed
 *  category it does not yet hold (migration not applied, or Supabase
 *  unreachable). The database always wins on a key collision, duplicates by
 *  label are dropped, and the result is ordered by `position` with the seed
 *  order as the tie-break — so a re-run can never shuffle the storefront. */
export const mergeCategories = (rows, seed = SEED_CATEGORIES) => {
  const out = []
  const seenKeys = new Set()
  const seenLabels = new Set()
  const push = (r) => {
    const key = String(r?.key ?? '').trim()
    const label = cleanLabel(r?.label) || key
    const pos = Number(r?.position)
    if (!CATEGORY_KEY_RE.test(key) || !label) return
    const labelKey = categoryLabelKey(label)
    if (seenKeys.has(key) || seenLabels.has(labelKey)) return
    seenKeys.add(key)
    seenLabels.add(labelKey)
    // The photo the owner chose for this category travels with it — it is
    // part of the category, so the storefront's tiles and the admin panel
    // always see the same one. A row with no photo keeps the default.
    out.push({
      key,
      label,
      position: Number.isFinite(pos) ? pos : 99,
      image: String(r?.image ?? '').trim() || null,
      // The owner can switch a category's photograph off without losing it.
      // A row that says nothing about it is active — the category behaves
      // exactly as it did before the switch existed.
      image_active: r?.image_active !== false,
      // The category's own two-digit number, which the Product IDs of its
      // products begin with. It is not needed to render anything, but the
      // admin panel shows it, so it travels with the category.
      code: String(r?.code ?? '').trim() || null,
    })
  }
  for (const r of (Array.isArray(rows) ? rows : []).concat(Array.isArray(seed) ? seed : [])) push(r)
  return out.sort((a, b) => a.position - b.position)
}
