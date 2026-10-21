// The colour search, on the live site: what comes back for a colour, and what
// does not.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = (process.argv[2] || 'https://www.ruhi-collections.com').replace(/\/$/, '')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// No fixed debugging port: Chrome picks one and announces it (see below).

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=0', '--user-data-dir=/tmp/ruhi-chrome-search-' + process.pid, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })

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

const resultsFor = async (query) => {
  await send('Page.navigate', { url: `${BASE}/shop?q=${encodeURIComponent(query)}` })
  await sleep(3500)
  return evaluate(`(() => {
    const heading = (document.querySelector('h1') || {}).textContent || '';
    const count = (document.querySelector('section p') || {}).textContent || '';
    const cards = [...document.querySelectorAll('a[href^="/product/"] h3')].map(h => h.textContent.trim());
    return { heading: heading.trim(), count: count.trim(), cards: [...new Set(cards)] };
  })()`)
}

console.log(`\nThe colour search on ${BASE}`)

for (const query of ['blue', 'BLUE', 'Royal Blue', 'black', 'pink']) {
  const r = await resultsFor(query)
  console.log(`\n  "${query}"`)
  console.log(`    heading: ${r.heading}`)
  console.log(`    count:   ${r.count}`)
  console.log(`    products: ${r.cards.slice(0, 8).join(' | ')}${r.cards.length > 8 ? ` (+${r.cards.length - 8} more)` : ''}`)
}

console.log('\n  --- the products a colour search returns, and their saved colour ---')
const detail = await evaluate(`(async () => {
  const r = await fetch('/rest/v1/products?select=title,colour&limit=200', { headers: {} });
  return null;
})()`)
void detail

// The live search results against the live catalogue's own colours.
const live = await resultsFor('blue')
const catalogue = await evaluate(`(async () => {
  const res = await fetch('https://xhsjwhzutalckeektluj.supabase.co/rest/v1/products?select=title,colour&limit=500');
  const rows = await res.json();
  const byTitle = new Map(rows.map(r => [r.title, r.colour]));
  return Object.fromEntries(byTitle);
})()`)
const titles = live.cards || []
const mismatched = titles.filter((t) => {
  const colour = String(catalogue?.[t] ?? '').toLowerCase()
  return colour && !colour.includes('blue')
})
console.log(`    ${titles.length} distinct product(s) came back for "blue"`)
console.log(`    products whose SAVED colour is not blue: ${mismatched.length ? mismatched.join(', ') : 'none'}`)

console.log(`\n  --- exceptions: ${errors.length} ---`)
for (const e of errors.slice(0, 5)) console.log(`    ${String(e).slice(0, 200)}`)

chrome.kill()
process.exit(0)
