// A/B tests: which version of a change each visitor sees, and the record of
// who saw what. The tests themselves are listed in src/lib/experimentList.js;
// the plan and the playbook are in AB_Testing_Plan_2026-11-13.html in the
// Ruhi Collections folder.
//
// How a visitor is placed
//   * On the first visit the browser gets a random visitor ID, kept in
//     localStorage. It says nothing about the person.
//   * A test's version is a hash of the test's id and that visitor ID. The same
//     visitor always gets the same version, worked out in the browser before
//     the page draws: no request to any server, nothing hidden while a script
//     loads, no flicker.
//   * Every test hashes on its own id, so being in version b of one test says
//     nothing about any other test.
//
// Who is never counted (and sees the current site, version a)
//   * A browser that won't keep the visitor ID: it would get a new version on
//     every visit.
//   * Bots, speed tests and automated browsers.
//   * Staff: a browser where an admin or a product manager has signed in, or
//     that opened the site with ?ab=staff once.
//   * ?ab=<test>:<version> shows that version in this browser, to check a
//     change on the live site, and makes the browser staff. ?ab=clear undoes
//     both.
//
// What is recorded, only for a counted visitor, and only from the moment
// they reach the part of the site the test changes (useExperiment's `active`):
//   * GA4: Google's event for experiments, experience_impression, with
//     exp_variant_string RUHI-<test>-<version>, once per browser session.
//   * GTM: ab_tests, "<test>:<version>" for each running test this visitor has
//     reached, comma separated. Every GA4 event carries it, so size picks,
//     add-to-carts and checkouts can be counted per version.
//   * The order: checkout sends the same tests to create-razorpay-order,
//     which saves them on the order, so paid orders per version come from the
//     database rather than from GA4.
//
// The rules a test must follow (one running test per area, ids never reused,
// a fixed split) are checked by tests/experiments.test.js against the list.

import { EXPERIMENTS } from './experimentList.js'
import { newEventId, pushToDataLayer, trackEvent } from './tracking.js'

export const TOOL = 'RUHI'
export const EXPOSURE_EVENT = 'experience_impression'
export const AB_KEY = 'ab_tests'
export const STATUSES = ['draft', 'running', 'stopped', 'shipped']
export const VARIANTS = ['a', 'b', 'c']
export const MAX_RUNNING = 4
const ID_PATTERN = /^[a-z][a-z0-9_]{0,19}$/
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const BUCKETS = 10_000
const STORE_KEY = 'ruhi:ab'
const SENT_KEY = 'ruhi:ab-sent'
// GA4 drops an event parameter value longer than 100 characters.
const GA4_VALUE_MAX = 100

// Search engines, link previews, speed tests and automated browsers.
const BOT_AGENT = /bot|crawl|spider|slurp|lighthouse|headless|pagespeed|gtmetrix|pingdom|facebookexternalhit|prerender/i

// ---- pure: placing a visitor ---------------------------------------------------

/** A 32-bit hash of a string: FNV-1a, then MurmurHash3's final mix so nearby ids land far apart. */
export function hash32(text) {
  let h = 0x811c9dc5
  const s = String(text)
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** The visitor's place in a test, 0 to 9,999. */
export const bucketOf = (testId, visitorId) => hash32(`${testId}:${visitorId}`) % BUCKETS

/** The version a test's split gives this visitor. */
export function assign(test, visitorId) {
  const bucket = bucketOf(test.id, visitorId)
  let edge = 0
  for (let i = 0; i < test.variants.length; i += 1) {
    edge += (Number(test.split?.[i]) || 0) * (BUCKETS / 100)
    if (bucket < edge) return test.variants[i]
  }
  return test.variants[0]
}

/** True for a search engine, a link preview, a speed test or an automated browser. */
export const isBot = (nav) => Boolean(nav?.webdriver) || BOT_AGENT.test(String(nav?.userAgent || ''))

/**
 * What ?ab= in an address asks for: "staff", "clear", or versions to show,
 * "aa_check:b,pdp_fit:a". Unknown tests and versions are checked later,
 * against the list.
 */
export function readAbParam(search) {
  const out = { staff: false, clear: false, force: {} }
  let value = ''
  try { value = new URLSearchParams(search || '').get('ab') || '' } catch { return out }
  for (const part of value.toLowerCase().split(',').map((p) => p.trim()).filter(Boolean)) {
    if (part === 'staff') out.staff = true
    else if (part === 'clear') out.clear = true
    else {
      const [id, variant] = part.split(':')
      if (ID_PATTERN.test(id || '') && VARIANTS.includes(variant)) out.force[id] = variant
    }
  }
  return out
}

/**
 * The version this browser shows. `who` is { visitor, counted, force }.
 * A version asked for with ?ab= wins; then a shipped test's winner; a running
 * test splits counted visitors; everyone else sees the current site.
 */
export function shownVariant(test, who = {}) {
  if (!test) return 'a'
  const forced = who.force?.[test.id]
  if (forced && test.variants.includes(forced)) return forced
  if (test.status === 'shipped') return test.variants.includes(test.winner) ? test.winner : 'a'
  if (test.status !== 'running' || !who.counted || !who.visitor) return 'a'
  return assign(test, who.visitor)
}

const runningIds = (tests) => new Set(tests.filter((t) => t.status === 'running').map((t) => t.id))

/** GTM's ab_tests: the running tests this visitor has reached, "aa_check:b,pdp_fit:a", or '' for none. */
export function abTestsValue(seen, tests) {
  const running = runningIds(tests)
  const value = Object.keys(seen || {})
    .filter((id) => running.has(id))
    .sort()
    .map((id) => `${id}:${seen[id]}`)
    .join(',')
  return value.length <= GA4_VALUE_MAX ? value : ''
}

/** What the order keeps: { test: version } for the running tests this visitor reached, or undefined. */
export function orderExperiments(seen, tests) {
  const running = runningIds(tests)
  const kept = Object.entries(seen || {}).filter(([id]) => running.has(id))
  return kept.length ? Object.fromEntries(kept.sort(([x], [y]) => (x < y ? -1 : 1))) : undefined
}

/** Everything wrong with a list of tests, as sentences; empty when the list is sound. */
export function testProblems(tests, retired = []) {
  const problems = []
  if (!Array.isArray(tests)) return ['the list of tests is not a list']
  const ids = new Set()
  const areas = new Map()
  for (const t of tests) {
    const name = t?.id || '(no id)'
    if (!t || typeof t !== 'object') { problems.push('a test is not an object'); continue }
    if (!ID_PATTERN.test(t.id || '')) problems.push(`${name}: the id must be lower case letters, digits and _, at most 20 characters`)
    if (ids.has(t.id)) problems.push(`${name}: the id is used twice`)
    ids.add(t.id)
    if (retired.includes(t.id)) problems.push(`${name}: the id belonged to an earlier test and cannot be used again`)
    if (typeof t.area !== 'string' || !t.area.trim()) problems.push(`${name}: no area`)
    const variants = Array.isArray(t.variants) ? t.variants : []
    if (variants.length < 2 || variants.length > 3 || variants.some((v, i) => v !== VARIANTS[i])) {
      problems.push(`${name}: the versions must be ['a', 'b'] or ['a', 'b', 'c'], with a the current site`)
    }
    const split = Array.isArray(t.split) ? t.split : []
    if (split.length !== variants.length || split.some((x) => !Number.isInteger(x) || x <= 0) || split.reduce((a, b) => a + b, 0) !== 100) {
      problems.push(`${name}: the split must give every version a whole-number share, adding up to 100`)
    }
    if (!STATUSES.includes(t.status)) problems.push(`${name}: the status must be one of ${STATUSES.join(', ')}`)
    if (t.status === 'shipped' && !variants.includes(t.winner)) problems.push(`${name}: a shipped test needs its winner`)
    if (t.status === 'running') {
      if (!DAY_PATTERN.test(t.started || '')) problems.push(`${name}: a running test needs the day it started`)
      if (!t.plan?.metric || !(t.plan?.perVersion > 0)) problems.push(`${name}: a running test needs its plan (metric and visitors per version)`)
      if (t.area !== 'none') {
        if (areas.has(t.area)) problems.push(`${name}: ${areas.get(t.area)} is already running on ${t.area}`)
        areas.set(t.area, t.id)
      }
    }
  }
  const running = tests.filter((t) => t?.status === 'running').length
  if (running > MAX_RUNNING) problems.push(`${running} tests are running; at most ${MAX_RUNNING} at once`)
  return problems
}

// ---- the browser ---------------------------------------------------------------

let state = null

const readJson = (storage, key) => {
  try {
    const parsed = JSON.parse(storage.getItem(key))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const storageOf = (win, name) => {
  try { return win?.[name] || null } catch { return null }
}

function save(s) {
  if (!s.storage) return false
  const value = JSON.stringify({ v: s.visitor, staff: s.staff || undefined, force: s.force, seen: s.seen })
  try {
    s.storage.setItem(STORE_KEY, value)
    return s.storage.getItem(STORE_KEY) === value
  } catch {
    return false
  }
}

function publish(s) {
  const value = abTestsValue(s.seen, s.tests)
  if (value === s.published) return
  s.published = value
  pushToDataLayer({ [AB_KEY]: value || null })
}

function load(win, tests) {
  const s = {
    tests, storage: storageOf(win, 'localStorage'), session: storageOf(win, 'sessionStorage'),
    visitor: null, staff: false, force: {}, seen: {}, counted: false, sent: new Set(), shown: new Map(), published: '',
  }
  if (!win || !s.storage) return s
  const byId = new Map(tests.map((t) => [t.id, t]))
  const known = (id, variant) => byId.has(id) && byId.get(id).variants.includes(variant)
  const stored = (() => { try { return readJson(s.storage, STORE_KEY) } catch { return {} } })()
  s.visitor = typeof stored.v === 'string' && stored.v.length >= 8 ? stored.v : newEventId()
  s.staff = stored.staff === true
  for (const [id, variant] of Object.entries(stored.force || {})) if (known(id, variant)) s.force[id] = variant
  const param = readAbParam(win.location?.search)
  if (param.clear) { s.staff = false; s.force = {} }
  if (param.staff) s.staff = true
  for (const [id, variant] of Object.entries(param.force)) {
    if (known(id, variant)) { s.force[id] = variant; s.staff = true }
  }
  // What this visitor reached before, kept while the test runs and the
  // version is still the one the split gives them.
  for (const [id, variant] of Object.entries(stored.seen || {})) {
    const test = byId.get(id)
    if (test?.status === 'running' && assign(test, s.visitor) === variant) s.seen[id] = variant
  }
  // Counted only when the browser kept what was just written: one that
  // forgets would show a new version on every visit.
  s.counted = save(s) && !s.staff && !isBot(win.navigator)
  if (!s.counted) s.seen = {}
  try {
    const sent = JSON.parse(s.session?.getItem(SENT_KEY) || '[]')
    if (Array.isArray(sent)) sent.forEach((id) => s.sent.add(id))
  } catch { /* nothing sent in this session yet */ }
  if (s.counted) publish(s)
  return s
}

const current = () => state || (state = load(typeof window === 'undefined' ? null : window, EXPERIMENTS))

/**
 * Read this visitor's place in every test, once per page load, before the app
 * draws (main.jsx). Synchronous and local: no request, nothing to wait for.
 * `tests` is for the test suite.
 */
export function startExperiments(win = typeof window === 'undefined' ? null : window, tests = EXPERIMENTS) {
  state = load(win, tests)
  return state
}

/**
 * The version of test `id` this browser shows: 'a' is the current site. The
 * answer never changes while the page is open, even if the browser becomes
 * staff meanwhile.
 */
export function variantOf(id) {
  const s = current()
  if (!s.shown.has(id)) s.shown.set(id, shownVariant(s.tests.find((t) => t.id === id), s))
  return s.shown.get(id)
}

/**
 * Count this visitor in test `id`: they have reached the part of the site it
 * changes. Call it at the same moment for every version, never only when the
 * new version is on screen. Does nothing for a test that is not running or a
 * visitor who is not counted.
 */
export function expose(id) {
  const s = current()
  const test = s.tests.find((t) => t.id === id)
  if (!test || test.status !== 'running' || !s.counted) return
  const variant = assign(test, s.visitor)
  if (s.seen[id] !== variant) {
    s.seen[id] = variant
    save(s)
    publish(s)
  }
  if (s.sent.has(id)) return
  s.sent.add(id)
  try { s.session?.setItem(SENT_KEY, JSON.stringify([...s.sent])) } catch { /* sent again next page load */ }
  trackEvent({
    event: EXPOSURE_EVENT,
    event_id: newEventId(),
    event_params: { exp_variant_string: `${TOOL}-${id}-${variant}` },
  })
}

/**
 * This browser belongs to staff (an admin or a product manager signed in): it
 * is not counted from now on. What is on screen stays as it is until the next
 * page load, which shows the current site.
 */
export function markStaff() {
  const s = current()
  if (s.staff) return
  s.staff = true
  const wasCounted = s.counted
  s.counted = false
  s.seen = {}
  save(s)
  if (wasCounted) publish(s)
}

/** The tests to save on an order: { test: version }, or undefined for a visitor in none. */
export function experimentsForOrder() {
  const s = current()
  return s.counted ? orderExperiments(s.seen, s.tests) : undefined
}
