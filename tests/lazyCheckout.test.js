// Checkout is split out of the shop's main script (12 Nov 2026), so product
// pages — where ads land — download less. These tests pin the three parts:
// the lazy route, the prefetches that keep "Check out" instant, and the
// loader's behaviour when the file is slow, fails, or has already arrived.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pageChunk, whenIdle } from '../src/lib/pageChunk.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const APP = read('src/App.jsx')
const CHECKOUT_PAGE = read('src/lib/checkoutPage.js')
const CART = read('src/context/CartContext.jsx')
const PRODUCT = read('src/pages/Product.jsx')

const sourceFiles = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? sourceFiles(path) : /\.(jsx?|mjs)$/.test(name) ? [path] : []
})

// ---------------------------------------------------------------- the route

test('App loads Checkout lazily, through the shared loader', () => {
  assert.doesNotMatch(APP, /import\s+Checkout\s+from/, 'a static import would pull checkout back into every page')
  assert.match(APP, /const Checkout = lazy\(checkoutPage\.lazy\(CheckoutUnavailable\)\)/)
  assert.match(APP, /<Route path="checkout" element={<Checkout \/>} \/>/)
  // Same shared Suspense as the dashboard and the legal pages.
  assert.equal(APP.match(/<Suspense/g).length, 1)
})

test('the checkout page is fetched by a dynamic import, and nothing imports it statically', () => {
  assert.match(CHECKOUT_PAGE, /pageChunk\(\(\) => import\('\.\.\/pages\/Checkout'\)\)/)
  const root = new URL('../src/', import.meta.url).pathname
  const offenders = sourceFiles(root).filter((file) =>
    /^\s*import\s[^;]*?from\s+['"](?:\.\.?\/)+(?:pages\/)?Checkout(?:\.jsx)?['"]/m.test(readFileSync(file, 'utf8')))
  assert.deepEqual(offenders, [], 'any static import would undo the split')
})

test('the fallback that offers a reload is in the main bundle, not in the chunk it stands in for', () => {
  assert.match(APP, /import CheckoutUnavailable from '\.\/components\/CheckoutUnavailable'/)
  const page = read('src/components/CheckoutUnavailable.jsx')
  assert.match(page, /window\.location\.reload\(\)/)
  assert.match(page, /to="\/cart"/)
})

test('a direct load of /checkout asks for its code alongside the main script, and no other page does', () => {
  const config = read('vite.config.js')
  assert.match(config, /plugins: \[react\(\), spa404\(\), preloadCheckoutOnCheckout\(\)\]/)
  const plugin = config.slice(config.indexOf('const preloadCheckoutOnCheckout'), config.indexOf('export default defineConfig'))
  assert.match(plugin, /c\.isDynamicEntry && c\.name === 'Checkout'/)
  assert.match(plugin, /throw new Error/, 'a renamed chunk must fail the build, not silently drop the hint')
  assert.match(plugin, /location\.pathname\.replace\(\/\\\\\/\+\$\/,''\)==='\/checkout'/)
  // A failed modulepreload held the page's own import back ~13 s in Chrome
  // (fail-check, 12 Nov 2026); a plain preload only warms the cache.
  assert.match(plugin, /l\.rel='preload';l\.as='script';l\.crossOrigin=''/)
  assert.doesNotMatch(plugin, /l\.rel='modulepreload'/)
})

// --------------------------------------------------------------- prefetches

test('a basket with something in it prefetches checkout once the page is idle', () => {
  assert.match(CART, /import \{ prefetchCheckoutWhenIdle \} from '\.\.\/lib\/checkoutPage'/)
  assert.match(CART, /const filled = items\.length > 0/)
  assert.match(CART, /useEffect\(\(\) => \(filled \? prefetchCheckoutWhenIdle\(\) : undefined\), \[filled\]\)/)
})

test('choosing a size, or pressing "Buy it now", prefetches checkout at once', () => {
  assert.match(PRODUCT, /import \{ prefetchCheckout \} from '\.\.\/lib\/checkoutPage'/)
  const choose = PRODUCT.slice(PRODUCT.indexOf('const choose = (s) => {'), PRODUCT.indexOf('setSize(s); setProblem(\'\')'))
  assert.match(choose, /prefetchCheckout\(\)/)
  assert.match(PRODUCT, /<button onPointerDown=\{\(\) => prefetchCheckout\(\)\} onClick=\{\(\) => place\(true, 'buy_now'\)\}/)
})

test('every prefetch goes through the one shared loader', () => {
  assert.match(CHECKOUT_PAGE, /export const prefetchCheckout = \(\) => checkoutPage\.prefetch\(\)/)
  assert.match(CHECKOUT_PAGE, /export const prefetchCheckoutWhenIdle = \(\) => whenIdle\(prefetchCheckout\)/)
})

// ------------------------------------------------------------------ loader

const PAGE = { default: function CheckoutPage() {} }
const FALLBACK = function Fallback() {}
const noWait = () => Promise.resolve()

/** An importer that answers from a script: 'ok', 'fail' or 'empty' per call. */
function importer(...script) {
  const fn = () => {
    fn.calls += 1
    const next = script.length > 1 ? script.shift() : script[0]
    if (next === 'fail') return Promise.reject(new TypeError('Failed to fetch dynamically imported module'))
    if (next === 'empty') return Promise.resolve(undefined)
    return Promise.resolve(PAGE)
  }
  fn.calls = 0
  return fn
}

/** What React.lazy does with the thenable it is handed (react 18.3.1). */
function reactLazyFirstRender(factory) {
  const payload = { status: 'uninitialized' }
  const thenable = factory()
  thenable.then((mod) => { payload.status = 'resolved'; payload.mod = mod }, () => { payload.status = 'rejected' })
  return payload.status === 'resolved' ? { rendered: payload.mod.default } : { suspended: true }
}

test('prefetch is safe to call repeatedly: one download for every caller', async () => {
  const imp = importer('ok')
  const chunk = pageChunk(imp, { wait: noWait })
  chunk.prefetch(); chunk.prefetch(); chunk.prefetch()
  const [a, b] = await Promise.all([chunk.load(), chunk.load()])
  assert.equal(imp.calls, 1)
  assert.equal(a, PAGE)
  assert.equal(b, PAGE)
  chunk.prefetch()
  await chunk.load()
  assert.equal(imp.calls, 1, 'nothing is fetched again once it has arrived')
})

test('a failed download is retried once, after a pause', async () => {
  const imp = importer('fail', 'ok')
  const pauses = []
  const chunk = pageChunk(imp, { retryDelayMs: 1000, wait: (ms) => { pauses.push(ms); return Promise.resolve() } })
  assert.equal(await chunk.load(), PAGE)
  assert.equal(imp.calls, 2)
  assert.deepEqual(pauses, [1000])
})

test('two failures reject; a failed prefetch is forgotten, so the visit tries afresh', async () => {
  const imp = importer('fail', 'fail', 'ok')
  const chunk = pageChunk(imp, { wait: noWait })
  chunk.prefetch()
  await assert.rejects(chunk.load())
  assert.equal(imp.calls, 2, 'one try and one retry')
  assert.equal(await chunk.load(), PAGE, 'the next call starts a new download')
  assert.equal(imp.calls, 3)
})

test('a module without a page counts as a failure (vite:preloadError prevented)', async () => {
  const imp = importer('empty', 'ok')
  const chunk = pageChunk(imp, { wait: noWait })
  assert.equal(await chunk.load(), PAGE)
  assert.equal(imp.calls, 2)
})

test('React renders a prefetched page at once, with no "Loading…" in between', async () => {
  const chunk = pageChunk(importer('ok'), { wait: noWait })
  await chunk.load()
  assert.deepEqual(reactLazyFirstRender(chunk.lazy(FALLBACK)), { rendered: PAGE.default })
})

test('a page that has not arrived yet suspends, then renders when it does', async () => {
  const chunk = pageChunk(importer('ok'), { wait: noWait })
  const factory = chunk.lazy(FALLBACK)
  assert.deepEqual(reactLazyFirstRender(factory), { suspended: true })
  assert.equal(await factory(), PAGE)
})

test('a page that cannot arrive even on a retry renders the fallback, never an error', async () => {
  const imp = importer('fail')
  const chunk = pageChunk(imp, { wait: noWait })
  const logged = console.error
  console.error = () => {}
  try {
    const mod = await chunk.lazy(FALLBACK)()
    assert.equal(mod.default, FALLBACK)
    assert.equal(imp.calls, 2)
  } finally {
    console.error = logged
  }
})

// ------------------------------------------------------------------- idle

function withBrowser({ readyState, idle }, fn) {
  const listeners = {}
  const calls = []
  const window = {
    addEventListener: (type, cb) => { listeners[type] = cb },
    removeEventListener: (type) => { delete listeners[type] },
  }
  if (idle) {
    window.requestIdleCallback = (cb, opts) => { calls.push(['idle', opts]); cb(); return 7 }
    window.cancelIdleCallback = (id) => calls.push(['cancel', id])
  }
  const saved = { window: globalThis.window, document: globalThis.document }
  const restore = () => { globalThis.window = saved.window; globalThis.document = saved.document }
  globalThis.window = window
  globalThis.document = { readyState }
  let out
  try {
    out = fn({ listeners, calls })
  } catch (error) {
    restore()
    throw error
  }
  if (out && typeof out.then === 'function') return out.finally(restore)
  restore()
  return out
}

test('whenIdle waits for the page to finish loading, then for an idle moment', () => {
  withBrowser({ readyState: 'interactive', idle: true }, ({ listeners, calls }) => {
    let ran = 0
    whenIdle(() => { ran += 1 })
    assert.equal(ran, 0, 'nothing runs while the page is still loading')
    assert.equal(typeof listeners.load, 'function')
    listeners.load()
    assert.equal(ran, 1)
    assert.deepEqual(calls[0], ['idle', { timeout: 2000 }])
  })
})

test('whenIdle on a loaded page without requestIdleCallback (Safari) uses a short timer', async () => {
  await withBrowser({ readyState: 'complete', idle: false }, async () => {
    let ran = 0
    whenIdle(() => { ran += 1 })
    assert.equal(ran, 0)
    await new Promise((r) => setTimeout(r, 250))
    assert.equal(ran, 1)
  })
})

test('whenIdle can be cancelled before it runs (an emptied basket)', () => {
  withBrowser({ readyState: 'interactive', idle: true }, ({ listeners }) => {
    let ran = 0
    const cancel = whenIdle(() => { ran += 1 })
    cancel()
    assert.equal(listeners.load, undefined)
    assert.equal(ran, 0)
  })
})
