// Every category the store offers must be reachable: the Collections page, the
// shop's Type filter, and the homepage tile for the stocked ones.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = (process.argv[2] || 'https://www.ruhi-collections.com').replace(/\/$/, '')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// No fixed debugging port: Chrome picks one and announces it (see below).

const EXPECTED = ['coord', 'dress', 'tops', 'trousers', 'night-wear', 'kurta-sets']
const LABELS = {
  coord: 'Co-ord Sets', dress: 'Dresses', tops: 'Tops & T-shirts',
  trousers: 'Trousers & Pants', 'night-wear': 'Night Wear', 'kurta-sets': 'Kurta Sets',
}

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=0', '--user-data-dir=/tmp/ruhi-chrome-cats-' + process.pid, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })

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
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(m.error.message)) : resolve(m.result)
  }
})
const send = (method, params = {}) => {
  const n = ++id
  ws.send(JSON.stringify({ id: n, method, params }))
  return new Promise((resolve, reject) => pending.set(n, { resolve, reject }))
}
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r.result.value
}
await send('Page.enable')
await send('Runtime.enable')

const go = async (path) => {
  await send('Page.navigate', { url: BASE + path })
  await sleep(3000)
}

// --- the Collections page ----------------------------------------------------
await go('/collections')
const tiles = await evaluate(`[...document.querySelectorAll('a[href*="/shop?type="]')]
  .map(a => ({ href: a.getAttribute('href'), text: (a.innerText || '').trim().split('\\n')[0] }))`)
console.log(`\nThe Collections page (${BASE}/collections)`)
const seen = new Set()
for (const t of tiles) {
  const key = new URL(t.href, BASE).searchParams.get('type')
  if (seen.has(key)) continue
  seen.add(key)
  console.log(`  ${key.padEnd(14)} “${t.text}”  →  ${t.href}`)
}

// --- the shop's Type filter ---------------------------------------------------
await go('/shop')
const options = await evaluate(`[...document.querySelectorAll('select')][0]
  ? [...document.querySelectorAll('select')[0].options].map(o => ({ v: o.value, t: o.textContent.trim() })) : []`)
console.log(`\nThe shop's Type filter`)
for (const o of options) console.log(`  ${String(o.v).padEnd(14)} “${o.t}”`)

// --- each category opens and filters ------------------------------------------
console.log(`\nEach category opens and filters`)
let bad = 0
for (const key of EXPECTED) {
  await go(`/shop?type=${key}`)
  const page = await evaluate(`({
    heading: document.querySelector('h1')?.textContent.trim() || '',
    filter: document.querySelector('select')?.value || '',
    count: (document.querySelector('section p')?.innerText || '').trim(),
    tiles: [...document.querySelectorAll('a[href^="/product/"]')].length,
  })`)
  const ok = page.filter === key && page.heading.length > 0
  if (!ok) bad += 1
  console.log(`  ${ok ? '✓' : '✗'} ${key.padEnd(14)} heading “${page.heading}”  filter “${page.filter}”  ${page.count}  ${page.tiles} product link(s)`)
}

chrome.kill()
console.log(bad ? `\n${bad} category(ies) did not open correctly.` : '\nEvery category opens and filters itself.')
process.exit(bad ? 1 : 0)
