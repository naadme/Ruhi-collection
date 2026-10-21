// The All / Active / Inactive filter, driven in a real browser.
//
// The banner, best seller and category photo lists are intercepted, so the
// panels can be shown made-up rows with a known state — two on and one off —
// without touching the database at all. The check is then the same in all
// three: what each filter shows, what the counts say, and what happens when
// an item is switched off while a filter is on.

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const URL_ = process.argv[2] || 'http://localhost:5199/audit/index.html'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// No fixed debugging port: Chrome picks one and announces it (see below).

const BANNERS = [
  { id: 'b1', slot: 'home_hero', image: '/images/products/denim-shirt-blue.jpg', link: '/shop', position: 0, is_active: true },
  { id: 'b2', slot: 'home_hero', image: '/images/products/cotton-dress-blue.jpg', link: '/shop?type=dress', position: 1, is_active: false },
  { id: 'b3', slot: 'home_hero', image: '/images/products/denim-pant-coord-set-black.jpg', link: '/shop?type=trousers', position: 2, is_active: true },
]

const BESTSELLERS = [
  { product_id: 'denim-shirt-blue', position: 0, is_active: true },
  { product_id: 'cotton-dress-blue', position: 1, is_active: false },
  { product_id: 'denim-pant-coord-set-black', position: 2, is_active: true },
]

// Every seeded category is here, so the list the panel shows is exactly the
// list this file says it is — the storefront's own fallback list adds nothing.
const CATEGORIES = [
  { key: 'tops', label: 'Tops & T-shirts', position: 0, code: '01', image: '/images/products/denim-shirt-blue.jpg', image_active: true },
  { key: 'coord', label: 'Co-ord Sets', position: 1, code: '02', image: '/images/products/acid-wash-coord-set-beige.jpg', image_active: true },
  { key: 'dress', label: 'Dresses', position: 2, code: '03', image: '/images/products/cotton-dress-blue.jpg', image_active: false },
  { key: 'trousers', label: 'Trousers & Pants', position: 3, code: '04', image: '/images/products/denim-pant-coord-set-black.jpg', image_active: true },
  { key: 'night-wear', label: 'Night Wear', position: 4, code: '05', image: '/images/products/night-wear-pink.jpg', image_active: true },
  { key: 'kurta-sets', label: 'Kurta Sets', position: 5, code: '06', image: '/images/products/kurta-sets-pink.jpg', image_active: true },
]

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=0', '--user-data-dir=/tmp/ruhi-chrome-filters-' + process.pid, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })

// Chrome picks its own port and announces it on stderr, so this script can
// never find itself talking to a browser left behind by a run that died.
let announced = ''
const spoke = new Promise((resolve) => {
  let out = ''
  chrome.stderr.on('data', (chunk) => {
    out += String(chunk)
    const m = out.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
    if (m) resolve(m[1])
  })
})
announced = await Promise.race([spoke, new Promise((r) => {
  const t = setTimeout(() => r(''), 30000)
  if (t.unref) t.unref()
})])
if (!announced) {
  console.log('Chrome did not start')
  chrome.kill()
  process.exit(1)
}
// That socket is the browser's; the tab's — the one that answers Page.* —
// is read from the target list on the port it just announced.
let wsUrl = ''
for (let i = 0; i < 20 && !wsUrl; i += 1) {
  await sleep(300)
  try {
    const list = await (await fetch(`http://127.0.0.1:${announced}/json/list`)).json()
    const page = list.find((t) => t.type === 'page')
    if (page?.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl
  } catch { /* the target list is not up yet */ }
}
if (!wsUrl) {
  console.log('Chrome did not open a tab')
  chrome.kill()
  process.exit(1)
}
const ws = new WebSocket(wsUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(m.error.message)) : resolve(m.result)
  }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '')
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push('[console] ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
  if (m.method === 'Fetch.requestPaused') {
    const url = m.params.request.url || ''
    const body = /\/rest\/v1\/banners/.test(url) ? BANNERS
      : /\/rest\/v1\/bestsellers/.test(url) ? BESTSELLERS
        : /\/rest\/v1\/categories/.test(url) ? CATEGORIES : []
    send('Fetch.fulfillRequest', {
      requestId: m.params.requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'content-type', value: 'application/json' },
        { name: 'access-control-allow-origin', value: '*' },
        { name: 'access-control-allow-headers', value: '*' },
        { name: 'access-control-allow-methods', value: 'GET,POST,PATCH,DELETE,OPTIONS' },
      ],
      body: Buffer.from(JSON.stringify(body)).toString('base64'),
    }).catch(() => {})
  }
})
const send = (method, params = {}) => {
  const n = ++id
  ws.send(JSON.stringify({ id: n, method, params }))
  return new Promise((resolve, reject) => pending.set(n, { resolve, reject }))
}
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
  return r.result.value
}
await send('Page.enable')
await send('Runtime.enable')
await send('Fetch.enable', {
  patterns: [
    { urlPattern: '*supabase.co/rest/v1/banners*' },
    { urlPattern: '*supabase.co/rest/v1/bestsellers*' },
    { urlPattern: '*supabase.co/rest/v1/categories*' },
  ],
})
await send('Page.navigate', { url: URL_ })
await sleep(9000)

const failures = []
const report = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

/**
 * Read the three filter buttons of a panel and the list the filter governs.
 *
 * The list is the FIRST <ul> that comes after the filter — the banners panel
 * also has a summary list above the filter, and the best sellers panel has a
 * list of designs that are not chosen yet below it, and neither is the list
 * the filter governs.
 */
const readPanel = (panel) => evaluate(`(() => {
  const el = document.querySelector('[data-panel="${panel}"]');
  if (!el) return { error: 'no panel' };
  const group = el.querySelector('[role="group"]');
  const buttons = group ? [...group.querySelectorAll('button')].map(b => ({
    label: b.textContent.replace(/\\s+/g, ' ').trim(),
    on: b.getAttribute('aria-pressed') === 'true',
  })) : [];
  // The list the filter governs is the one whose rows carry the on/off
  // switch — the banners panel also has a summary list above the filter, and
  // the best sellers panel has a list of designs that are not chosen yet,
  // and neither of those has a switch on its rows.
  const list = [...el.querySelectorAll('ul')].find(u =>
    [...u.querySelectorAll('button')].some(b => /^(Hide|Show|Switch)/.test(b.getAttribute('aria-label') || '')));
  const rows = list ? [...list.querySelectorAll(':scope > li')].filter(li => !li.className.includes('animate-pulse')) : [];
  const titles = rows.map(li => {
    const p = li.querySelector('p');
    return p ? p.textContent.replace(/\\s+/g, ' ').trim() : '';
  });
  return { buttons, count: rows.length, titles };
})()`)

const clickFilter = (panel, label) => evaluate(`(() => {
  const el = document.querySelector('[data-panel="${panel}"]');
  const group = el.querySelector('[role="group"]');
  const b = [...group.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('${label}'));
  if (!b) return 'no ${label} button';
  b.click();
  return 'clicked';
})()`)

console.log(`\nThe status filters, in a real browser\n`)

for (const [panel, what, expected] of [
  ['banners', 'banners', 3],
  ['bestsellers', 'best sellers', 3],
  ['category-images', 'category photographs', 6],
]) {
  console.log(`--- the ${what} ---`)
  const all = await readPanel(panel)
  report(`${what}: the three filters are offered`, all.buttons?.length === 3,
    (all.buttons || []).map((b) => `${b.label}${b.on ? '*' : ''}`).join(' | '))
  report(`${what}: All shows every item`, all.count === expected, `${all.count} of ${expected}`)
  const countOf = (rows, name) => {
    const row = (rows || []).find((b) => b.label.startsWith(name))
    return row ? Number(row.label.replace(/\D+/g, '')) : NaN
  }
  const counts = (all.buttons || []).map((b) => b.label)
  report(`${what}: the counts are on the buttons`,
    countOf(all.buttons, 'All') === expected
    && countOf(all.buttons, 'Active') + countOf(all.buttons, 'Inactive') === expected,
    counts.join(' | '))

  await clickFilter(panel, 'Inactive')
  await sleep(500)
  const inactive = await readPanel(panel)
  report(`${what}: Inactive shows only the switched-off items`,
    inactive.count === countOf(all.buttons, 'Inactive'),
    `${inactive.count}: ${(inactive.titles || []).join(' / ')}`)
  report(`${what}: the Inactive filter is the one marked as on`,
    (inactive.buttons || []).find((b) => b.label.startsWith('Inactive'))?.on === true)

  await clickFilter(panel, 'Active')
  await sleep(500)
  const active = await readPanel(panel)
  report(`${what}: Active shows only the switched-on items`,
    active.count === countOf(all.buttons, 'Active'),
    `${active.count}: ${(active.titles || []).join(' / ')}`)

  await clickFilter(panel, 'All')
  await sleep(500)
  const back = await readPanel(panel)
  report(`${what}: All shows them all again`, back.count === expected, `${back.count} of ${expected}`)

  // Switching an item off while a filter is on must move it between the
  // filters, and must not change the order of the list.
  const before = await readPanel(panel)
  const toggled = await evaluate(`(() => {
    const el = document.querySelector('[data-panel="${panel}"]');
    const list = [...el.querySelectorAll('ul')].find(u =>
      [...u.querySelectorAll('button')].some(b => /^(Hide|Show|Switch)/.test(b.getAttribute('aria-label') || '')));
    const rows = list ? [...list.querySelectorAll(':scope > li')] : [];
    if (!rows.length) return 'no rows';
    const eye = [...rows[0].querySelectorAll('button')].find(x => /^(Hide|Show|Switch)/.test(x.getAttribute('aria-label') || ''));
    if (!eye) return 'no switch';
    eye.click();
    return eye.getAttribute('aria-label');
  })()`)
  await sleep(600)
  const after = await readPanel(panel)
  report(`${what}: switching an item off is possible`, typeof toggled === 'string' && !toggled.startsWith('no '),
    String(toggled).slice(0, 70))
  // One item moved from Active to Inactive, so the counts must say so.
  report(`${what}: the switch moves the item from Active to Inactive`,
    countOf(after.buttons, 'Active') === countOf(before.buttons, 'Active') - 1
    && countOf(after.buttons, 'Inactive') === countOf(before.buttons, 'Inactive') + 1,
    `${(before.buttons || []).map((b) => b.label).join(' | ')}  →  ${(after.buttons || []).map((b) => b.label).join(' | ')}`)
  // The order of the list must not move: only the status of one item changes.
  // The status words — and the "Not saved yet" badge a row wears once it has
  // been changed — are read straight off the row with no separator, so they
  // are peeled off the end until the name is left.
  const names = (rows) => (rows || []).map((t) => t.replace(/(?:Live on the site|Showing on the homepage|Hidden — keeps its place|Hidden|Active|Inactive|Not saved yet)+$/, '').trim())
  report(`${what}: the order of the list is unchanged`,
    JSON.stringify(names(after.titles)) === JSON.stringify(names(before.titles)),
    `${names(before.titles).join(' / ')}  →  ${names(after.titles).join(' / ')}`)
  console.log('')
}

console.log(`--- exceptions/errors: ${errors.length} ---`)
for (const e of errors.slice(0, 8)) console.log(`  ${String(e).slice(0, 250)}`)

console.log(`\n  ${failures.length ? `${failures.length} checks failed` : 'every check passed'}`)
chrome.kill()
process.exit(failures.length || errors.length ? 1 : 0)
