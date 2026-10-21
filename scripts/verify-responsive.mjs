// The mobile layout: no horizontal overflow, no broken images, nothing
// pushed off the screen at 390 px — and the same at desktop width.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = (process.argv[2] || 'https://www.ruhi-collections.com').replace(/\/$/, '')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// No fixed debugging port: Chrome picks one and announces it (see below).

const ROUTES = ['/', '/shop', '/shop?type=coord', '/collections', '/product/solid-shirts-blue',
  '/cart', '/wishlist', '/account', '/admin', '/about', '/contact']
const SIZES = [
  { name: 'mobile  390×844', width: 390, height: 844, mobile: true },
  { name: 'desktop 1440×900', width: 1440, height: 900, mobile: false },
]

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=0', '--user-data-dir=/tmp/ruhi-chrome-mobile-' + process.pid, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })

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
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })

let bad = 0
for (const size of SIZES) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: size.width, height: size.height, deviceScaleFactor: size.mobile ? 2 : 1, mobile: size.mobile,
  })
  console.log(`\n${size.name}`)
  for (const route of ROUTES) {
    await send('Page.navigate', { url: BASE + route })
    await sleep(2600)
    const page = await evaluate(`({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      broken: [...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0).length,
      images: document.querySelectorAll('img').length,
    })`)
    const problems = []
    if (page.overflow > 1) problems.push(`${page.overflow}px of horizontal overflow`)
    if (page.broken) problems.push(`${page.broken} broken image(s) of ${page.images}`)
    if (problems.length) {
      bad += 1
      console.log(`  ✗ ${route.padEnd(30)} ${problems.join('; ')}`)
    } else {
      console.log(`  ✓ ${route.padEnd(30)} ${page.images} image(s), no overflow`)
    }
  }
}
chrome.kill()
console.log(bad ? `\n${bad} route/size combination(s) had a problem.` : '\nEvery route fits both widths.')
process.exit(bad ? 1 : 0)
