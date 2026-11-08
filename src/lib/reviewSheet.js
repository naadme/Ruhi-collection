// Reviews uploaded from a sheet: the template the owner fills in, and the
// checks every row goes through before anything is stored.
//
// Customers send their reviews on WhatsApp, Instagram, by phone or in the
// shop. The owner puts them in a sheet, one row per review, and uploads it in
// Admin → Reviews. This module is pure (no network, no DOM): it reads the
// sheet's rows, matches each to a product, and says per row what will be
// stored, what needs a look, and what cannot be added. The database checks
// everything again (supabase/migrations/20261108120000_review_sheet_import.sql,
// `import_reviews`), so these checks are for her, in words she can act on.
//
// Every uploaded review lands as pending and unverified. Nothing here can
// publish a review or mark it "Verified purchase".

import { buildWorkbook } from './xlsx.js'
import { REVIEW_LIMITS, CHANNELS, mobileDigits, reviewerLabel } from './reviews.js'

export const SITE = 'https://www.ruhi-collections.com'
export const MAX_ROWS = 500

export const IMPORT_LIMITS = {
  MAX_CITY: 60,
  MAX_STATE: 60,
  MAX_SIZE: 20,
  MAX_ORDER_REF: 40,
  MAX_NOTE: 500,
}

/**
 * The template's columns, in order. `aliases` are other headings that mean the
 * same thing, so a sheet the owner already has (with her own headings and
 * extra columns) can be uploaded as it is. Headings are compared without
 * case, spaces, punctuation or anything in brackets.
 */
export const SHEET_COLUMNS = [
  {
    key: 'product', header: 'Product link or ID', required: true, shown: false, width: 46,
    help: 'Copy the product’s link from the website, or its Product ID (e.g. 0101BL) from the Products tab. It picks the exact colour. Your own sheet may name the product instead (a "Product" or "Product name" column): the link wins when a row has both, and a review matched only by its name is flagged for you to check.',
    aliases: ['productlink', 'producturl', 'productid', 'productlinkorid', 'link', 'url', 'sku', 'websitelink', 'productpage', 'variantid', 'variant'],
  },
  {
    key: 'rating', header: 'Stars', required: true, shown: true, width: 8,
    help: 'A whole number from 1 to 5. Include the lower ratings too.',
    aliases: ['stars', 'star', 'rating', 'starrating', 'ratings'],
  },
  {
    key: 'body', header: 'Review', required: true, shown: true, width: 60,
    help: `The customer’s own words, as she sent them. Small typo fixes are fine. ${REVIEW_LIMITS.MIN_BODY} to ${REVIEW_LIMITS.MAX_BODY} characters.`,
    aliases: ['review', 'reviewtext', 'text', 'comment', 'comments', 'feedback', 'message', 'customerreview'],
  },
  {
    key: 'title', header: 'Review title', required: false, shown: true, width: 24,
    help: `Optional headline, e.g. "Loved the fit". Up to ${REVIEW_LIMITS.MAX_TITLE} characters.`,
    aliases: ['reviewtitle', 'title', 'headline', 'reviewheadline'],
  },
  {
    key: 'name', header: 'Reviewer name', required: false, shown: true, width: 20,
    help: 'Only if the customer agreed to her name being shown. Leave it empty otherwise: the site then shows "Verified Buyer" once you mark the review verified, or "Shopper from <city>" until then.',
    aliases: ['reviewername', 'name', 'customername', 'customer', 'reviewer', 'buyername', 'nametoshow', 'displayname'],
  },
  {
    key: 'city', header: 'City', required: false, shown: true, width: 16,
    help: 'Optional. Shown with the review.',
    aliases: ['city', 'town', 'reviewercity', 'customercity'],
  },
  {
    key: 'state', header: 'State', required: false, shown: true, width: 16,
    help: 'Optional. Shown with the review.',
    aliases: ['state', 'reviewerstate', 'customerstate'],
  },
  {
    key: 'size', header: 'Size bought', required: false, shown: true, width: 12,
    help: 'Optional, e.g. M. Shown with the review.',
    aliases: ['sizebought', 'size', 'sizeboard', 'sizepurchased', 'sizeordered'],
  },
  {
    key: 'colour', header: 'Colour bought', required: false, shown: true, width: 14,
    help: 'Optional. The colour comes from the product link; fill this only to check it, or to pick another colour of the same design.',
    aliases: ['colourbought', 'colorbought', 'colour', 'color', 'colourboard', 'colorboard', 'colourpurchased', 'colorpurchased'],
  },
  {
    key: 'date', header: 'Date received', required: false, shown: true, width: 14,
    help: 'The day the customer sent the review, e.g. 03/11/2026 (day/month/year). Shown as the review date. Empty means the day you upload.',
    aliases: ['datereceived', 'date', 'reviewdate', 'receivedon', 'datesent', 'reviewedon', 'receiveddate'],
  },
  {
    key: 'phone', header: 'Customer mobile (private)', required: false, shown: false, width: 18,
    help: 'Never shown on the site. Used to find her website orders when you check the review.',
    aliases: ['customermobile', 'mobile', 'phone', 'phonenumber', 'mobilenumber', 'customerphone', 'customerphonenumber', 'customermobilenumber', 'whatsappnumber', 'contactnumber', 'contact'],
  },
  {
    key: 'orderRef', header: 'Order number (private)', required: false, shown: false, width: 16,
    help: 'Optional. Never shown on the site.',
    aliases: ['ordernumber', 'orderid', 'orderno', 'order', 'orderref', 'orderreference'],
  },
  {
    key: 'channel', header: 'Received via (private)', required: false, shown: false, width: 16,
    help: `Optional: ${CHANNELS.map(([, label]) => label).join(', ')}. Never shown on the site.`,
    aliases: ['receivedvia', 'channel', 'source', 'via', 'receivedthrough', 'medium', 'platform'],
  },
  {
    key: 'note', header: 'Note (private)', required: false, shown: false, width: 30,
    help: `Optional note to yourself, up to ${IMPORT_LIMITS.MAX_NOTE} characters. Never shown on the site.`,
    aliases: ['note', 'notes', 'adminnote', 'notetoself', 'remarks', 'remark', 'internalnote'],
  },
]

/** A "Location" column ("Hyderabad, Telangana") is read as city and state. */
const LOCATION_ALIASES = ['location', 'place', 'citystate', 'reviewerlocation', 'customerlocation']

/**
 * Every heading that can say which product a review is for, by how sure it
 * is. A row is matched by the first of these that finds a product, in this
 * order: a link, then a Product ID, then a design ID, then a name. Customers
 * call a product whatever they like, so a name is the last resort.
 */
const PRODUCT_KINDS = [
  ['link', ['productlinkorid', 'productlink', 'producturl', 'link', 'url', 'websitelink', 'productpage']],
  ['id', ['productid', 'sku', 'variantid', 'variant']],
  ['design', ['designid']],
  ['name', ['product', 'productname', 'productstyle', 'style', 'item', 'itemname', 'design', 'designname', 'productbought', 'productordered', 'dress']],
]
const PRODUCT_RANK = Object.fromEntries(PRODUCT_KINDS.map(([kind], i) => [kind, i]))
const productKind = (key) => (PRODUCT_KINDS.find(([, keys]) => keys.includes(key)) || [])[0] || ''

/** A heading reduced to what matters: "Stars (1-5) *" -> "stars". */
export const headerKey = (header) =>
  String(header ?? '')
    .replace(/\([^)]*\)/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/**
 * Which column of the sheet holds what. Unknown headings are listed as
 * `ignored`; a heading that repeats one already found is ignored too.
 *
 * The product is the exception: every column that can name it is kept, in
 * `products` ([{ index, kind, header }], surest first), and `columns.product`
 * is the surest of them.
 */
export function mapHeaders(headerRow = []) {
  const columns = {}
  const ignored = []
  const products = []
  ;(Array.isArray(headerRow) ? headerRow : []).forEach((header, index) => {
    const key = headerKey(header)
    if (!key) return
    const kind = productKind(key)
    if (kind) {
      products.push({ index, kind, header: String(header).trim() })
      return
    }
    const spec = SHEET_COLUMNS.find((c) => c.aliases.includes(key) || headerKey(c.header) === key)
    const field = spec ? spec.key : LOCATION_ALIASES.includes(key) ? 'location' : ''
    if (!field || field in columns) {
      ignored.push(String(header).trim())
      return
    }
    columns[field] = index
  })
  products.sort((a, b) => PRODUCT_RANK[a.kind] - PRODUCT_RANK[b.kind] || a.index - b.index)
  if (products.length) columns.product = products[0].index
  const missing = SHEET_COLUMNS.filter((c) => c.required && !(c.key in columns)).map((c) => c.header)
  return { columns, ignored, missing, products }
}

/** The first sheet that has the three required columns: "Reviews" when the
 *  owner uses the template, otherwise whichever of hers has them. */
export function pickSheet(sheets = []) {
  const list = Array.isArray(sheets) ? sheets : []
  const fits = (s) => {
    const headerAt = headerRowIndex(s.rows)
    return headerAt >= 0 && mapHeaders(s.rows[headerAt]).missing.length === 0
  }
  return list.find((s) => /^reviews?$/i.test(String(s.name).trim()) && fits(s))
    || list.find(fits)
    || list[0]
    || null
}

/** The header is the first row with anything in it (a title line above the
 *  headings is skipped when the next row is the real header). */
export function headerRowIndex(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  for (let i = 0; i < Math.min(list.length, 10); i += 1) {
    if ((list[i] || []).some((c) => String(c ?? '').trim())) {
      if (mapHeaders(list[i]).missing.length === 0) return i
      const next = list[i + 1]
      if (next && mapHeaders(next).missing.length === 0) return i + 1
      return i
    }
  }
  return -1
}

// ---- reading one cell ------------------------------------------------------

const clean = (v) => String(v ?? '').replace(/\r\n/g, '\n').trim()
const squash = (v) => clean(v).toLowerCase().replace(/[^a-z0-9]/g, '')

/** Words that mean "no name" in a name column. */
const NO_NAME_WORDS = new Set(['', 'na', 'nil', 'none', 'null', 'unknown', 'anonymous', 'anon', 'noname', 'notgiven'])

/** "5", "4 stars", "5/5", "★★★★" -> 1..5; anything else -> null. */
export function parseStars(value) {
  const text = clean(value)
  const glyphs = (text.match(/[★⭐]/g) || []).length
  if (glyphs) return glyphs >= 1 && glyphs <= 5 ? glyphs : null
  const m = text.match(/^([1-5])(?:\.0+)?\s*(?:\/\s*5|out of 5|stars?)?$/i)
  return m ? Number(m[1]) : null
}

const pad = (n) => String(n).padStart(2, '0')
const isoDate = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return ''
  return `${y}-${pad(m)}-${pad(d)}`
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const monthNumber = (word) => MONTHS.indexOf(String(word).slice(0, 3).toLowerCase()) + 1
const fullYear = (y) => (String(y).length === 2 ? 2000 + Number(y) : Number(y))

/**
 * A date as the owner might type it, to 'YYYY-MM-DD':
 *   * an Excel day number (a date typed into Excel is stored as one);
 *   * 03/11/2026, 3-11-26, 3.11.2026 — day first, the Indian way;
 *   * 2026-11-03;
 *   * 3 Nov 2026, 3-Nov-26, Nov 3, 2026.
 * '' for an empty cell; null for something that is not a date.
 */
export function parseSheetDate(value) {
  const text = clean(value)
  if (!text) return ''
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text))
    if (serial < 20000 || serial > 80000) return null
    const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
    return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()) || null
  }
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/)
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3])) || null
  m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), fullYear(m[3])]
    // Day first. "11/23/2026" cannot be day-first, so it is read month-first.
    return isoDate(y, mo, d) || (mo > 12 && d <= 12 ? isoDate(y, d, mo) : '') || null
  }
  m = text.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})\.?,?[\s-]+(\d{2}|\d{4})$/i)
  if (m && monthNumber(m[2])) return isoDate(fullYear(m[3]), monthNumber(m[2]), Number(m[1])) || null
  m = text.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i)
  if (m && monthNumber(m[1])) return isoDate(Number(m[3]), monthNumber(m[1]), Number(m[2])) || null
  return null
}

/** A mobile number cell: Excel may hand it over as 9876543210, 9.87654321E+9
 *  or "+91 98765 43210". Returns { digits, problem }. A cell with no digits
 *  at all ("NA") counts as empty. */
export function parsePhone(value) {
  let text = clean(value)
  if (/^\d(\.\d+)?e\+\d+$/i.test(text)) text = Number(text).toFixed(0)
  const digits = mobileDigits(text)
  if (!digits) return { digits: '', problem: '' }
  if (/^[6-9]\d{9}$/.test(digits)) return { digits, problem: '' }
  if (digits.length >= 8 && digits.length <= 15 && digits.length !== 10) return { digits, problem: '' }
  return { digits: '', problem: 'The mobile number does not look right. Fix it or clear the cell.' }
}

/** "Whatsapp msg", "insta DM", "called her" … -> a known channel. */
export function parseChannel(value) {
  const t = squash(value)
  if (!t) return { channel: '', unknown: false }
  if (t.includes('whats') || t === 'wa') return { channel: 'whatsapp', unknown: false }
  if (t.includes('insta') || t === 'ig') return { channel: 'instagram', unknown: false }
  if (t.includes('call') || t.includes('phone')) return { channel: 'phone', unknown: false }
  if (t.includes('store') || t.includes('shop') || t.includes('offline') || t.includes('person') || t.includes('exhibition')) {
    return { channel: 'in_store', unknown: false }
  }
  if (t.includes('mail')) return { channel: 'email', unknown: false }
  if (t === 'other') return { channel: 'other', unknown: false }
  return { channel: 'other', unknown: true }
}

const SIZE_WORDS = {
  xs: 'XS', extrasmall: 'XS', s: 'S', small: 'S', m: 'M', medium: 'M', l: 'L', large: 'L',
  xl: 'XL', extralarge: 'XL', xlarge: 'XL', xxl: 'XXL', '2xl': 'XXL', xxxl: 'XXXL', '3xl': 'XXXL',
  freesize: 'Free Size', free: 'Free Size',
}

/** "medium" -> "M"; anything else trimmed and kept as typed. */
export const normaliseSize = (value) => {
  const text = clean(value)
  return SIZE_WORDS[squash(text)] || text
}

// ---- products --------------------------------------------------------------

/** A row's design name: its title without the " - Colour" ending. */
export const designName = (p) => {
  const title = clean(p?.title)
  const colour = clean(p?.colour)
  const suffix = colour ? ` - ${colour}`.toLowerCase() : ''
  return suffix && title.toLowerCase().endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title
}

/** A name to compare by: "Fit & Flare" and "fit and flare" are the same. */
const nameKey = (v) => squash(clean(v).replace(/&/g, ' and '))

/** Words that tell one product from another: lower case, no little words,
 *  no colours (those pick the colour, not the product), no plural "s". */
const LITTLE_WORDS = new Set(['and', 'with', 'the', 'a', 'an', 'of', 'for', 'in', 'my', 'her', 'this', 'that', 'one', 'piece', 'ruhi'])
export function nameWords(text, colourWords = new Set()) {
  return new Set(
    clean(text).toLowerCase().replace(/\bt[\s-]?shirt/g, 'tshirt').split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !LITTLE_WORDS.has(w) && !colourWords.has(w))
      .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)),
  )
}

/** Products by web address (the id in /product/<id>), by Product ID, by full
 *  title ("Denim Shirt - Black") when no two rows share it, and by design. */
export function indexCatalogue(products = []) {
  const byId = new Map()
  const bySku = new Map()
  const byTitle = new Map()
  const byDesign = new Map()
  const colourWords = new Set()
  for (const p of Array.isArray(products) ? products : []) {
    if (!p?.id) continue
    byId.set(String(p.id).toLowerCase(), p)
    if (p.sku) bySku.set(String(p.sku).trim().toUpperCase(), p)
    const t = squash(p.title)
    if (t) byTitle.set(t, byTitle.has(t) ? null : p)
    const design = designOf(p)
    if (!byDesign.has(design)) byDesign.set(design, [])
    byDesign.get(design).push(p)
    for (const w of clean(p.colour).toLowerCase().split(/[^a-z0-9]+/)) if (w) colourWords.add(w)
  }
  // One entry per design: its name, the words in it, and its colour rows.
  const designs = [...byDesign.values()].map((rows) => {
    const name = designName(rows[0])
    return { name, key: nameKey(name), words: nameWords(name, colourWords), rows }
  })
  return { byId, bySku, byTitle, byDesign, designs, colourWords }
}

/** The design a colour row belongs to: its stored design ID, else itself. */
export const designOf = (p) => String(p?.design_id || p?.id || '')

/** A product link or Product ID as typed into the sheet -> the colour row. */
export function findProduct(catalogue, value) {
  const text = clean(value)
  if (!text) return null
  const sku = text.toUpperCase()
  if (catalogue.bySku.has(sku)) return catalogue.bySku.get(sku)
  // A link, even with words around it ("bought this https://…/product/x ").
  const linked = text.match(/\/product\/([^\s?#/]+)/i)
  let slug = linked ? linked[1] : text.split(/[?#]/)[0].replace(/\/+$/, '')
  slug = slug.trim()
  try { slug = decodeURIComponent(slug) } catch { /* keep as typed */ }
  return catalogue.byId.get(slug.toLowerCase()) || catalogue.byTitle.get(squash(text)) || null
}

const colourOf = (p) => clean(p?.colour) || ''

const short = (v) => (v.length > 70 ? `${v.slice(0, 67)}…` : v)

/**
 * The colour row a review is about, from one design's rows (or, when two
 * designs share a name, both designs' rows): the only one; the one the Colour
 * column names; or the one whose colour the product's own words name ("blue
 * floral dress"). Two rows of the same colour cannot be told apart, and the
 * answer says which Product IDs to choose from. Returns { product } or
 * { problem }.
 */
export function pickColour(rows, colourHint = '', text = '') {
  const list = (rows || []).filter(Boolean)
  if (list.length === 1) return { product: list[0] }
  const name = designName(list[0])
  const choose = (matches, colour) => (matches.length === 1
    ? { product: matches[0] }
    : { problem: `${name} in ${colour} is more than one product on the site (Product IDs ${matches.map((p) => p.sku || p.id).join(', ')}). Add the product link or the Product ID.` })
  const hint = squash(colourHint)
  if (hint) {
    const named = list.filter((p) => squash(colourOf(p)) === hint)
    if (named.length) return choose(named, colourOf(named[0]))
  }
  const words = squash(text)
  const inText = list
    .filter((p) => squash(colourOf(p)) && words.includes(squash(colourOf(p))))
    .sort((a, b) => squash(colourOf(b)).length - squash(colourOf(a)).length)
  if (inText.length) {
    const colour = squash(colourOf(inText[0]))
    return choose(inText.filter((p) => squash(colourOf(p)) === colour), colourOf(inText[0]))
  }
  const colours = [...new Set(list.map(colourOf).filter(Boolean))]
  return {
    problem: `${name} comes in ${colours.join(', ')}${hint ? `, not “${clean(colourHint)}”` : ''}. Add the colour bought, or the product link.`,
  }
}

/**
 * A product named the way a customer or the owner wrote it. In order:
 *   * the exact title, link or Product ID;
 *   * the design's exact name, with or without its colour;
 *   * the design whose name shares the most words with it, when one clearly
 *     wins (`loose: true`, so the owner checks it).
 * Returns { product, loose } or { problem, closest }.
 */
export function matchByName(catalogue, text, colourHint = '') {
  const exact = findProduct(catalogue, text)
  if (exact) return { product: exact, loose: false }
  const key = nameKey(text)
  for (const d of catalogue.designs || []) {
    const row = d.rows.find((p) => key === nameKey(`${d.name} ${colourOf(p)}`) || key === nameKey(`${colourOf(p)} ${d.name}`))
    if (row) return { product: row, loose: false }
  }
  // The design's own name. Two designs may share one ("Embroidery coord set"):
  // then the colour has to tell them apart.
  const same = (catalogue.designs || []).filter((d) => d.key === key)
  if (same.length) {
    const pick = pickColour(same.flatMap((d) => d.rows), colourHint, text)
    return pick.problem ? { problem: pick.problem } : { product: pick.product, loose: false }
  }
  // Mostly: how many of HER words the design's name has ("the floral midi
  // dress" -> all three are in "Floral printed fit & flare midi dress"); a
  // little: how much of the design's name she covered, so a short name that
  // fits every dress ("dress") never picks one on its own.
  const words = nameWords(text, catalogue.colourWords)
  const scored = (catalogue.designs || [])
    .map((d) => {
      let shared = 0
      for (const w of words) if (d.words.has(w)) shared += 1
      const ofHers = words.size ? shared / words.size : 0
      const ofDesign = d.words.size ? shared / d.words.size : 0
      return { d, score: 0.7 * ofHers + 0.3 * ofDesign }
    })
    .sort((a, b) => b.score - a.score)
  const [best, second] = scored
  if (best && best.score >= 0.6 && (!second || best.score - second.score >= 0.15)) {
    const pick = pickColour(best.d.rows, colourHint, text)
    return pick.problem ? { problem: pick.problem } : { product: pick.product, loose: true }
  }
  return { closest: scored.filter((x) => x.score >= 0.3).slice(0, 2).map((x) => x.d.name) }
}

/**
 * Which product a row is about. `cells` are the row's product cells, surest
 * first (link, Product ID, design ID, name), empty ones left out; the first
 * that finds a product wins. Returns { product, by, problems, warnings, notes }.
 */
export function resolveProduct(catalogue, cells = [], colourHint = '') {
  const warnings = []
  const notes = []
  const missed = []
  let closest = []
  for (const { kind, header, value } of cells) {
    let product = null
    if (kind === 'link' || kind === 'id') {
      product = findProduct(catalogue, value)
    } else if (kind === 'design') {
      const rows = catalogue.byDesign.get(clean(value)) || catalogue.byDesign.get(clean(value).toUpperCase())
      if (rows) {
        const pick = pickColour(rows, colourHint, '')
        if (pick.problem) return { product: null, by: kind, problems: [pick.problem], warnings, notes }
        product = pick.product
      }
    } else {
      const byName = matchByName(catalogue, value, colourHint)
      if (byName.problem) return { product: null, by: kind, problems: [byName.problem], warnings, notes }
      product = byName.product || null
      closest = byName.closest || closest
      if (product && byName.loose) {
        warnings.push(`Matched “${short(value)}” to ${designName(product)} by its name. Check it is the right product.`)
      } else if (product && !missed.length) {
        notes.push(`Matched by the product name (${header}).`)
      }
    }
    if (product) {
      if (missed.length) warnings.push(`${missed.join(' and ')} matches no product, so the ${header} column was used instead. Check it.`)
      return { product, by: kind, problems: [], warnings, notes }
    }
    missed.push(`The ${header} “${short(value)}”`)
  }
  if (!cells.length) return { product: null, by: '', problems: ['No product link, Product ID or product name.'], warnings, notes }
  const hint = closest.length ? ` Closest: ${closest.join(' or ')}.` : ''
  return {
    product: null,
    by: '',
    problems: [`No product matches ${missed.map((m) => m.replace(/^The /, 'the ')).join(' or ')}.${hint} Add the product link from the website, or the Product ID from the Products tab.`],
    warnings,
    notes,
  }
}

/** Words a review is compared by, so the same review uploaded twice — or
 *  already in the panel — is caught even with different spacing or commas. */
export const sameWords = (body) => clean(body).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

// ---- the rows --------------------------------------------------------------

/**
 * Check every row of the sheet.
 *
 *   rows       the sheet's rows, header first (string[][])
 *   products   every product row (the admin's catalogue)
 *   existing   reviews already in the database, for duplicates
 *   orders     the shop's orders, to say when a mobile matches one
 *   isPaid     which orders count as purchases
 *   today      'YYYY-MM-DD' in India
 *
 * Returns { header, rows: [checked], ready, warned, failed, tooMany }.
 * Each checked row is { row, state: 'ready' | 'warn' | 'error', problems,
 * warnings, notes, product, view, payload }. `payload` is what goes to
 * import_reviews() — only for rows that are not 'error'.
 */
export function checkSheet({ rows = [], products = [], existing = [], orders = [], isPaid = () => false, today = '' } = {}) {
  const headerAt = headerRowIndex(rows)
  const header = mapHeaders(headerAt >= 0 ? rows[headerAt] : [])
  const out = { header, rows: [], ready: 0, warned: 0, failed: 0, tooMany: false }
  if (headerAt < 0 || header.missing.length) return out

  const catalogue = indexCatalogue(products)
  const designOfId = (id) => {
    const p = catalogue.byId.get(String(id || '').toLowerCase())
    return p ? designOf(p) : String(id || '')
  }
  const seen = new Map()
  for (const r of Array.isArray(existing) ? existing : []) {
    if (!r?.product_id || !r?.body) continue
    seen.set(`${designOfId(r.product_id)}|${sameWords(r.body)}`, 'existing')
  }
  const paidByPhone = new Map()
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!o || o.is_test || !isPaid(o)) continue
    const d = mobileDigits(o.phone)
    if (d && !paidByPhone.has(d)) paidByPhone.set(d, o)
  }

  const cell = (raw, key) => (key in header.columns ? clean(raw[header.columns[key]]) : '')

  for (let i = headerAt + 1; i < rows.length; i += 1) {
    const raw = rows[i] || []
    const rowNumber = i + 1
    const fields = Object.fromEntries([...SHEET_COLUMNS.map((c) => c.key), 'location'].map((k) => [k, cell(raw, k)]))
    const productCells = header.products
      .map((c) => ({ ...c, value: clean(raw[c.index]) }))
      .filter((c) => c.value)
    if (!Object.values(fields).some(Boolean) && !productCells.length) continue

    const problems = []
    const warnings = []
    const notes = []

    // Product: the link wins, then the Product ID, the design ID, the name.
    const found = resolveProduct(catalogue, productCells, fields.colour)
    let product = found.product
    problems.push(...found.problems)
    warnings.push(...found.warnings)
    notes.push(...found.notes)
    // A link or Product ID names one colour; the Colour column may point at
    // another colour of the same design. (A design ID or a name already used
    // the Colour column to pick the colour.)
    const byLink = found.by === 'link' || found.by === 'id'
    if (product && byLink && fields.colour && squash(fields.colour) !== squash(colourOf(product))) {
      const sibling = (catalogue.byDesign.get(designOf(product)) || []).find((p) => squash(colourOf(p)) === squash(fields.colour))
      if (sibling) {
        warnings.push(`The link is for ${colourOf(product) || 'another colour'}; using the ${colourOf(sibling)} colour of the same design, as the Colour column says.`)
        product = sibling
      } else if (colourOf(product)) {
        warnings.push(`This design has no “${fields.colour}” colour. The review is saved against ${colourOf(product)}, from the link.`)
      } else {
        warnings.push(`${product.title || 'This product'} has no colours, so “${fields.colour}” from the Colour column is not shown.`)
      }
    }
    if (product && product.is_active === false) {
      warnings.push('This product is hidden on the site, so the review will not show until the product is back on sale.')
    }

    const rating = parseStars(fields.rating)
    if (!fields.rating) problems.push('No star rating.')
    else if (rating == null) problems.push(`“${fields.rating}” is not a star rating. Use a whole number from 1 to 5.`)

    const body = fields.body
    if (!body) problems.push('No review text.')
    else if (body.length < REVIEW_LIMITS.MIN_BODY) problems.push(`The review is too short (${body.length} characters; at least ${REVIEW_LIMITS.MIN_BODY}).`)
    else if (body.length > REVIEW_LIMITS.MAX_BODY) problems.push(`The review is too long (${body.length} characters; at most ${REVIEW_LIMITS.MAX_BODY}).`)

    const title = fields.title
    if (title.length > REVIEW_LIMITS.MAX_TITLE) problems.push(`The title is too long (at most ${REVIEW_LIMITS.MAX_TITLE} characters).`)

    let name = fields.name
    if (NO_NAME_WORDS.has(squash(name))) name = ''
    if (name && (name.length < REVIEW_LIMITS.MIN_NAME || name.length > REVIEW_LIMITS.MAX_NAME)) {
      problems.push(`The name must be ${REVIEW_LIMITS.MIN_NAME} to ${REVIEW_LIMITS.MAX_NAME} characters, or left empty.`)
    }

    let city = fields.city
    let state = fields.state
    if (fields.location && (!city || !state)) {
      const [first, ...rest] = fields.location.split(',').map((s) => s.trim()).filter(Boolean)
      if (!city && first) city = first
      if (!state && rest.length) state = rest.join(', ')
    }
    if (city.length > IMPORT_LIMITS.MAX_CITY) problems.push(`The city is too long (at most ${IMPORT_LIMITS.MAX_CITY} characters).`)
    if (state.length > IMPORT_LIMITS.MAX_STATE) problems.push(`The state is too long (at most ${IMPORT_LIMITS.MAX_STATE} characters).`)

    let size = fields.size ? normaliseSize(fields.size) : ''
    if (size.length > IMPORT_LIMITS.MAX_SIZE) problems.push(`The size is too long (at most ${IMPORT_LIMITS.MAX_SIZE} characters).`)
    else if (size && product && Array.isArray(product.sizes) && product.sizes.length) {
      const match = product.sizes.find((s) => squash(s) === squash(size))
      if (match) size = match
      else warnings.push(`Size ${size} is not one of this product’s sizes (${product.sizes.join(', ')}). It is shown as typed.`)
    }

    const date = parseSheetDate(fields.date)
    if (date === null) problems.push(`“${fields.date}” is not a date. Write it as day/month/year, e.g. 03/11/2026.`)
    else if (date && today && date > today) problems.push('The date received is in the future.')

    const phone = parsePhone(fields.phone)
    if (phone.problem) problems.push(phone.problem)
    else if (phone.digits && paidByPhone.has(phone.digits)) {
      notes.push(`The mobile matches website order ${paidByPhone.get(phone.digits).reference}.`)
    }

    const orderRef = fields.orderRef
    if (orderRef.length > IMPORT_LIMITS.MAX_ORDER_REF) problems.push(`The order number is too long (at most ${IMPORT_LIMITS.MAX_ORDER_REF} characters).`)

    const { channel, unknown } = parseChannel(fields.channel)
    if (unknown) warnings.push(`“${fields.channel}” is saved as Received via: Other.`)

    const note = fields.note
    if (note.length > IMPORT_LIMITS.MAX_NOTE) problems.push(`The note is too long (at most ${IMPORT_LIMITS.MAX_NOTE} characters).`)

    // The same review twice, in this sheet or already in the panel.
    if (product && body) {
      const key = `${designOf(product)}|${sameWords(body)}`
      const before = seen.get(key)
      if (before === 'existing') problems.push('This review is already in your Reviews list.')
      else if (before) problems.push(`Same review as row ${before}.`)
      else seen.set(key, rowNumber)
    }

    const label = reviewerLabel({ customer_name: name, reviewer_city: city, reviewer_state: state, verified: false })
    if (!name && !problems.length) notes.push(`No name: shown as “${label.name}” until you mark it verified, then as “Verified Buyer”.`)

    const state_ = problems.length ? 'error' : warnings.length ? 'warn' : 'ready'
    const checked = {
      row: rowNumber,
      state: state_,
      problems,
      warnings,
      notes,
      product,
      view: {
        rating, title, body, name, city, state, size, date, label,
        colour: colourOf(product),
        phone: phone.digits, orderRef, channel, note,
      },
      payload: state_ === 'error'
        ? null
        : {
            row: rowNumber,
            product_id: product.id,
            rating,
            body,
            title: title || null,
            name: name || null,
            city: city || null,
            state: state || null,
            size: size || null,
            written_on: date || null,
            phone: phone.digits || null,
            order_ref: orderRef || null,
            channel: channel || null,
            note: note || null,
          },
    }
    out.rows.push(checked)
    if (state_ === 'error') out.failed += 1
    else if (state_ === 'warn') out.warned += 1
    else out.ready += 1
  }
  out.tooMany = out.ready + out.warned > MAX_ROWS
  return out
}

/** The payloads of every row that can be added. */
export const importable = (checked) => (checked?.rows || []).filter((r) => r.payload).map((r) => r.payload)

// ---- the template ----------------------------------------------------------

/** The link to a product's page on the live site. */
export const productLink = (p) => `${SITE}/product/${encodeURIComponent(p.id)}`

/**
 * The template workbook: an empty "Reviews" sheet with the headings, a
 * "Products" sheet listing every product's link and Product ID to copy from,
 * and "How to fill" with one line per column.
 */
export function reviewTemplateWorkbook(products = []) {
  const list = (Array.isArray(products) ? products : [])
    .filter((p) => p?.id)
    .slice()
    .sort((a, b) => String(a.sku || a.id).localeCompare(String(b.sku || b.id)))
  return buildWorkbook({
    sheets: [
      {
        name: 'Reviews',
        columns: SHEET_COLUMNS.map((c) => c.header),
        rows: [],
        boldHeader: true,
        freezeHeader: true,
        widths: SHEET_COLUMNS.map((c) => c.width),
      },
      {
        name: 'Products',
        columns: ['Product ID', 'Product link', 'Product', 'Colour', 'Sizes', 'On the site'],
        rows: list.map((p) => [
          String(p.sku || ''),
          productLink(p),
          String(p.title || ''),
          colourOf(p),
          Array.isArray(p.sizes) ? p.sizes.join(', ') : '',
          p.is_active === false ? 'Hidden' : 'Yes',
        ]),
        boldHeader: true,
        freezeHeader: true,
        widths: [11, 62, 40, 16, 16, 11],
      },
      {
        name: 'How to fill',
        columns: ['Column', 'Needed?', 'Shown on the site?', 'What to put'],
        rows: [
          ...SHEET_COLUMNS.map((c) => [c.header, c.required ? 'Yes' : 'Optional', c.shown ? 'Yes' : 'No, private', c.help]),
          [],
          ['One row per review.', '', '', 'Your own extra columns are fine: they are ignored. Empty rows are skipped.'],
          ['Nothing goes live on upload.', '', '', 'Every review waits in Admin → Reviews until you check it, mark it "Verified purchase" if you have checked the purchase, and approve it.'],
          ['Uploaded the wrong file?', '', '', 'Open any review from that upload in Admin → Reviews and choose "Undo this upload". Reviews you have already published stay.'],
        ],
        boldHeader: true,
        wrap: true,
        widths: [26, 10, 18, 90],
      },
    ],
  })
}

/** India's date today, 'YYYY-MM-DD'. */
export function indiaToday(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60000)
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`
}

