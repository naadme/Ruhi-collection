// A/B tests (src/lib/experiments.js): who sees which version, who is counted,
// and what reaches GTM and the order. The list of tests itself is checked
// here too, so a test that breaks the rules can never be deployed.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  AB_KEY,
  EXPOSURE_EVENT,
  MAX_RUNNING,
  abTestsValue,
  assign,
  bucketOf,
  experimentsForOrder,
  expose,
  hash32,
  isBot,
  markStaff,
  orderExperiments,
  readAbParam,
  shownVariant,
  startExperiments,
  testProblems,
  variantOf,
} from '../src/lib/experiments.js'
import { EXPERIMENTS, RETIRED } from '../src/lib/experimentList.js'
import { clearVisitor, pageShown } from '../src/lib/tracking.js'

const running = (id, extra = {}) => ({
  id, area: `area_${id}`, variants: ['a', 'b'], split: [50, 50], status: 'running',
  started: '2026-11-14', plan: { metric: 'add_to_cart', perVersion: 500 }, ...extra,
})

// ---- placing visitors ----------------------------------------------------------

test('the hash never changes: a new hash would move running visitors to the other version', () => {
  assert.equal(hash32(''), 2872998923)
  assert.equal(hash32('aa_check:7a1e2c1e-0b8c-4d2e-9a43-5f1c2d3e4f50'), hash32('aa_check:7a1e2c1e-0b8c-4d2e-9a43-5f1c2d3e4f50'))
  assert.deepEqual(
    ['aa_check:v1', 'aa_check:v2', 'pdp_fit:v1'].map(hash32),
    [1660890039, 3223004098, 1817457993],
  )
})

const visitors = Array.from({ length: 20_000 }, (_, i) => `${(i * 2654435761 >>> 0).toString(16)}-${i}`)
const share = (list, value) => list.filter((v) => v === value).length / list.length

test('a 50/50 test splits visitors evenly', () => {
  const t = running('even')
  const got = visitors.map((v) => assign(t, v))
  assert.ok(Math.abs(share(got, 'a') - 0.5) < 0.015, `a: ${share(got, 'a')}`)
  assert.ok(Math.abs(share(got, 'b') - 0.5) < 0.015, `b: ${share(got, 'b')}`)
})

test('uneven and three-way splits get their shares', () => {
  const t90 = running('ninety', { split: [90, 10] })
  const got90 = visitors.map((v) => assign(t90, v))
  assert.ok(Math.abs(share(got90, 'b') - 0.10) < 0.01, `b: ${share(got90, 'b')}`)
  const t3 = running('three', { variants: ['a', 'b', 'c'], split: [34, 33, 33] })
  const got3 = visitors.map((v) => assign(t3, v))
  for (const [v, want] of [['a', 0.34], ['b', 0.33], ['c', 0.33]]) {
    assert.ok(Math.abs(share(got3, v) - want) < 0.015, `${v}: ${share(got3, v)}`)
  }
})

test('two tests are independent: version b of one says nothing about the other', () => {
  const one = running('one')
  const two = running('two')
  const cells = { aa: 0, ab: 0, ba: 0, bb: 0 }
  for (const v of visitors) cells[assign(one, v) + assign(two, v)] += 1
  for (const [cell, count] of Object.entries(cells)) {
    assert.ok(Math.abs(count / visitors.length - 0.25) < 0.015, `${cell}: ${count}`)
  }
})

test('the same visitor always gets the same version, and buckets stay in range', () => {
  const t = running('same')
  for (const v of visitors.slice(0, 200)) {
    assert.equal(assign(t, v), assign(t, v))
    const b = bucketOf('same', v)
    assert.ok(b >= 0 && b < 10_000)
  }
})

test('?ab= asks for staff, a reset, or versions to show', () => {
  assert.deepEqual(readAbParam('?ab=staff'), { staff: true, clear: false, force: {} })
  assert.deepEqual(readAbParam('?utm_source=x&ab=clear'), { staff: false, clear: true, force: {} })
  assert.deepEqual(readAbParam('?ab=aa_check:b,PDP_FIT:A'), { staff: false, clear: false, force: { aa_check: 'b', pdp_fit: 'a' } })
  assert.deepEqual(readAbParam('?ab=aa_check:z,../x:b,:b'), { staff: false, clear: false, force: {} })
  assert.deepEqual(readAbParam(''), { staff: false, clear: false, force: {} })
})

test('bots, speed tests and automated browsers are recognised; shoppers are not', () => {
  for (const userAgent of [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 Chrome-Lighthouse',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0 Safari/537.36',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  ]) assert.equal(isBot({ userAgent }), true, userAgent)
  assert.equal(isBot({ userAgent: 'Mozilla/5.0 (iPhone)', webdriver: true }), true)
  for (const userAgent of [
    'Mozilla/5.0 (Linux; Android 14; SM-A146B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 Instagram 354.0.0.0 Android',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 354.0.0.0 (iPhone15,3; iOS 18_1)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  ]) assert.equal(isBot({ userAgent }), false, userAgent)
})

test('what a browser shows: an asked-for version, a shipped winner, a running split, else the current site', () => {
  const t = running('show')
  const counted = { visitor: visitors[0], counted: true, force: {} }
  assert.equal(shownVariant(t, counted), assign(t, visitors[0]))
  assert.equal(shownVariant(t, { ...counted, counted: false }), 'a')
  assert.equal(shownVariant({ ...t, status: 'draft' }, counted), 'a')
  assert.equal(shownVariant({ ...t, status: 'stopped' }, counted), 'a')
  assert.equal(shownVariant({ ...t, status: 'shipped', winner: 'b' }, counted), 'b')
  assert.equal(shownVariant({ ...t, status: 'draft' }, { ...counted, force: { show: 'b' } }), 'b')
  assert.equal(shownVariant({ ...t, status: 'draft' }, { ...counted, force: { show: 'c' } }), 'a')
  assert.equal(shownVariant(undefined, counted), 'a')
})

test('GTM’s ab_tests and the order list only running tests, in a fixed order', () => {
  const tests = [running('zeta'), running('alpha'), { ...running('old'), status: 'stopped' }]
  const seen = { zeta: 'b', alpha: 'a', old: 'b', gone: 'b' }
  assert.equal(abTestsValue(seen, tests), 'alpha:a,zeta:b')
  assert.deepEqual(orderExperiments(seen, tests), { alpha: 'a', zeta: 'b' })
  assert.equal(abTestsValue({}, tests), '')
  assert.equal(orderExperiments({ old: 'b' }, tests), undefined)
  // The most that can run at once still fits in a GA4 parameter (100 characters).
  const most = Array.from({ length: MAX_RUNNING }, (_, i) => running(`t${i}_${'x'.repeat(16)}`))
  const value = abTestsValue(Object.fromEntries(most.map((t) => [t.id, 'b'])), most)
  assert.ok(value.length > 0 && value.length <= 100, value)
})

// ---- the list of tests -----------------------------------------------------------

test('the shop’s list of tests follows every rule', () => {
  assert.deepEqual(testProblems(EXPERIMENTS, RETIRED), [])
})

test('the rules catch what would spoil a test', () => {
  const problems = (tests, retired) => testProblems(tests, retired).join('\n')
  assert.match(problems([running('dup'), running('dup', { area: 'other' })]), /used twice/)
  assert.match(problems([running('Bad-Id')]), /lower case/)
  assert.match(problems([running('again')], ['again']), /cannot be used again/)
  assert.match(problems([running('order', { variants: ['b', 'a'] })]), /a the current site/)
  assert.match(problems([running('split', { split: [60, 30] })]), /adding up to 100/)
  assert.match(problems([running('nodate', { started: null })]), /day it started/)
  assert.match(problems([running('noplan', { plan: undefined })]), /plan/)
  assert.match(problems([running('one', { area: 'pdp' }), running('two', { area: 'pdp' })]), /already running on pdp/)
  assert.match(problems([{ ...running('ship'), status: 'shipped' }]), /winner/)
  assert.match(problems([running('state', { status: 'live' })]), /status/)
  const many = Array.from({ length: MAX_RUNNING + 1 }, (_, i) => running(`many${i}`))
  assert.match(problems(many), /at most 4/)
  // A/A checks change nothing, so they may share the 'none' area.
  assert.equal(problems([running('aa1', { area: 'none' }), running('aa2', { area: 'none' })]), '')
})

// ---- the browser -----------------------------------------------------------------

const storage = (initial = {}) => {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)) },
    removeItem: (k) => { data.delete(k) },
  }
}

const SHOPPER = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36 Instagram 354.0.0.0 Android'

function browser({ search = '', local = storage(), session = storage(), userAgent = SHOPPER } = {}) {
  return {
    location: { pathname: '/product/navy-coord', search },
    navigator: { userAgent, webdriver: false },
    localStorage: local,
    sessionStorage: session,
    dataLayer: [],
  }
}

// Runs `fn` with `win` as the page's window, the way tracking.js reads it.
function inPage(win, fn) {
  const saved = globalThis.window
  globalThis.window = win
  try { return fn() } finally { globalThis.window = saved }
}

const impressions = (win) => win.dataLayer.filter((m) => m?.event === EXPOSURE_EVENT)
const abValues = (win) => win.dataLayer.filter((m) => m && Object.hasOwn(m, AB_KEY)).map((m) => m[AB_KEY])

test('a new visitor gets an ID, a version, and is counted once they reach the test', () => {
  const tests = [running('pdp_fit', { area: 'product_page' })]
  const win = browser()
  inPage(win, () => {
    pageShown('/product/navy-coord')
    startExperiments(win, tests)
    const stored = JSON.parse(win.localStorage.getItem('ruhi:ab'))
    assert.match(stored.v, /^[0-9a-f-]{36}$/)
    const version = variantOf('pdp_fit')
    assert.equal(version, assign(tests[0], stored.v))
    // Nothing is recorded before the visitor reaches the tested part.
    assert.deepEqual(win.dataLayer, [])
    assert.equal(experimentsForOrder(), undefined)

    expose('pdp_fit')
    assert.deepEqual(abValues(win), [`pdp_fit:${version}`])
    const [impression] = impressions(win)
    assert.equal(impression.event_params.exp_variant_string, `RUHI-pdp_fit-${version}`)
    assert.match(impression.event_id, /^[0-9a-f-]{36}$/)
    // Every event starts from a clean slate (tracking.js).
    const at = win.dataLayer.indexOf(impression)
    assert.deepEqual(win.dataLayer[at - 1], { ecommerce: null, event_params: null })
    assert.deepEqual(experimentsForOrder(), { pdp_fit: version })

    // Once per browser session.
    expose('pdp_fit')
    assert.equal(impressions(win).length, 1)
    assert.equal(abValues(win).length, 1)
  })
})

test('a returning visitor keeps their version; a new session sends the impression again', () => {
  const tests = [running('pdp_fit', { area: 'product_page' })]
  const local = storage()
  const session = storage()
  const first = browser({ local, session })
  const version = inPage(first, () => {
    pageShown('/product/navy-coord')
    startExperiments(first, tests)
    expose('pdp_fit')
    return variantOf('pdp_fit')
  })

  // Same tab, next page load: ab_tests is back in GTM before any event.
  const reload = browser({ local, session })
  inPage(reload, () => {
    startExperiments(reload, tests)
    assert.deepEqual(reload.dataLayer, [{ ab_tests: `pdp_fit:${version}` }])
    assert.equal(variantOf('pdp_fit'), version)
    expose('pdp_fit')
    assert.equal(impressions(reload).length, 0)
    assert.deepEqual(experimentsForOrder(), { pdp_fit: version })
  })

  // Another day, a new session.
  const later = browser({ local, session: storage() })
  inPage(later, () => {
    pageShown('/product/navy-coord')
    startExperiments(later, tests)
    assert.equal(variantOf('pdp_fit'), version)
    expose('pdp_fit')
    assert.equal(impressions(later).length, 1)
  })
})

test('only running tests count; a stopped test drops out of GTM and the order', () => {
  const local = storage()
  const win = browser({ local })
  inPage(win, () => {
    pageShown('/product/navy-coord')
    startExperiments(win, [running('pdp_fit', { area: 'product_page' }), { ...running('later'), status: 'draft' }])
    expose('later')
    assert.deepEqual(win.dataLayer, [])
    assert.equal(variantOf('later'), 'a')
    expose('pdp_fit')
  })
  const next = browser({ local })
  inPage(next, () => {
    startExperiments(next, [{ ...running('pdp_fit', { area: 'product_page' }), status: 'stopped' }])
    assert.deepEqual(next.dataLayer, [])
    assert.equal(variantOf('pdp_fit'), 'a')
    expose('pdp_fit')
    assert.deepEqual(next.dataLayer, [])
    assert.equal(experimentsForOrder(), undefined)
  })
})

test('staff, asked-for versions, bots and forgetful browsers are never counted', () => {
  const tests = [running('pdp_fit', { area: 'product_page' })]

  const staff = browser({ search: '?ab=staff' })
  inPage(staff, () => {
    startExperiments(staff, tests)
    expose('pdp_fit')
    assert.equal(variantOf('pdp_fit'), 'a')
    assert.deepEqual(staff.dataLayer, [])
    assert.equal(experimentsForOrder(), undefined)
  })

  // ?ab=pdp_fit:b shows b, on this load and the next, without counting; ?ab=clear undoes it.
  const local = storage()
  const asked = browser({ search: '?ab=pdp_fit:b', local })
  inPage(asked, () => {
    startExperiments(asked, tests)
    assert.equal(variantOf('pdp_fit'), 'b')
    expose('pdp_fit')
    assert.deepEqual(asked.dataLayer, [])
  })
  const again = browser({ local })
  inPage(again, () => {
    startExperiments(again, tests)
    assert.equal(variantOf('pdp_fit'), 'b')
  })
  const cleared = browser({ search: '?ab=clear', local })
  inPage(cleared, () => {
    pageShown('/product/navy-coord')
    startExperiments(cleared, tests)
    expose('pdp_fit')
    assert.equal(impressions(cleared).length, 1)
  })

  const bot = browser({ userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)' })
  inPage(bot, () => {
    startExperiments(bot, tests)
    expose('pdp_fit')
    assert.equal(variantOf('pdp_fit'), 'a')
    assert.deepEqual(bot.dataLayer, [])
  })

  // A browser that refuses storage, or forgets what it was given.
  const refusing = browser()
  Object.defineProperty(refusing, 'localStorage', { get() { throw new Error('SecurityError') } })
  const forgetful = browser({ local: { getItem: () => null, setItem() {}, removeItem() {} } })
  for (const win of [refusing, forgetful]) {
    inPage(win, () => {
      startExperiments(win, tests)
      expose('pdp_fit')
      assert.equal(variantOf('pdp_fit'), 'a')
      assert.deepEqual(win.dataLayer, [])
      assert.equal(experimentsForOrder(), undefined)
    })
  }
})

test('an admin signing in stops the counting, without changing what is on screen', () => {
  const tests = [running('pdp_fit', { area: 'product_page' })]
  const local = storage()
  const win = browser({ local })
  const version = inPage(win, () => {
    pageShown('/product/navy-coord')
    startExperiments(win, tests)
    const shown = variantOf('pdp_fit')
    expose('pdp_fit')
    markStaff()
    assert.equal(variantOf('pdp_fit'), shown)
    assert.deepEqual(abValues(win), [`pdp_fit:${shown}`, null])
    assert.equal(experimentsForOrder(), undefined)
    return shown
  })
  assert.ok(['a', 'b'].includes(version))
  const next = browser({ local })
  inPage(next, () => {
    startExperiments(next, tests)
    assert.equal(variantOf('pdp_fit'), 'a')
    assert.deepEqual(next.dataLayer, [])
  })
})

test('a sign-out clears the visitor from GTM but keeps the tests this browser is in', () => {
  const win = browser()
  inPage(win, () => {
    win.dataLayer.push({ ab_tests: 'pdp_fit:b' }, { user_email: 'old@x.co' })
    clearVisitor()
    assert.deepEqual(win.dataLayer.at(-1), { user_logged_in: false, user_id: null, ab_tests: 'pdp_fit:b' })
  })
  const staff = browser()
  inPage(staff, () => {
    staff.dataLayer.push({ ab_tests: 'pdp_fit:b' }, { ab_tests: null })
    clearVisitor()
    assert.deepEqual(staff.dataLayer.at(-1), { user_logged_in: false, user_id: null })
  })
})

// ---- where the site uses it -------------------------------------------------------

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('the site places visitors before drawing, and counts the A/A check on the product page', () => {
  const main = read('src/main.jsx')
  assert.ok(main.indexOf('startExperiments()') > 0 && main.indexOf('startExperiments()') < main.indexOf('ReactDOM.createRoot'))
  assert.match(read('src/pages/Product.jsx'), /useExperiment\('aa_check', \{ active: Boolean\(viewedId\) \}\)/)
  assert.match(read('src/context/AuthContext.jsx'), /if \(adminRow \|\| productManagerRow\) markStaff\(\)/)
  assert.match(read('src/pages/Checkout.jsx'), /experiments: experimentsForOrder\(\)/)
  assert.match(read('src/lib/payments.js'), /experiments && Object\.keys\(experiments\)\.length \? \{ experiments \} : \{\}/)
  const hook = read('src/hooks/useExperiment.js')
  assert.match(hook, /if \(active\) expose\(id\)/)
})
