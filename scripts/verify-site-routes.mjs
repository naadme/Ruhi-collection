// A quick pass over the storefront and the admin entry points, in a real
// browser, to prove nothing on the site is broken.
//
//   node scripts/verify-site-routes.mjs [baseUrl]
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = (process.argv[2] || 'https://www.ruhi-collections.com').replace(/\/$/, '')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9339

const ok = (m) => console.log(`  \u2713 ${m}`)
const bad = (m) => console.log(`  \u2717 ${m}`)

const ROUTES = [
  ['/', 'the homepage'],
  ['/shop', 'the shop'],
  ['/shop?type=coord', 'the shop, filtered to a category'],
  ['/collections', 'the collections page'],
  ['/product/solid-shirts-blue', 'a product page'],
  ['/cart', 'the cart'],
  ['/wishlist', 'the wishlist'],
  ['/account', 'the account page (sign in)'],
  ['/admin', 'the admin entry (sign in)'],
  ['/checkout', 'the checkout'],
]

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/ruhi-chrome-profile7', 'about:blank'], { stdio: 'ignore' })

let wsUrl = ''
for (let i = 0; i < 40 && !wsUrl; i += 1) {
  await sleep(500)
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const page = list.find((t) => t.type === 'page')
    if (page?.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl
  } catch { /* starting */ }
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

let failures = 0
try {
  console.log(`\nEvery route on ${BASE}`)
  for (const [route, what] of ROUTES) {
    await send('Page.navigate', { url: BASE + route })
    for (let i = 0; i < 40; i += 1) {
      await sleep(300)
      const ready = await evaluate('document.readyState === "complete"')
      if (ready) break
    }
    await sleep(1200)
    const page = await evaluate(`({
      title: document.title,
      h1: document.querySelector('h1')?.textContent.trim() || '',
      text: (document.body.innerText || '').slice(0, 120).replace(/\\s+/g, ' '),
      broken: document.querySelectorAll('img').length
        ? [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0).length
        : 0,
      error: /Something went wrong/i.test(document.body.innerText || ''),
    })`)
    if (page.error) {
      bad(`${what} (${route}) — the page rendered an error`)
      failures += 1
    } else if (page.broken) {
      bad(`${what} (${route}) — ${page.broken} broken image(s)`)
      failures += 1
    } else {
      ok(`${what.padEnd(34)} ${route.padEnd(30)} “${page.h1 || page.title}”`)
    }
  }
} finally {
  chrome.kill()
}
console.log(failures ? `\n${failures} route(s) had a problem.` : '\nEvery route works.')
process.exit(failures ? 1 : 0)
