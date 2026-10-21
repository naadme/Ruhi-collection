// Prove the banner panel's destination picker works, without touching the
// database: the browser's request for the banner list is intercepted and
// answered with one banner, exactly as the admin's session would.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const URL_ = process.argv[2] || 'http://localhost:5199/audit/index.html'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// No fixed debugging port: Chrome picks one and announces it (see below).

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=0', '--user-data-dir=/tmp/ruhi-chrome-audit3-' + process.pid, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })

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
const BANNER = {
  id: '11111111-2222-3333-4444-555555555555',
  slot: 'home_hero',
  image: '/images/products/denim-shirt-blue.jpg',
  link: '/shop?type=dress',
  position: 0,
  is_active: true,
  created_at: '2026-10-20T10:00:00.000Z',
  updated_at: '2026-10-20T10:00:00.000Z',
}

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
  // Answer the banner list read with one banner — the browser never reaches
  // the database.
  if (m.method === 'Fetch.requestPaused') {
    const url = m.params.request.url || ''
    console.log(`  [intercepted] ${url.slice(0, 140)}`)
    const isBannerList = /\/rest\/v1\/banners/.test(url)
    send('Fetch.fulfillRequest', {
      requestId: m.params.requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'content-type', value: 'application/json' },
        { name: 'access-control-allow-origin', value: '*' },
        { name: 'access-control-allow-headers', value: '*' },
        { name: 'access-control-allow-methods', value: 'GET,POST,PATCH,DELETE,OPTIONS' },
      ],
      body: Buffer.from(JSON.stringify(isBannerList ? [BANNER] : [])).toString('base64'),
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
await send('Fetch.enable', { patterns: [{ urlPattern: '*supabase.co/rest/v1/banners*' }] })
await send('Page.navigate', { url: URL_ })
await sleep(9000)

const report = (name, value) => console.log(`  ${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)

console.log('\n--- the whole banners panel ---')
const whole = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="banners"]');
  return (panel.innerText || '').replace(/\\s+/g, ' ').slice(0, 600);
})()`)
report('the panel', whole)

console.log('\n--- the banner row the panel read ---')
const row = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="banners"]');
  const link = [...panel.querySelectorAll('input[type="text"]')][0];
  return {
    link: link ? link.value : null,
    chip: (panel.innerText.match(/Live on the site|Hidden/g) || []),
    note: (panel.innerText.match(/The category page[^\\n]*/) || [''])[0],
    active: (panel.innerText.match(/Active on the site \\((\\d+) of (\\d+)\\)/i) || []).slice(1),
  };
})()`)
report('the row', row)

console.log('\n--- the destination picker ---')
const picker = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="banners"]');
  const selects = [...panel.querySelectorAll('select')];
  if (!selects.length) return 'no selects';
  const p = selects[selects.length - 1];
  const options = [...p.options].map(o => o.textContent.trim());
  return { total: options.length, categories: options.filter(o => o.includes('(category)')), products: options.filter(o => o.includes('(product)')).length, pages: options.filter(o => !o.includes('(')) };
})()`)
report('the menu', picker)

const picked = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="banners"]');
  const selects = [...panel.querySelectorAll('select')];
  const p = selects[selects.length - 1];
  // Whatever product the catalogue actually sells — the menu is built from
  // the live rows, so a hard-coded id would only prove one particular design.
  const opt = [...p.options].find((o) => o.textContent.includes('(product)'));
  if (!opt) return 'the menu offers no product destination';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(p, opt.value);
  p.dispatchEvent(new Event('change', { bubbles: true }));
  return opt.value;
})()`)
report('picked a product destination', picked)
await sleep(700)
const after = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="banners"]');
  const link = [...panel.querySelectorAll('input[type="text"]')][0];
  return { link: link ? link.value : null, note: (panel.innerText.match(/The product page[^\\n]*/) || [''])[0] };
})()`)
report('the row now says', after)

console.log('\n--- the on/off switch ---')
const toggled = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="banners"]');
  const b = [...panel.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '').startsWith('Hide banner'));
  if (!b) return 'no switch';
  b.click();
  return b.getAttribute('aria-label');
})()`)
report('switched off', toggled)
await sleep(700)
const afterToggle = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="banners"]');
  return {
    hidden: (panel.innerText.match(/Hidden/g) || []).length,
    active: (panel.innerText.match(/Active on the site \\((\\d+) of (\\d+)\\)/i) || []).slice(1),
  };
})()`)
report('after switching off', afterToggle)

console.log(`\n--- exceptions/errors: ${errors.length} ---`)
for (const e of errors.slice(0, 8)) console.log(`  ${String(e).slice(0, 300)}`)

chrome.kill()
process.exit(0)
