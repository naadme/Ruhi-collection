// Everything the admin product editor computes, as pure functions: the form a
// row loads into, the payload a row saves as, and the plan that turns a whole
// product (one parent + its colour variants) into inserts/updates/deletes on
// the flat `products` table.
//
// Two rules hold the whole thing together:
//
//   1. ONE canonical shape. A stored row and the editor form are both
//      normalised into "row space" before anything is compared or written, so
//      rounding and defaults live in one place and a save can never rewrite a
//      column with a differently-rounded value.
//   2. WRITE ONLY WHAT CHANGED. A variant sends only the columns its own row
//      does not already hold, and shared product information (category,
//      description, sizes, badge, ratings) is sent only when the value the
//      parent actually changed — so editing one colour's price can never
//      quietly overwrite another colour's data.
//
// Colour lives in the title as a " - Colour" suffix (the format the storefront
// grouping in src/lib/productGrouping.js reads) and, going forward, in the
// row's `colour` column. The two are written together, so existing products
// keep their exact titles and URLs.

import { splitTitle } from './productGrouping.js'

export const SIZE_DEFAULT = ['S', 'M', 'L', 'XL']
/** Every size the store may offer, in display order. Each product picks its
 *  own subset — a product may stop at XL while another goes to 5XL. The
 *  `sizes` column is a free `text[]`, so nothing outside this list forces a
 *  product to carry a size it does not stock. */
export const SIZE_OPTIONS = ['S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL']
export const MAX_COLOUR_LENGTH = 40
/** Each colour of a product may carry at most this many photos. Fewer is
 *  fine — the gallery renders however many are on file. */
export const MAX_IMAGES_PER_COLOUR = 4

/** Toggle one size on/off, always returning the list in SIZE_OPTIONS order so
 *  a re-added size never lands at the end. Unknown sizes (a size stored by an
 *  older catalogue) are kept, after the known ones, never silently dropped. */
export const toggleSize = (sizes, size) => {
  const cur = Array.isArray(sizes) ? sizes : []
  const next = cur.includes(size) ? cur.filter((s) => s !== size) : [...cur, size]
  return [
    ...SIZE_OPTIONS.filter((s) => next.includes(s)),
    ...next.filter((s) => !SIZE_OPTIONS.includes(s)),
  ]
}

/** The photos on file for one colour, in display order (main image first),
 *  de-duped and capped at MAX_IMAGES_PER_COLOUR. Accepts the editor's
 *  `photos` list, or a stored row / mapped product (main + hover + gallery),
 *  so a row written before the gallery existed loads exactly as it renders. */
export const photosOf = (v) => {
  const raw = Array.isArray(v?.photos)
    ? v.photos
    : [v?.image, v?.hover, ...(Array.isArray(v?.gallery) ? v.gallery : [])]
  const out = []
  for (const u of raw) {
    const s = clean(u)
    if (s && !out.includes(s)) out.push(s)
    if (out.length >= MAX_IMAGES_PER_COLOUR) break
  }
  return out
}

const clean = (v) => String(v ?? '').trim()
export const trimOrNull = (v) => clean(v) || null

/** `takenIds` arrives from the dashboard as an array of every id in the
 *  catalogue; accept a Set too, since that is what the helpers build. */
const idList = (takenIds) => (Array.isArray(takenIds) ? takenIds : takenIds ? [...takenIds] : [])

/** Same comparator the write path uses to prove a row came back as sent. */
export const same = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b)) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  }
  if (typeof a === 'number' || typeof b === 'number') {
    return Number(a ?? 0) === Number(b ?? 0)
  }
  return (a ?? null) === (b ?? null)
}

/** URL fragment for a product: same rule the editor has always used. */
export const slug = (s) =>
  clean(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)

/** "Classic Shirt" + "Wine Red" -> "Classic Shirt - Wine Red" (the title format
 *  the storefront already understands); no colour keeps the plain name. */
export const buildTitle = (name, colour) => {
  const n = clean(name)
  const c = clean(colour)
  return c ? `${n} - ${c}` : n
}

/** The colour the EDITOR shows for a stored row: the column, else ANY
 *  " - Colour" suffix. Permissive on purpose — a colour saved in a title long
 *  before the column existed loads into the field, and saving writes back the
 *  exact same title, so editing a product can never lose its colour. */
export const colourOf = (row) => clean(row?.colour) || splitTitle(row?.title)?.colour || ''

/** The design name the editor shows: the title without its colour suffix. */
export const nameOf = (row) => {
  const title = clean(row?.title)
  const colour = colourOf(row)
  const suffix = ` - ${colour}`
  return colour && title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title
}

// ---- canonical row space ---------------------------------------------------

const money = (v) => (v === '' || v === null || v === undefined ? null : Math.max(0, Math.round(Number(v) || 0)))
const price = (v) => Math.max(0, Math.round(Number(v) || 0))
const rating = (v) => Math.round(Math.min(5, Math.max(0, Number(v) || 0)) * 10) / 10
const count = (v) => Math.max(0, Math.round(Number(v) || 0))

/** A stored row (mapped by ProductsContext, or a raw `products` row) in the
 *  shape every comparison below speaks. */
export const rowSpace = (row) => ({
  id: row.id,
  title: row.title ?? '',
  type: row.type ?? 'tops',
  price: price(row.price),
  compare: money(row.compare),
  rating: rating(row.rating),
  reviews: count(row.reviews),
  badge: trimOrNull(row.badge),
  sizes: Array.isArray(row.sizes) && row.sizes.length ? row.sizes : SIZE_DEFAULT,
  description: row.desc ?? row.description ?? '',
  image: trimOrNull(row.image),
  hover: trimOrNull(row.hover),
  is_active: row.is_active !== false,
  colour: trimOrNull(row.colour),
})

/** The parent-level fields, in row space. */
export const sharedSpace = (shared) => ({
  type: shared.type,
  description: shared.desc || '',
  sizes: Array.isArray(shared.sizes) && shared.sizes.length ? shared.sizes : SIZE_DEFAULT,
  badge: trimOrNull(shared.badge),
  rating: rating(shared.rating),
  reviews: count(shared.reviews),
})

const SHARED_KEYS = ['type', 'description', 'sizes', 'badge', 'rating', 'reviews']
const VARIANT_KEYS = ['title', 'price', 'compare', 'colour', 'is_active']

/** The variant-owned columns of one colour, in row space. Photos are handled
 *  separately in `updatePayload` — they are always written as one consistent
 *  set (main, hover and gallery together). */
export const variantSpace = (shared, variant) => ({
  id: clean(variant.id),
  title: buildTitle(shared.name, variant.colour),
  price: price(variant.price),
  compare: money(variant.compare),
  is_active: !!variant.is_active,
  colour: trimOrNull(variant.colour),
})

/** The parent fields that really differ from the lead row the form was loaded
 *  from. Only these travel to every colour's row; a parent whose shared
 *  section was not edited sends none of them. */
export const sharedUpdate = (lead, shared) => {
  const cur = rowSpace(lead)
  const nxt = sharedSpace(shared)
  const out = {}
  for (const k of SHARED_KEYS) if (!same(cur[k], nxt[k])) out[k] = nxt[k]
  return out
}

/** Full payload for a brand-new colour row (mirrors the create contract the
 *  editor has always sent, plus the colour). The main image is the first
 *  photo, the hover image the second, and the gallery carries every photo —
 *  written together so one colour can never show another colour's photo. */
export const createPayload = (shared, variant) => {
  const photos = photosOf(variant)
  return {
    id: clean(variant.id),
    title: buildTitle(shared.name, variant.colour),
    type: shared.type,
    price: price(variant.price),
    compare: money(variant.compare),
    rating: rating(shared.rating),
    reviews: count(shared.reviews),
    badge: trimOrNull(shared.badge),
    sizes: Array.isArray(shared.sizes) && shared.sizes.length ? shared.sizes : SIZE_DEFAULT,
    description: shared.desc || '',
    image: photos[0] || null,
    hover: photos[1] || null,
    colour: trimOrNull(variant.colour),
    is_active: !!variant.is_active,
    // A colour holding more than main + hover needs the gallery column; with
    // only the two classic photos the storefront's own fallback suffices,
    // exactly as before.
    ...(photos.length > 2 || variant.galleryDirty ? { gallery: photos } : {}),
  }
}

/** Only the columns THIS colour's row does not already hold, so an untouched
 *  product saves as no write at all and a divergent row is never overwritten
 *  with another colour's data. */
export const updatePayload = (shared, changedShared, variant) => {
  const cur = rowSpace(variant.original)
  const nxt = { ...changedShared, ...variantSpace(shared, variant) }
  const out = { id: clean(variant.id) }
  for (const k of Object.keys(nxt)) if (!same(cur[k], nxt[k])) out[k] = nxt[k]
  // Photos are written as ONE consistent set — main image, hover image and
  // gallery together, in the editor's order — and only when they really
  // changed, so editing a price never drops the extra photos of a colour and
  // a reorder can never leave `image` pointing at a photo the gallery no
  // longer holds first.
  const curPhotos = photosOf(variant.original)
  const nxtPhotos = photosOf(variant)
  if (!same(curPhotos, nxtPhotos)) {
    out.image = nxtPhotos[0] || null
    out.hover = nxtPhotos[1] || null
    out.gallery = nxtPhotos
  }
  return out
}

// ---- ids -------------------------------------------------------------------

/** First free id: "-2", "-3" … until the slug is unused. */
export const uniqueId = (base, taken) => {
  let id = base
  let n = 2
  while (taken.has(id)) id = `${base}-${n++}`
  return id
}

/** Give every new colour an id without touching locked ones: existing rows
 *  keep their id (existing links must keep working), a manually chosen id is
 *  honoured, and anything else is derived from product name + colour. */
export const withIds = (shared, variants, takenIds) => {
  const taken = new Set(idList(takenIds).map(clean).filter(Boolean))
  return variants.map((v) => {
    if (v.original) return v
    if (v.idTouched && clean(v.id)) {
      taken.add(clean(v.id))
      return v
    }
    const id = uniqueId(slug(buildTitle(shared.name, v.colour)), taken)
    taken.add(id)
    return { ...v, id }
  })
}

// ---- validation ------------------------------------------------------------

/** Every reason this form cannot be saved, in reading order. Empty list = go. */
export const validateForm = ({ shared, variants, takenIds }) => {
  const errors = []
  const live = variants.filter((v) => !v.removed)

  if (!clean(shared.name)) errors.push('Please enter a product name.')
  if (!live.length) {
    errors.push('A product needs at least one colour — undo the removal or add a colour before saving.')
  }

  const taken = new Set(idList(takenIds).map(clean).filter(Boolean))
  // A row this editor already owns holds its own id — that is not a clash.
  const owned = new Set(live.filter((v) => v.original).map((v) => clean(v.original.id)))
  const seenColours = new Map()
  const seenIds = new Set()

  live.forEach((v, i) => {
    const colour = clean(v.colour)
    const label = colour ? `“${colour}”` : `colour ${i + 1}`

    if (live.length > 1 && !colour) {
      errors.push(`Every colour needs a name — ${label} is empty. (A product with a single colour may leave it blank.)`)
    }
    if (/ - /.test(colour)) {
      errors.push(`${label}: please don't include “ - ” inside a colour name — it separates the product from its colour.`)
    }
    if (colour.length > MAX_COLOUR_LENGTH) {
      errors.push(`${label}: colour names may be up to ${MAX_COLOUR_LENGTH} characters.`)
    }
    if (colour) {
      const key = colour.toLowerCase()
      if (seenColours.has(key)) errors.push(`Two colours are named “${colour}” — each colour of a product must be different.`)
      else seenColours.set(key, i)
    }

    if (!(Number(v.price) >= 0)) {
      errors.push(`${label}: please enter a valid price.`)
    }

    // `photosOf` deliberately truncates to the cap for display, so a too-long
    // list is checked here against the raw editor input: the fifth photo must
    // never be dropped silently on save.
    const rawPhotos = Array.isArray(v.photos)
      ? [...new Set(v.photos.map(clean).filter(Boolean))]
      : photosOf(v)
    if (rawPhotos.length > MAX_IMAGES_PER_COLOUR) {
      errors.push(`${label}: a colour may carry up to ${MAX_IMAGES_PER_COLOUR} photos — remove one before saving.`)
    }

    const id = clean(v.id)
    if (!id) {
      errors.push(`${label}: it has no product ID yet — enter a product name first.`)
    } else if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      errors.push(`${label}: the product ID may only contain lowercase letters, numbers and dashes.`)
    } else if (seenIds.has(id)) {
      errors.push(`Two colours share the product ID “${id}” — each colour needs its own.`)
    } else if (taken.has(id) && !owned.has(id)) {
      errors.push(`The product ID “${id}” is already used by another product — change it or leave it blank to derive one.`)
    }
    seenIds.add(id)
  })

  return errors
}

// ---- save plan -------------------------------------------------------------

/** Turn the editor's form into the writes that make the database match it:
 *  inserts for new colours, updates carrying only changed columns, deletes for
 *  colours the client removed. Shared parent fields ride on every update, but
 *  only the ones that actually differ from the lead row. */
export const buildPlan = ({ shared, variants, takenIds, lead }) => {
  const ids = withIds(shared, variants, takenIds)
  const changedShared = lead ? sharedUpdate(lead, shared) : {}
  const creates = []
  const updates = []
  const deletes = []

  for (const v of ids) {
    if (v.removed) {
      if (v.original) deletes.push(clean(v.original.id))
      continue
    }
    if (!v.original) {
      creates.push(createPayload(shared, v))
      continue
    }
    const payload = updatePayload(shared, changedShared, v)
    if (Object.keys(payload).length > 1) updates.push({ id: payload.id, payload })
  }
  return { creates, updates, deletes }
}

// ---- form construction -----------------------------------------------------

export const blankShared = (type) => ({
  name: '',
  type,
  desc: '',
  sizes: [...SIZE_DEFAULT],
  badge: '',
  rating: 0,
  reviews: 0,
})

export const blankVariant = (key) => ({
  key,
  original: null,
  id: '',
  idTouched: false,
  colour: '',
  price: '',
  compare: '',
  photos: [],
  galleryDirty: false,
  is_active: true,
  removed: false,
})

export const variantFromRow = (row, key) => ({
  key,
  original: row,
  id: clean(row.id),
  idTouched: true, // locked: existing links must keep working
  colour: colourOf(row),
  price: row.price ?? '',
  compare: row.compare ?? '',
  // Main + hover + any extra gallery photos, in display order. A row written
  // before the gallery column existed loads as just main + hover.
  photos: photosOf(row),
  galleryDirty: false,
  is_active: row.is_active !== false,
  removed: false,
})

export const sharedFromRow = (row) => ({
  name: nameOf(row),
  type: row.type ?? 'tops',
  desc: row.desc ?? row.description ?? '',
  sizes: Array.isArray(row.sizes) && row.sizes.length ? [...row.sizes] : [...SIZE_DEFAULT],
  badge: row.badge ?? '',
  rating: row.rating ?? 0,
  reviews: row.reviews ?? 0,
})

/** Editor form for a group of rows (one product with its colours), or a blank
 *  one for a brand-new product. The shared section is read from the lead row —
 *  the first colour of the design. */
export const groupForm = (rows, fallbackType) =>
  rows && rows.length
    ? {
        shared: sharedFromRow(rows[0]),
        variants: rows.map((r, i) => variantFromRow(r, `${clean(r.id) || 'row'}-${i}`)),
      }
    : { shared: blankShared(fallbackType), variants: [blankVariant('v0')] }
