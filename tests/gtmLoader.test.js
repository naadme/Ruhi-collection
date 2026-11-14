// GTM starts after the page's own files (speed decision D1, 13 Nov 2026).
//
// index.html holds GTM back until the window's load event (plus a moment of idle
// time), so the main photo is not sharing the line with ~490 KB of tracking.
// Everything the shop pushes before then waits in the data layer and GTM sends it
// in order when it arrives. These tests run the page's own snippet in a fake
// browser and check: nothing is lost or reordered, GTM starts exactly once, and
// the ways it can start (load, a confirmed order, the page being hidden, 8 s).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { startTrackingNow } from '../src/lib/tracking.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const html = read('index.html')
const GTM_ID = 'GTM-K6SNCLPC'
const GTM_URL = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`

function snippet() {
  const start = html.indexOf('<!-- Google Tag Manager')
  const end = html.indexOf('<!-- End Google Tag Manager -->')
  assert.ok(start >= 0 && end > start, 'the GTM block is in index.html')
  const block = html.slice(start, end)
  const m = block.match(/<script>([\s\S]*?)<\/script>/)
  assert.ok(m, 'the GTM block holds one inline script')
  return m[1]
}

// A fake page: records listeners, timers, idle callbacks and added scripts.
// (The snippet runs in its own vm realm, so its arrays are compared via Array.from.)
function fakePage({ readyState = 'loading', dataLayer, idle = true } = {}) {
  const listeners = { window: {}, document: {} }
  const on = (where) => (type, fn) => { (listeners[where][type] ||= []).push(fn) }
  const timers = []
  const idles = []
  const scripts = []
  const document = {
    readyState,
    visibilityState: 'visible',
    head: { appendChild: (el) => scripts.push(el) },
    createElement: (tag) => ({ tag }),
    addEventListener: on('document'),
  }
  const win = {
    document,
    Date,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    addEventListener: on('window'),
  }
  if (idle) win.requestIdleCallback = (fn, opts) => { idles.push({ fn, opts }); return idles.length }
  if (dataLayer) win.dataLayer = dataLayer
  win.window = win
  const fire = (where, type) => (listeners[where][type] || []).forEach((fn) => fn())
  return { win, document, timers, idles, scripts, fire }
}

function run(page) {
  vm.runInNewContext(snippet(), page.win)
  return page
}

const gtmScripts = (page) => page.scripts.filter((s) => s.src === GTM_URL)

test('GTM stays the first script in <head>, with its noscript fallback', () => {
  const head = html.slice(0, html.indexOf('</head>'))
  assert.match(head, /^<!doctype html><html lang="en"><head><meta charset="UTF-8" \/>\s*<!-- Google Tag Manager/)
  assert.equal(head.indexOf('<script'), head.indexOf('<script>(function(w,d,i)'), 'no script before it')
  assert.ok(html.includes(`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`), 'noscript iframe kept')
  assert.ok(snippet().includes(`'${GTM_ID}'`), 'same container as the noscript iframe')
})

test('the gtm.js start event is queued at once, before GTM itself loads', () => {
  const before = Date.now()
  const page = run(fakePage())
  assert.equal(page.win.dataLayer.length, 1)
  const [first] = page.win.dataLayer
  assert.equal(first.event, 'gtm.js')
  assert.ok(first['gtm.start'] >= before && first['gtm.start'] <= Date.now(), 'the page start time, not GTM arrival')
  assert.equal(page.scripts.length, 0, 'GTM is not fetched yet')
})

test('an existing data layer is kept, never replaced', () => {
  const early = [{ event: 'something_early' }]
  const page = run(fakePage({ dataLayer: early }))
  assert.equal(page.win.dataLayer, early)
  assert.deepEqual(Array.from(page.win.dataLayer, (m) => m.event), ['something_early', 'gtm.js'])
})

test('GTM starts after the load event, in idle time (at most 1.5 s later)', () => {
  const page = run(fakePage())
  assert.equal(page.idles.length, 0)
  page.fire('window', 'load')
  assert.equal(page.idles.length, 1)
  assert.equal(page.idles[0].opts.timeout, 1500)
  assert.equal(page.scripts.length, 0, 'still waiting for idle time')
  page.idles[0].fn({ didTimeout: false, timeRemaining: () => 10 })
  assert.equal(gtmScripts(page).length, 1)
  assert.equal(gtmScripts(page)[0].async, true)
  assert.equal(gtmScripts(page)[0].tag, 'script')
})

test('on a page that has already loaded, GTM is scheduled at once', () => {
  const page = run(fakePage({ readyState: 'complete' }))
  assert.equal(page.idles.length, 1)
  page.idles[0].fn()
  assert.equal(gtmScripts(page).length, 1)
})

test('without requestIdleCallback (older Safari), a timer stands in for it', () => {
  const page = run(fakePage({ idle: false }))
  page.fire('window', 'load')
  const soon = page.timers.find((t) => t.ms === 1)
  assert.ok(soon, 'a 1 ms timer after load')
  soon.fn()
  assert.equal(gtmScripts(page).length, 1)
})

test('GTM always starts within 8 s, even if the load event never comes', () => {
  const page = run(fakePage())
  const cap = page.timers.find((t) => t.ms === 8000)
  assert.ok(cap, 'an 8 s timer from the start')
  cap.fn()
  assert.equal(gtmScripts(page).length, 1)
})

test('a confirmed order starts GTM at once (window.ruhiStartTracking)', () => {
  const page = run(fakePage())
  assert.equal(typeof page.win.ruhiStartTracking, 'function')
  startTrackingNow(page.win)
  assert.equal(gtmScripts(page).length, 1)
})

test('the page being hidden starts GTM at once; becoming visible does not', () => {
  const page = run(fakePage())
  page.fire('document', 'visibilitychange')
  assert.equal(page.scripts.length, 0, 'still visible')
  page.document.visibilityState = 'hidden'
  page.fire('document', 'visibilitychange')
  assert.equal(gtmScripts(page).length, 1)
})

test('GTM is fetched exactly once, however many ways it is started', () => {
  const page = run(fakePage())
  page.fire('window', 'load')
  page.idles[0].fn()
  page.win.ruhiStartTracking()
  page.document.visibilityState = 'hidden'
  page.fire('document', 'visibilitychange')
  page.timers.find((t) => t.ms === 8000).fn()
  assert.equal(page.scripts.length, 1)
})

test('events pushed before GTM arrives stay queued, in order', () => {
  const page = run(fakePage())
  page.win.dataLayer.push({ event: 'page_data' }, { event: 'view_item' })
  page.fire('window', 'load')
  page.idles[0].fn()
  assert.deepEqual(Array.from(page.win.dataLayer, (m) => m.event), ['gtm.js', 'page_data', 'view_item'])
})

test('startTrackingNow is safe without the page loader (tests, dashboard previews)', () => {
  assert.doesNotThrow(() => startTrackingNow({}))
  assert.doesNotThrow(() => startTrackingNow(undefined))
  assert.doesNotThrow(() => startTrackingNow(null))
})

test('the thank-you page starts GTM before it sends the purchase', () => {
  const page = read('src/pages/OrderConfirmation.jsx')
  assert.match(page, /import \{[^}]*\bstartTrackingNow\b[^}]*\} from '..\/lib\/tracking'/)
  assert.match(page, /if \(message && claimPurchase\(placed\)\) \{\s*(?:\/\/[^\n]*\n\s*)*startTrackingNow\(\)\s*trackEcommerce\(message\)/)
})
