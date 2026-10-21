// The admin order details, with the order list intercepted so the panel can
// be driven without an admin session. Nothing reaches the database.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const URL_ = process.argv[2] || 'http://localhost:5199/audit/index.html'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// No fixed debugging port: Chrome picks one and announces it (see below).

const ORDER = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  reference: '21102601',
  previous_reference: 'RCH-80D880BB',
  created_at: '2026-10-20T18:30:00.000Z',
  status: 'pending',
  payment_status: 'paid',
  payment_method: 'razorpay',
  full_name: 'Priya Sharma',
  email: 'priya@example.com',
  phone: '9046651272',
  address: '12 Rose Garden',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  subtotal: 1800,
  discount: 200,
  coupon_code: 'RUHI10',
  shipping: 0,
  total: 1600,
  razorpay_order_id: 'order_abc',
  razorpay_payment_id: 'pay_abc',
  paid_at: '2026-10-20T18:31:00.000Z',
  note: 'Please call on arrival',
  user_id: null,
  order_items: [
    { id: 'i1', title: 'Denim Shirt - Blue', size: 'M', qty: 2, unit_price: 900, sku: '0101BU' },
    { id: 'i2', title: 'Cotton Dress - Green', size: 'L', qty: 1, unit_price: 800, sku: '0302GR' },
    { id: 'i3', title: 'An old order line', size: 'S', qty: 1, unit_price: 599, sku: null },
  ],
}

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=0', '--user-data-dir=/tmp/ruhi-chrome-audit4-' + process.pid, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })

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
    const isOrders = /\/rest\/v1\/orders\?/.test(url)
    send('Fetch.fulfillRequest', {
      requestId: m.params.requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'content-type', value: 'application/json' },
        { name: 'access-control-allow-origin', value: '*' },
        { name: 'access-control-allow-headers', value: '*' },
        { name: 'access-control-allow-methods', value: 'GET,POST,PATCH,DELETE,OPTIONS' },
      ],
      body: Buffer.from(JSON.stringify(isOrders ? [ORDER] : [])).toString('base64'),
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
await send('Fetch.enable', { patterns: [{ urlPattern: '*supabase.co/rest/v1/orders*' }] })
await send('Page.navigate', { url: URL_ })
await sleep(9000)

const report = (n, v) => console.log(`  ${n}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)

console.log('\n--- the orders panel ---')
const summary = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="orders"]');
  const text = (panel.innerText || '').replace(/\\s+/g, ' ');
  return {
    hasReference: text.includes('21102601'),
    date: (text.match(/\\d+ \\w+ 2026, [^·]+IST/) || [''])[0],
    chips: (text.match(/Paid|Pending|Failed|Refunded/g) || []),
    text: text.slice(0, 300),
  };
})()`)
report('the row', summary)

// Open the order's details.
const opened = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="orders"]');
  const b = [...panel.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '').startsWith('Show details'));
  if (!b) return 'no details button';
  b.click();
  return b.getAttribute('aria-label');
})()`)
report('opening the details', opened)
await sleep(900)

const detail = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="orders"]');
  const text = (panel.innerText || '').replace(/\\s+/g, ' ');
  const codes = [...panel.querySelectorAll('span.font-mono')].map(s => s.textContent.trim()).filter(t => /^[0-9]{4}[A-Z]{2}$/.test(t));
  return {
    productIds: codes,
    items: (text.match(/Denim Shirt - Blue[^\\n]{0,60}/) || [''])[0],
    oldLine: (text.match(/An old order line[^\\n]{0,60}/) || [''])[0],
    address: (text.match(/12 Rose Garden[^\\n]{0,50}/) || [''])[0],
    paid: (text.match(/Paid|Refunded|Pending/g) || [''])[0],
    hasOldReference: text.includes('RCH-80D880BB'),
  };
})()`)
report('the order details', detail)

console.log(`\n--- exceptions/errors: ${errors.length} ---`)
for (const e of errors.slice(0, 8)) console.log(`  ${String(e).slice(0, 300)}`)

chrome.kill()
process.exit(0)
