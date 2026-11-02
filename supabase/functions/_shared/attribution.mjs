// Where the shopper came from, as the order record keeps it (tracking brief,
// Section 4, step 4).
//
// The browser sends what its 90-day `ruhi_ad` cookie and Meta's own cookies
// hold (src/lib/adClicks.js). Nothing about that is trusted beyond its shape:
// only the brief's columns are kept, every value is stored exactly as received
// — upper and lower case matter to the ad networks — and anything that is not
// a real value is left out, so the column stays empty rather than holding
// "undefined" or "NA".
//
// Plain JavaScript so the Edge Function and the test suite share it.

/** The brief's text columns, in its order. */
export const ATTRIBUTION_COLUMNS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'gbraid', 'wbraid', 'fbc', 'fbp',
]

/** The brief's column sizes: 500 characters, 2,000 for the landing page. */
export const MAX_VALUE = 500
export const MAX_LANDING_PAGE = 2000

const PLACEHOLDERS = new Set(['undefined', 'null', 'na', 'n/a'])

const real = (value, max) =>
  typeof value === 'string' &&
  value.trim() !== '' &&
  value.length <= max &&
  !PLACEHOLDERS.has(value.trim().toLowerCase())

/**
 * The order columns for an `attribution` object, or `{}` when there is none.
 * A value too long for its column is left out whole: a cut-down click ID
 * would match nothing.
 */
export function attributionColumns(attribution) {
  if (!attribution || typeof attribution !== 'object' || Array.isArray(attribution)) return {}
  const out = {}
  for (const column of ATTRIBUTION_COLUMNS) {
    if (real(attribution[column], MAX_VALUE)) out[column] = attribution[column]
  }
  if (real(attribution.landing_page, MAX_LANDING_PAGE)) out.landing_page = attribution.landing_page
  const at = typeof attribution.landing_time === 'string' ? Date.parse(attribution.landing_time) : NaN
  if (Number.isFinite(at)) out.landing_time = new Date(at).toISOString()
  return out
}
