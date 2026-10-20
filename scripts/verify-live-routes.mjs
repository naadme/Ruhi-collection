// Console errors and failed requests on the live site.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = (process.argv[2] || 'https://www.ruhi-collections.com').replace(/\/$/, '')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9344

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/ruhi-chrome-console', 'about:blank'], { stdio: 'ignore' })

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
const consoleErrors = []
const failed = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(m.error.message)) : resolve(m.result)
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    consoleErrors.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('[exception] ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text))
  }
  if (m.method === 'Network.loadingFailed') {
    failed.push(`${m.params.errorText} ${m.params.type} ${m.params.blockedReason || ''}`)
  }
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
    failed.push(`HTTP ${m.params.response.status} ${m.params.response.url.split('?')[0].split('/').pop()}`)
  }
})
const send = (method, params = {}) => {
  const n = ++id
  ws.send(JSON.stringify({ id: n, method, params }))
  return new Promise((resolve, reject) => pending.set(n, { resolve, reject }))
}

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')

const ROUTES = ['/', '/shop', '/shop?type=coord', '/collections', '/product/solid-shirts-blue',
  '/cart', '/wishlist', '/account', '/admin', '/checkout', '/about', '/contact',
  '/policies/privacy-policy', '/policies/terms-of-service', '/policies/shipping-policy', '/policies/refund-policy']

let bad = 0
for (const route of ROUTES) {
  // Settle the previous page first. A navigation cancels whatever that page
  // still had in flight, and those cancellations belong to the page that was
  // left behind — counting them against the next route would report a failure
  // that never happened. The counters are cleared after the settle, so only
  // this route's own requests are judged.
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(500)
  consoleErrors.length = 0
  failed.length = 0
  await send('Page.navigate', { url: BASE + route })
  await sleep(2600)
  const state = await send('Runtime.evaluate', {
    expression: `({ title: document.title, h1: document.querySelector('h1')?.textContent.trim() || '',
      error: /Something went wrong|Cannot read|is not a function|undefined is not/i.test(document.body.innerText) })`,
    returnByValue: true,
  })
  const s = state.result.value
  const problems = []
  if (s.error) problems.push('rendered an error')
  if (consoleErrors.length) problems.push(`${consoleErrors.length} console message(s)`)
  if (failed.length) problems.push(`${failed.length} failed request(s)`)
  if (problems.length) {
    bad += 1
    console.log(`  ✗ ${route.padEnd(34)} ${problems.join('; ')}`)
    for (const c of consoleErrors.slice(0, 3)) console.log(`      ${c.slice(0, 160)}`)
    for (const f of failed.slice(0, 3)) console.log(`      ${f.slice(0, 160)}`)
  } else {
    console.log(`  ✓ ${route.padEnd(34)} “${(s.h1 || s.title).slice(0, 44)}”`)
  }
}
console.log(bad ? `\n${bad} route(s) with problems.` : '\nNo route reported a console error, an exception or a failed request.')
chrome.kill()
process.exit(bad ? 1 : 0)
