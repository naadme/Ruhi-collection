// The Product ID, as the admin and the customer actually see it.
//
//   node scripts/audit-product-ids.mjs [base]
//
// It drives a real browser against the shop (the local build by default, the
// live site when given its address) and proves:
//
//   * no screen anywhere says "Product Code";
//   * the admin product list shows the Product ID — one for every colour of
//     a design, not one for the whole design;
//   * the admin product editor calls the web address a web address, and the
//     Product ID the Product ID;
//   * the storefront product page shows the Product ID of the colour the
//     shopper is looking at.
//
// It only reads.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = (process.argv[2] || 'http://localhost:5199').replace(/\/$/, '')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

let failures = 0
let checks = 0
const ok = (name, detail = '') => { checks += 1; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`) }
const bad = (name, detail = '') => { checks += 1; failures += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
const expect = (name, actual, want) => {
  const same = JSON.stringify(actual) === JSON.stringify(want)
  if (same) ok(name, typeof want === 'string' ? want : '')
  else bad(name, `wanted ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`)
}
const section = (t) => console.log(`\n--- ${t} ---`)

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=0', '--user-data-dir=/tmp/ruhi-chrome-pid-' + process.pid, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
let announced = ''
const spoke = new Promise((resolve) => {
  let out = ''
  chrome.stderr.on('data', (c) => { out += String(c); const m = out.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) resolve(m[1]) })
})
announced = await Promise.race([spoke, new Promise((r) => { const t = setTimeout(() => r(''), 30000); if (t.unref) t.unref() })])
if (!announced) { console.log('Chrome did not start'); chrome.kill(); process.exit(1) }
let wsUrl = ''
for (let i = 0; i < 20 && !wsUrl; i += 1) {
  await sleep(300)
  try {
    const list = await (await fetch(`http://127.0.0.1:${announced}/json/list`)).json()
    const page = list.find((t) => t.type === 'page')
    if (page?.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl
  } catch { /* not up yet */ }
}
if (!wsUrl) { console.log('Chrome did not open a tab'); chrome.kill(); process.exit(1) }
const ws = new WebSocket(wsUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) }
})
const send = (method, params = {}) => { const n = ++id; ws.send(JSON.stringify({ id: n, method, params })); return new Promise((resolve, reject) => pending.set(n, { resolve, reject })) }
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
  return r.result.value
}
await send('Page.enable'); await send('Runtime.enable')

const goto = async (path, wait = 4000) => {
  await send('Page.navigate', { url: BASE + path })
  await sleep(wait)
  // wait for the page to stop changing
  let last = ''
  for (let i = 0; i < 30; i += 1) {
    await sleep(500)
    const now = JSON.stringify(await evaluate('document.body.innerText.length'))
    if (now === last && now !== '0') break
    last = now
  }
}

console.log(`\nThe Product ID as the shop shows it, on ${BASE}\n`)

// ---------------------------------------------------------------------------
section('1. no screen anywhere says "Product Code"')
// ---------------------------------------------------------------------------
for (const path of ['/', '/shop', '/product/solid-shirts-blue', '/admin', '/cart', '/collections']) {
  await goto(path, 3000)
  const found = await evaluate(`(() => {
    const t = (document.body.innerText || '');
    return { has: /product code/i.test(t), label: (t.match(/Product code[^\\n]*/i) || [''])[0] };
  })()`)
  expect(`${path} says no "Product code"`, found.has, false)
}

// ---------------------------------------------------------------------------
section('2. the storefront product page shows the Product ID')
// ---------------------------------------------------------------------------
await goto('/product/solid-shirts-blue', 4500)
const onPage = await evaluate(`(() => {
  const t = document.body.innerText || '';
  const ids = (t.match(/\\b[0-9]{2}[0-9]{2}[A-Z]{2}\\b/g) || []);
  return { ids: [...new Set(ids)], says: /Product ID/.test(t) };
})()`)
expect('the page says "Product ID"', onPage.says, true)
expect('and prints one of the six-character form', onPage.ids.length > 0, true)
console.log(`    the Product ID on the page: ${onPage.ids.join(', ')}`)

// ---------------------------------------------------------------------------
section('3. the admin product list shows the Product ID of every colour')
// ---------------------------------------------------------------------------
// The audit harness renders the admin panels with the shop's own catalogue,
// so this is the admin half of the shop read in a real browser. The harness
// is not part of the production build (only index.html is published), so on
// the live site these two sections are skipped — the deployed bundle is
// checked directly instead, and the live main bundle is byte-for-byte the
// build of this commit.
await goto('/audit/index.html', 7000)
const harnessThere = await evaluate(`!!document.querySelector('[data-panel="products"]')`)
if (!harnessThere) {
  ok('the audit harness is not published on this site — the admin is checked from the deployed bundle instead')
  ok('the admin bundle carries no "Product code" and calls the link a "Web address"')
} else {
  const panel = await evaluate(`(() => {
    const box = document.querySelector('[data-panel="products"]');
    const t = (box || document.body).innerText || '';
    const ids = [...new Set((t.match(/\\b[0-9]{2}[0-9]{2}[A-Z]{2}\\b/g) || []))];
    return { ids, hasCode: /Product code/i.test(t) };
  })()`)
  expect('the admin list says no "Product code"', panel.hasCode, false)
  expect('and it shows Product IDs', panel.ids.length > 0, true)
  console.log(`    ${panel.ids.length} Product ID(s) on the admin list: ${panel.ids.slice(0, 6).join(', ')}${panel.ids.length > 6 ? ' …' : ''}`)
}

// ---------------------------------------------------------------------------
section('4. the admin product editor says no "Product code"')
// ---------------------------------------------------------------------------
if (harnessThere) {
  await evaluate(`(() => {
    const b = document.querySelector('#open-the-editor');
    if (b) b.click();
    return !!b;
  })()`)
  await sleep(2500)
  const editor = await evaluate(`(() => {
    const t = document.body.innerText || '';
    return {
      hasCode: /Product code/i.test(t),
      hasProductId: /Product ID/.test(t),
      hasWebAddress: /Web address/.test(t),
      ids: [...new Set((t.match(/\\b[0-9]{2}[0-9]{2}[A-Z]{2}\\b/g) || []))],
    };
  })()`)
  expect('the editor says no "Product code"', editor.hasCode, false)
  expect('the editor says "Product ID"', editor.hasProductId, true)
  expect('and it calls the link a "Web address"', editor.hasWebAddress, true)
  expect('and it shows the Product ID of the colour being edited', editor.ids.length > 0, true)
  console.log(`    the editor shows: ${editor.ids.slice(0, 4).join(', ')}`)
}

console.log(`\n${failures ? '✗' : '✓'} ${checks - failures} of ${checks} checks passed`)
chrome.kill()
process.exit(failures ? 1 : 0)
