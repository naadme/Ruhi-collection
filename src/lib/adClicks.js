// Where an order came from (tracking brief, Section 4): the campaign tags and
// ad click IDs a visitor arrived with, kept in a first-party cookie until an
// order exists, then sent along when it is created.
//
// The rules, from the brief and Meta's guide to fbc and fbp:
//   * A visit that carries tags or a click ID replaces the saved campaign tags
//     and landing page as one set: together they describe the LATEST ad visit.
//   * Each click ID is kept on its own, so an earlier Meta click and a later
//     Google click both survive. A visit without one never wipes it.
//   * Values are stored exactly as received. Click IDs are case sensitive.
//   * Everything lapses 90 days after it arrived.
//   * Meta's _fbc cookie is set only when it is missing or names another
//     fbclid, as fb.1.<time first seen, in ms>.<fbclid>.
//
// The order record itself (the new columns, and the server function that
// writes them) is the database half of Section 4.
//
// Pure apart from the two functions at the end, so tests/adClicks.test.js can
// check every rule without a browser.

export const AD_COOKIE = 'ruhi_ad'
export const AD_DAYS = 90
const DAY_MS = 86_400_000
const KEEP_MS = AD_DAYS * DAY_MS

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
const CLICK_KEYS = ['gclid', 'gbraid', 'wbraid', 'fbc']
// The brief's landing_page column holds 2,000 characters.
const LANDING_MAX = 2000
// A browser drops a cookie of more than 4,096 bytes outright; this leaves room
// for the name and attributes.
const COOKIE_MAX = 3800

/**
 * What a landing address carries, or null when it has no campaign tag and no
 * click ID (a direct visit, which must not touch what is saved).
 */
export function landingFrom(href, now) {
  let url
  try { url = new URL(href) } catch { return null }
  const take = (keys) => Object.fromEntries(
    keys.map((k) => [k, url.searchParams.get(k)]).filter(([, v]) => v && v.trim()),
  )
  const utm = take(UTM_KEYS)
  const clicks = take(['gclid', 'gbraid', 'wbraid'])
  const fbclid = take(['fbclid']).fbclid
  if (!Object.keys(utm).length && !Object.keys(clicks).length && !fbclid) return null
  return {
    utm,
    clicks,
    fbclid,
    landing_page: String(href).slice(0, LANDING_MAX),
    landing_time: new Date(now).toISOString(),
  }
}

/** Meta's formatted click ID for an fbclid first seen at `at` (ms). */
export const formatFbc = (fbclid, at) => `fb.1.${at}.${fbclid}`

/** True when an existing fbc value is for this very fbclid. */
export function fbcMatches(fbc, fbclid) {
  const parts = String(fbc || '').split('.')
  // fb . subdomainIndex . creationTime . fbclid (Meta's Parameter Builder may
  // add a part of its own after it).
  return parts.length >= 4 && parts.slice(3).join('.').startsWith(fbclid)
}

/**
 * The _fbc value to set for a landing, or null to leave the cookie alone:
 * Meta's two cases are "no _fbc yet" and "an _fbc for another fbclid".
 */
export function fbcToSet(fbclid, existing, now) {
  if (!fbclid) return null
  return fbcMatches(existing, fbclid) ? null : formatFbc(fbclid, now)
}

/** Saved values that are still within 90 days of arriving. */
export function current(saved, now) {
  const out = {}
  if (!saved || typeof saved !== 'object') return out
  const visitAt = Date.parse(saved.landing_time)
  if (Number.isFinite(visitAt) && now - visitAt < KEEP_MS) {
    for (const k of [...UTM_KEYS, 'landing_page', 'landing_time']) {
      if (typeof saved[k] === 'string' && saved[k]) out[k] = saved[k]
    }
  }
  for (const k of CLICK_KEYS) {
    const at = Number(saved[`${k}_at`])
    if (typeof saved[k] === 'string' && saved[k] && Number.isFinite(at) && now - at < KEEP_MS) {
      out[k] = saved[k]
      out[`${k}_at`] = at
    }
  }
  return out
}

/**
 * What is saved after a landing. `fbc` is the Meta click ID that the landing's
 * fbclid stands for (the existing one when it already matched).
 */
export function afterLanding(saved, landing, fbc, now) {
  const next = current(saved, now)
  if (!landing) return next
  for (const k of [...UTM_KEYS, 'landing_page', 'landing_time']) delete next[k]
  Object.assign(next, landing.utm, { landing_page: landing.landing_page, landing_time: landing.landing_time })
  // The same click ID arriving again (a reload of the ad's link) keeps the
  // time it first arrived, so its 90 days are counted from the click.
  for (const [k, v] of Object.entries(landing.clicks)) {
    if (next[k] === v) continue
    next[k] = v
    next[`${k}_at`] = now
  }
  if (landing.fbclid && fbc && next.fbc !== fbc) {
    next.fbc = fbc
    next.fbc_at = Number(String(fbc).split('.')[2]) || now
  }
  return next
}

/** The saved values as one cookie value, shortening only the landing page if it would not fit. */
export function encodeSaved(saved) {
  let value = encodeURIComponent(JSON.stringify(saved))
  let landing = saved.landing_page || ''
  while (value.length > COOKIE_MAX && landing) {
    landing = landing.slice(0, Math.floor(landing.length * 0.8))
    value = encodeURIComponent(JSON.stringify({ ...saved, landing_page: landing || undefined }))
  }
  return value.length > COOKIE_MAX ? '' : value
}

export function decodeSaved(value) {
  try {
    const parsed = JSON.parse(decodeURIComponent(value || ''))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * The values the order record keeps (brief Section 4, "What the order record
 * will contain"), read as the order is created. The live _fbc and _fbp
 * cookies win: the Meta Pixel keeps them current. Unknown values are left out.
 */
export function orderAttribution(saved, { fbc, fbp } = {}, now) {
  const kept = current(saved, now)
  const out = {}
  for (const k of UTM_KEYS) if (kept[k]) out[k] = kept[k]
  for (const k of ['gclid', 'gbraid', 'wbraid']) if (kept[k]) out[k] = kept[k]
  if (fbc || kept.fbc) out.fbc = fbc || kept.fbc
  if (fbp) out.fbp = fbp
  if (kept.landing_page) out.landing_page = kept.landing_page
  if (kept.landing_time) out.landing_time = kept.landing_time
  return out
}

/** The cookie domain shared by www and the bare domain, or '' for this host only (localhost). */
export function cookieDomain(hostname) {
  const host = String(hostname || '')
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.endsWith('.localhost')) return ''
  return `.${host.split('.').slice(-2).join('.')}`
}

// ---- the browser ------------------------------------------------------------

const decode = (value) => {
  try { return decodeURIComponent(value || '') } catch { return value || '' }
}

const readCookies = (doc) => Object.fromEntries(
  String(doc.cookie || '').split(';').map((c) => c.trim()).filter(Boolean).map((c) => {
    const at = c.indexOf('=')
    return at < 0 ? [c, ''] : [c.slice(0, at), c.slice(at + 1)]
  }),
)

function writeCookie(win, name, value) {
  const doc = win.document
  const secure = win.location.protocol === 'https:' ? '; Secure' : ''
  const base = `${name}=${value}; Max-Age=${AD_DAYS * 86_400}; Path=/; SameSite=Lax${secure}`
  const domain = cookieDomain(win.location.hostname)
  if (domain) {
    doc.cookie = `${base}; Domain=${domain}`
    if (readCookies(doc)[name] === value) return
  }
  doc.cookie = base
}

/**
 * Steps 1–3 of Section 4, once per page load, before the app draws anything:
 * a landing with tags or click IDs updates the saved values (and Meta's
 * _fbc), anything else leaves them as they are.
 */
export function captureLanding(win = window, now = Date.now()) {
  try {
    const landing = landingFrom(win.location.href, now)
    if (!landing) return
    const cookies = readCookies(win.document)
    const existingFbc = decode(cookies._fbc)
    const newFbc = fbcToSet(landing.fbclid, existingFbc, now)
    if (newFbc) writeCookie(win, '_fbc', newFbc)
    const saved = afterLanding(decodeSaved(cookies[AD_COOKIE]), landing, newFbc || existingFbc, now)
    const value = encodeSaved(saved)
    if (value) writeCookie(win, AD_COOKIE, value)
  } catch { /* cookies refused: the order simply carries no ad details */ }
}

/** Step 4: what goes onto the order as it is created. */
export function attributionForOrder(win = window, now = Date.now()) {
  try {
    const cookies = readCookies(win.document)
    return orderAttribution(decodeSaved(cookies[AD_COOKIE]), {
      fbc: decode(cookies._fbc),
      fbp: decode(cookies._fbp),
    }, now)
  } catch {
    return {}
  }
}
