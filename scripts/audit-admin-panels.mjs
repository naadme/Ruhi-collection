// Drive the audit harness in a real browser and report every console error,
// exception and failed request, plus what each panel actually rendered.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const URL_ = process.argv[2] || 'http://localhost:5199/audit-harness.html'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9361

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/ruhi-chrome-audit', 'about:blank'], { stdio: 'ignore' })

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
const exceptions = []
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
    exceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '')
  }
  if (m.method === 'Network.loadingFailed') {
    failed.push(`${m.params.errorText} ${m.params.type}`)
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
await send('Network.enable')

await send('Page.navigate', { url: URL_ })
await sleep(9000)

const panels = await evaluate(`[...document.querySelectorAll('[data-panel]')].map(p => ({
  name: p.dataset.panel,
  text: (p.innerText || '').replace(/\\s+/g, ' ').slice(0, 400),
  length: (p.innerText || '').length,
}))`)

console.log(`\nThe audit harness at ${URL_}`)
console.log('--- panels that rendered ---')
for (const p of panels || []) {
  console.log(`  ${p.name}: ${p.length} characters`)
  console.log(`    ${p.text.slice(0, 220)}`)
}
console.log(`\n--- console errors/warnings: ${(consoleErrors || []).length} ---`)
for (const c of (consoleErrors || []).slice(0, 12)) console.log(`  ${c.slice(0, 300)}`)
console.log(`\n--- exceptions: ${(exceptions || []).length} ---`)
for (const c of (exceptions || []).slice(0, 12)) console.log(`  ${String(c).slice(0, 400)}`)
console.log(`\n--- failed requests: ${(failed || []).length} ---`)
for (const c of (failed || []).slice(0, 12)) console.log(`  ${c}`)

chrome.kill()
process.exit(0)
