// The Google Tag Manager data layer: the page and customer details every tag
// reads (tracking brief, Section 2).
//
// This site is a single-page app: the browser loads index.html once and React
// swaps pages without reloading. A classic site puts its "page entry" above the
// GTM snippet on every page load; here there is only one load, so the entry is
// pushed on every page change instead, carrying `event: 'page_data'`. Google's
// data layer guide is explicit that values pushed after the container has
// loaded are not guaranteed to be there for the next event, and that the fix is
// an event name plus a Custom Event trigger — so GTM fires its page tags on
// `page_data`, never on the container's own load.
//
// Values stay in GTM until the page is reloaded, which on this site means for
// the whole visit. Unknown fields are therefore left out, never sent as blanks,
// and a sign-out clears the previous visitor explicitly (see clearVisitor).
//
// The events of Section 3 go through here too: trackEvent and trackEcommerce
// hold each one back until its page's entry is in the data layer. What the
// e-commerce events say about products lives in src/lib/trackingItems.js.
//
// The builders are pure and the push helpers are marked as such, so
// tests/tracking.test.js can check everything without a browser.

export const PAGE_EVENT = 'page_data'

const tidy = (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '')
const lower = (value) => tidy(value).toLowerCase()

const trimPath = (pathname) => String(pathname || '/').replace(/\/+$/, '') || '/'

/** The brief's page_type for a URL: home, category, product, cart, checkout, thank_you, search, account or other. */
export function pageTypeFor(pathname = '/', search = '') {
  const path = trimPath(pathname)
  if (path === '/') return 'home'
  // /catalog only redirects to /shop. A search on /shop covers the whole
  // catalogue, so it is a results page; anything else there is a listing.
  if (path === '/shop' || path === '/catalog') {
    return new URLSearchParams(search).get('q')?.trim() ? 'search' : 'category'
  }
  if (path === '/collections') return 'category'
  if (path.startsWith('/product/')) return 'product'
  if (path === '/cart') return 'cart'
  if (path === '/checkout') return 'checkout'
  if (path.startsWith('/order/')) return 'thank_you'
  if (path === '/account') return 'account'
  return 'other'
}

/**
 * What counts as "a new page" for tracking.
 *
 * The path alone, except on /shop where a new search or a new category is a new
 * page. Sorting, the login page tidying its OAuth parameters, and campaign tags
 * in the address all change the URL without being a page of their own.
 */
export function pageKey(pathname = '/', search = '') {
  const path = trimPath(pathname)
  if (path !== '/shop') return path
  const params = new URLSearchParams(search)
  const q = params.get('q')?.trim() || ''
  // A search covers every category (src/pages/Shop.jsx), so the category only
  // identifies the page when nothing is being searched.
  return q ? `${path}?q=${q}` : `${path}?type=${params.get('type') || ''}`
}

/** Lower-case and trimmed, or undefined when it is not an email address. */
export function normalizeEmail(value) {
  const email = lower(value)
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : undefined
}

/**
 * "+" and the country code, digits only: Google's rule is 11 to 15 digits with
 * a + prefix and no spaces or dashes.
 *
 * The shop only delivers inside India, so a bare 10-digit number (and the same
 * number written with a leading 0 or 91) is an Indian one. Anything that
 * cannot be read with certainty is left out rather than guessed.
 */
export function normalizePhone(value) {
  const raw = tidy(value)
  const digits = raw.replace(/\D/g, '')
  if (!digits) return undefined
  if (raw.startsWith('+')) return digits.length >= 11 && digits.length <= 15 ? `+${digits}` : undefined
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  return undefined
}

/** A 6-digit Indian PIN code with no spaces, or undefined. */
export function normalizePincode(value) {
  const pin = tidy(value).replace(/\s/g, '')
  return /^[1-9][0-9]{5}$/.test(pin) ? pin : undefined
}

/** "Priya  Sharma Rao" → { first: 'priya', last: 'sharma rao' }; one word has no last name. */
export function splitName(fullName) {
  const parts = lower(fullName).split(' ').filter(Boolean)
  return { first: parts[0], last: parts.length > 1 ? parts.slice(1).join(' ') : undefined }
}

/** Drop every field that is undefined, null or an empty string. `false` and 0 stay. */
export function compact(fields) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )
}

/** The brief's user_* fields from whatever the site knows, each in the brief's format. */
export function customerFields({ email, fullName, phone, city, state, pincode } = {}) {
  const { first, last } = splitName(fullName)
  const zip = normalizePincode(pincode)
  const cityName = lower(city)
  const stateName = lower(state)
  return compact({
    user_email: normalizeEmail(email),
    user_phone: normalizePhone(phone),
    user_first_name: first,
    user_last_name: last,
    user_city: cityName,
    user_state: stateName,
    user_zip: zip,
    // Every address the shop holds is in India (Indian states, 6-digit PIN
    // codes, delivery across India only), so the country is known exactly when
    // an address is.
    user_country: zip || cityName || stateName ? 'IN' : undefined,
  })
}

// An order counts as a purchase once it is paid (a refund does not undo that),
// or, for an offline order, once it is placed and not cancelled — the brief's
// rule for COD.
export const isPurchase = (order) =>
  order.payment_status === 'paid' ||
  order.payment_status === 'refunded' ||
  (order.payment_method && order.payment_method !== 'razorpay' && order.status !== 'cancelled')

/**
 * What a signed-in account's own orders say about its owner. `orders` must be
 * that account's orders only, newest first.
 *
 * new_customer is only ever `false` here. An account with no purchase may still
 * have ordered as a guest under the same email (those orders are not linked to
 * the account), so "never ordered" cannot be known from the browser and is left
 * out, as the brief asks for unknown values.
 */
export function detailsFromOrders(orders = [], user = null) {
  const latest = orders[0]
  const meta = user?.user_metadata || {}
  return {
    fullName: latest?.full_name || meta.full_name || meta.name,
    phone: latest?.phone,
    city: latest?.city,
    state: latest?.state,
    pincode: latest?.pincode,
    new_customer: orders.some(isPurchase) ? false : undefined,
  }
}

/**
 * The page entry for one page view, in the brief's field order.
 *
 * `user` is the Supabase user (or null when signed out); `details` comes from
 * detailsFromOrders. user_id is the account's database id — never an email or a
 * phone number. `eventId` is the page view's own event_id: here a page view is
 * a data layer event like any other, and Annexure A gives every event a new one.
 */
export function pageEntry({ pathname, search, user, details, eventId } = {}) {
  const signedIn = Boolean(user?.id)
  return compact({
    event: PAGE_EVENT,
    event_id: eventId,
    page_type: pageTypeFor(pathname, search),
    user_logged_in: signedIn,
    ...(signedIn
      ? {
          user_id: String(user.id),
          new_customer: details?.new_customer,
          ...customerFields({ ...details, email: user.email }),
        }
      : {}),
  })
}

const dataLayer = () => {
  // Same initialisation as the GTM snippet: never replace an existing array.
  window.dataLayer = window.dataLayer || []
  return window.dataLayer
}

export function pushToDataLayer(message) {
  dataLayer().push(message)
}

/**
 * Start GTM now, if index.html has not started it yet. The page holds GTM back
 * until its own files have loaded, so the main photo comes first; this is for
 * a moment that must not wait behind that, such as a confirmed order on a page
 * that has only just opened. Safe to call any number of times, or without the
 * page's GTM loader (tests, the dashboard's previews).
 */
export function startTrackingNow(win = globalThis.window) {
  if (typeof win?.ruhiStartTracking === 'function') win.ruhiStartTracking()
}

/**
 * Forget the previous visitor after a sign-out (or a switch of account).
 *
 * Without a reload GTM would keep the last account's email, phone and name and
 * attach them to everything the next person does. `reset` is the data layer's
 * own method for a page that stays open; user_id is then set to null, which is
 * what Google's user-ID guide asks for on sign-out.
 *
 * What belongs to the browser rather than the account survives: ab_tests, the
 * A/B tests this browser is in (src/lib/experiments.js), is put back after the
 * reset so the rest of the visit is still counted in them.
 */
const BROWSER_KEYS = ['ab_tests']

export function clearVisitor() {
  const layer = dataLayer()
  const kept = {}
  for (const key of BROWSER_KEYS) {
    for (let i = layer.length - 1; i >= 0; i -= 1) {
      const message = layer[i]
      if (message && typeof message === 'object' && Object.prototype.hasOwnProperty.call(message, key)) {
        if (message[key]) kept[key] = message[key]
        break
      }
    }
  }
  layer.push(function () { this.reset() })
  layer.push({ user_logged_in: false, user_id: null, ...kept })
}

// ---- events (Section 3) -----------------------------------------------------

/**
 * A new random event_id (Annexure A, rule 9): Meta matches the browser and
 * server copies of one action by it. A UUID, from the browser's own generator
 * where there is one.
 */
export function newEventId() {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  // randomUUID needs HTTPS; the same version-4 shape from getRandomValues.
  const bytes = new Uint8Array(16)
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const ANY_PAGE = Symbol('any page')

/**
 * Holds a page's events back until that page's entry is in the data layer.
 *
 * The entry waits up to PageTracker's DETAILS_TIMEOUT_MS for a signed-in
 * visitor's details, and an event that overtook it would reach GTM without the
 * page type or the visitor. Events for a page that was never shown (a redirect,
 * a click away first) are dropped with it. `push` receives each message.
 */
export function createPageGate(push) {
  let shown = null
  let waiting = []
  return {
    /** The entry for this page key has just been pushed. */
    shown(key) {
      shown = key
      const due = waiting.filter((w) => w.key === key || w.key === ANY_PAGE)
      waiting = []
      due.forEach((w) => w.messages.forEach(push))
    },
    /** Messages that belong to the page with this key. */
    send(key, messages) {
      if (key === shown) messages.forEach(push)
      else waiting.push({ key, messages })
    },
    /** Messages that belong to no page in particular: after the first entry. */
    sendSoon(messages) {
      if (shown !== null) messages.forEach(push)
      else waiting.push({ key: ANY_PAGE, messages })
    },
  }
}

const gate = createPageGate(pushToDataLayer)

/** The page key of the address on screen (see pageKey). */
export const currentPageKey = () => pageKey(window.location.pathname, window.location.search)

/** PageTracker's signal that the entry for `key` is in the data layer. */
export const pageShown = (key) => gate.shown(key)

/**
 * Where the GA4 event schema (8 Nov 2026) puts an event's own parameters —
 * the ones the brief's Section 3 has no field for, such as the size a shopper
 * picked or why a payment failed.
 *
 * GTM keeps every value it has been given until something overwrites it, so a
 * parameter that one event leaves out would otherwise reach GA4 carrying an
 * earlier event's value. Each event therefore starts by clearing this object
 * and `ecommerce` (Annexure A, rule 1 — Google's own instruction), and a tag
 * only ever reads what the event in hand sent.
 */
export const PARAMS_KEY = 'event_params'

const cleanSlate = () => ({ ecommerce: null, [PARAMS_KEY]: null })

/**
 * Push an event for a page, after that page's entry: the page on screen
 * unless `key` names the page the event was seen on.
 */
export const trackEvent = (message, key = currentPageKey()) => {
  if (message) gate.send(key, [cleanSlate(), message])
}

/** The same for an e-commerce event: items never leak from one event into the next. */
export const trackEcommerce = trackEvent

/**
 * Build an event and push it, never throwing. For the product-analytics
 * events, which run inside clicks, the checkout and the payment: a mistake in
 * measuring something must never stop the shopper doing it.
 */
export function trackSafely(build, key) {
  try {
    trackEvent(build(), key)
  } catch {
    /* the shop carries on */
  }
}

const PURCHASES_KEY = 'ruhi:tracked-purchases'
const PURCHASES_KEPT = 50
const claimedHere = new Set()

/**
 * True the first time an order's purchase is about to be sent from this
 * browser, false every time after (brief Section 7, rule 1).
 *
 * The thank-you page only ever shows an order this tab placed — from the
 * navigation that followed the payment, or this tab's own saved copy after a
 * refresh; it never loads an order from the database — so a mark kept on this
 * device is what stops a refresh, a revisit or a bookmark from sending the
 * purchase again. `storage` is localStorage; the in-memory set covers a
 * browser that refuses it, for as long as the page stays open.
 */
export function claimPurchase(reference, storage = globalThis.localStorage) {
  const ref = tidy(String(reference ?? ''))
  if (!ref || claimedHere.has(ref)) return false
  let sent = []
  try {
    const stored = JSON.parse(storage.getItem(PURCHASES_KEY))
    if (Array.isArray(stored)) sent = stored
  } catch { /* nothing stored, or no storage */ }
  if (sent.includes(ref)) return false
  claimedHere.add(ref)
  try {
    storage.setItem(PURCHASES_KEY, JSON.stringify([...sent, ref].slice(-PURCHASES_KEPT)))
  } catch { /* the in-memory mark still holds for this page */ }
  return true
}

/**
 * sign_up and login (Annexure A11 and A12). `method` is email or google;
 * `user` is the Supabase user. A sign-up also carries the details the person
 * gave — here the email, and the name when Google supplied one.
 *
 * user_id is only sent with a session: an email sign-up that still waits for
 * its confirmation link is an account, but not a signed-in visitor yet.
 */
export function authEvent(kind, { method, user, loggedIn = true, eventId } = {}) {
  const meta = user?.user_metadata || {}
  return compact({
    event: kind,
    event_id: eventId,
    method,
    user_id: loggedIn && user?.id ? String(user.id) : undefined,
    user_logged_in: loggedIn,
    ...(kind === 'sign_up'
      ? customerFields({ email: user?.email, fullName: meta.full_name || meta.name })
      : {}),
  })
}

/** Push a sign_up or login. It reaches GTM after the page entry, whichever page that is. */
export const trackAuth = (message) => gate.sendSoon([message])

const SIGN_UP_WINDOW_MS = 60_000

/**
 * What a return from Google (or an email link) was: the provider of the
 * identity that signed in last, and whether the account was created by this
 * very sign-in. Supabase gives no flag for the second, but a new account's
 * first sign-in happens the moment it is created.
 */
export function returningSignIn(user) {
  const identities = Array.isArray(user?.identities) ? user.identities : []
  const latest = identities.reduce(
    (best, i) => (Date.parse(i?.last_sign_in_at) > Date.parse(best?.last_sign_in_at || 0) ? i : best),
    null,
  )
  const method = latest?.provider || user?.app_metadata?.provider || undefined
  const created = Date.parse(user?.created_at)
  const signedIn = Date.parse(user?.last_sign_in_at)
  // An email account's sign-up was already sent when its form was submitted;
  // its confirmation link is its first login.
  const isNew = method !== 'email' && Math.abs(signedIn - created) < SIGN_UP_WINDOW_MS
  return { method, isNew, key: `${user?.id}:${user?.last_sign_in_at}` }
}
