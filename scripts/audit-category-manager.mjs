// The category manager, driven in a real browser.
//
// The categories the panel reads are intercepted, and so is the count of how
// many products each category holds — so the panel can be shown one category
// with products in it and one without, and both can be tried, without
// touching the database at all.
//
// What is checked:
//   * adding a category, and what the panel says afterwards;
//   * refusing a duplicate name before anything is written;
//   * deleting a category that holds products — refused, with the reason;
//   * deleting an empty category — confirmed, then deleted.

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const URL_ = process.argv[2] || 'http://localhost:5199/audit/index.html'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9381

const CATEGORIES = [
  { key: 'tops', label: 'Tops & T-shirts', position: 0, code: '01', image: null, image_active: true },
  { key: 'kurtis', label: 'Kurtis', position: 1, code: '07', image: null, image_active: true },
]
// Three catalogue rows in "tops" and none in "kurtis".
const USAGE = [
  { type: 'tops' }, { type: 'tops' }, { type: 'tops' },
]

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/ruhi-chrome-cats', 'about:blank'], { stdio: 'ignore' })

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
const errors = []
const writes = []
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
    const method = m.params.request.method || 'GET'
    const headers = [
      { name: 'content-type', value: 'application/json' },
      { name: 'access-control-allow-origin', value: '*' },
      { name: 'access-control-allow-headers', value: '*' },
      { name: 'access-control-allow-methods', value: 'GET,POST,PATCH,DELETE,OPTIONS' },
    ]
    const answer = (body, code = 200) => {
      if (method !== 'OPTIONS') writes.push(`${method} ${url.replace(/https:\/\/[^/]+\//, '').slice(0, 90)}`)
      return send('Fetch.fulfillRequest', {
        requestId: m.params.requestId,
        responseCode: code,
        responseHeaders: headers,
        body: Buffer.from(JSON.stringify(body)).toString('base64'),
      }).catch(() => {})
    }
    if (/\/rest\/v1\/products\?select=type/.test(url)) return answer(USAGE)
    if (/\/rest\/v1\/categories/.test(url)) {
      if (method === 'GET') return answer(CATEGORIES)
      if (method === 'POST') {
        const posted = JSON.parse(m.params.request.postData || '{}')
        return answer({ ...posted, code: '08', position: 2 })
      }
      if (method === 'DELETE') return answer(null, 204)
      if (method === 'PATCH') return answer(CATEGORIES[0])
      return answer(CATEGORIES)
    }
    return answer([])
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
    { urlPattern: '*supabase.co/rest/v1/categories*' },
    { urlPattern: '*supabase.co/rest/v1/products?select=type*' },
  ],
})
await send('Page.navigate', { url: URL_ })
await sleep(9000)

const failures = []
const report = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

const PANEL = '[data-panel="categories"]'
const text = () => evaluate(`(() => {
  const el = document.querySelector('${PANEL}');
  return (el.innerText || '').replace(/\\s+/g, ' ');
})()`)

console.log(`\nThe category manager, in a real browser\n`)

// --- the list ---------------------------------------------------------------
const list = await evaluate(`(() => {
  const el = document.querySelector('${PANEL}');
  const rows = [...el.querySelectorAll('li')].map(li => li.innerText.replace(/\\s+/g, ' ').trim());
  return rows;
})()`)
report('the categories are listed with their product count', (list || []).some((r) => /Tops & T-shirts tops · 01 · 3 products/.test(r)),
  (list || []).join(' | '))
report('an empty category says so', (list || []).some((r) => /Kurtis kurtis · 07 · 0 products/.test(r)))

// --- adding -----------------------------------------------------------------
const added = await evaluate(`(async () => {
  const el = document.querySelector('${PANEL}');
  const input = el.querySelector('input[aria-label="New category name"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'Kurti');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  const form = input.closest('form');
  form.querySelector('button[type="submit"]').click();
  await new Promise(r => setTimeout(r, 1200));
  return (el.innerText || '').replace(/\\s+/g, ' ');
})()`)
report('adding a category says so', /Kurti.*added/i.test(added || ''), (added || '').slice(0, 160))
report('the new category is written to the database', writes.some((w) => w.startsWith('POST') && w.includes('categories')),
  writes.join(' | ') || 'no write')

// --- a duplicate ------------------------------------------------------------
const duplicate = await evaluate(`(async () => {
  const el = document.querySelector('${PANEL}');
  const input = el.querySelector('input[aria-label="New category name"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '  tops & t-shirts  ');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  input.closest('form').querySelector('button[type="submit"]').click();
  await new Promise(r => setTimeout(r, 1200));
  return (el.innerText || '').replace(/\\s+/g, ' ');
})()`)
report('a duplicate name is refused', /already a category/i.test(duplicate || ''), (duplicate || '').slice(0, 160))

// --- an empty name ----------------------------------------------------------
const empty = await evaluate(`(async () => {
  const el = document.querySelector('${PANEL}');
  const input = el.querySelector('input[aria-label="New category name"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '   ');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  const button = input.closest('form').querySelector('button[type="submit"]');
  return { disabled: button.disabled };
})()`)
report('an empty name cannot be saved', empty?.disabled === true, JSON.stringify(empty))

// --- deleting a category that holds products --------------------------------
const refused = await evaluate(`(async () => {
  const el = document.querySelector('${PANEL}');
  const row = [...el.querySelectorAll('li')].find(li => /Tops & T-shirts/.test(li.innerText));
  const button = [...row.querySelectorAll('button')].find(b => /Delete/.test(b.textContent));
  button.click();
  await new Promise(r => setTimeout(r, 1200));
  return { message: (el.innerText || '').replace(/\\s+/g, ' '), stillThere: !!([...el.querySelectorAll('li')].find(li => /Tops & T-shirts/.test(li.innerText))) };
})()`)
report('a category with products is not deleted', /3 products.*not deleted|still holds 3 products/i.test(refused?.message || ''),
  (refused?.message || '').slice(0, 200))
report('the category is still there afterwards', refused?.stillThere === true)
report('and nothing was deleted from the database', !writes.some((w) => w.startsWith('DELETE')),
  writes.join(' | ') || 'no writes')

// --- deleting an empty category ---------------------------------------------
const deleted = await evaluate(`(async () => {
  const el = document.querySelector('${PANEL}');
  const row = [...el.querySelectorAll('li')].find(li => /Kurtis/.test(li.innerText));
  const button = [...row.querySelectorAll('button')].find(b => /Delete/.test(b.textContent));
  button.click();
  await new Promise(r => setTimeout(r, 800));
  const confirmText = (el.innerText || '').replace(/\\s+/g, ' ');
  const confirm = [...row.querySelectorAll('button')].find(b => /Confirm delete/.test(b.textContent));
  if (!confirm) return { confirmText, confirmed: false };
  confirm.click();
  await new Promise(r => setTimeout(r, 1200));
  return { confirmText, confirmed: true, message: (el.innerText || '').replace(/\\s+/g, ' ') };
})()`)
report('an empty category asks to be confirmed first', /Click delete again/i.test(deleted?.confirmText || ''),
  (deleted?.confirmText || '').slice(0, 160))
report('an empty category is deleted', deleted?.confirmed === true && writes.some((w) => w.startsWith('DELETE') && w.includes('categories')),
  writes.join(' | ') || 'no writes')
report('and it says so', /deleted/i.test(deleted?.message || ''), (deleted?.message || '').slice(0, 160))

console.log(`\n--- exceptions/errors: ${errors.length} ---`)
for (const e of errors.slice(0, 8)) console.log(`  ${String(e).slice(0, 250)}`)

console.log(`\n  ${failures.length ? `${failures.length} checks failed` : 'every check passed'}`)
chrome.kill()
process.exit(failures.length || errors.length ? 1 : 0)
