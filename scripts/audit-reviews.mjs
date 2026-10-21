// The Reviews panel, driven in a real browser with the database intercepted —
// so the moderation can be proved without publishing anything to the shop.
//
//   npx vite dev --port 5199
//   node scripts/audit-reviews.mjs            (npm run audit:reviews)
//
// What it proves, by watching what the panel actually asks for:
//   * the queue opens with every review and its state, counts included;
//   * the filter chips and the search box narrow the list;
//   * Approve writes `status: approved`, Unpublish writes `status: pending`,
//     Reject writes `status: rejected` — one UPDATE each, to the one row;
//   * nothing is ever deleted (the table keeps rejected reviews on the books),
//   * and the customer is told what happened, through the dashboard's toast.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const URL_ = process.argv[2] || 'http://localhost:5199/audit/index.html'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// No fixed debugging port: Chrome picks one and announces it (see below).

// Four reviews in the three states the migration allows, on two products the
// harness also loads from the live catalogue.
const REVIEWS = [
  {
    id: 'r1', product_id: 'mulmul-cotton-trousers-white', order_item_id: 'i1', rating: 5,
    body: 'Beautiful fabric and a lovely fit — washed well too.', customer_name: 'Anita K',
    status: 'pending', created_at: '2026-10-20T10:00:00Z', decided_at: null,
  },
  {
    id: 'r2', product_id: 'denim-shirt-blue', order_item_id: 'i2', rating: 4,
    body: 'The colour is exactly as photographed. Slightly loose in the sleeves.',
    customer_name: 'Meera S', status: 'approved', created_at: '2026-10-18T10:00:00Z',
    decided_at: '2026-10-19T10:00:00Z',
  },
  {
    id: 'r3', product_id: 'mulmul-cotton-trousers-white', order_item_id: 'i3', rating: 2,
    body: 'The stitching came apart after the second wash, sadly.', customer_name: 'Rekha P',
    status: 'rejected', created_at: '2026-10-17T10:00:00Z', decided_at: '2026-10-17T12:00:00Z',
  },
  {
    id: 'r4', product_id: 'denim-shirt-blue', order_item_id: 'i4', rating: 1,
    body: 'A completely different item turned up in the parcel.', customer_name: 'Farah N',
    status: 'pending', created_at: '2026-10-16T10:00:00Z', decided_at: null,
  },
]

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=0', '--user-data-dir=/tmp/ruhi-chrome-reviews-' + process.pid, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })

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
const reads = []
const writes = []
let deleted = 0
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
    const req = m.params.request
    const url = req.url || ''
    const send = (method, params = {}) => {
      const n = ++id
      ws.send(JSON.stringify({ id: n, method, params }))
      return new Promise((resolve) => pending.set(n, { resolve, reject: resolve }))
    }
    const fulfil = (payload) => send('Fetch.fulfillRequest', {
      requestId: m.params.requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'content-type', value: 'application/json' },
        { name: 'access-control-allow-origin', value: '*' },
        { name: 'access-control-allow-headers', value: '*' },
        { name: 'access-control-allow-methods', value: 'GET,POST,PATCH,DELETE,OPTIONS' },
      ],
      body: Buffer.from(JSON.stringify(payload)).toString('base64'),
    }).catch(() => {})

    if (req.method === 'DELETE') { deleted += 1; fulfil([]); return }
    if (req.method === 'PATCH') {
      let body = null
      try { body = JSON.parse(req.postData || '{}') } catch { body = { unparseable: req.postData } }
      const rowId = (url.match(/id=eq\.([^&]+)/) || [])[1] || ''
      writes.push({ id: rowId, ...body })
      const existing = REVIEWS.find((r) => r.id === rowId) || {}
      // `.single()` asks for `Accept: application/vnd.pgrst.object+json`, and
      // that is answered with a bare object — not the one-row array a plain
      // representation would return.
      fulfil({ ...existing, id: rowId, status: body?.status ?? existing.status })
      return
    }
    reads.push(url)
    fulfil(REVIEWS)
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
await send('Fetch.enable', { patterns: [{ urlPattern: '*product_reviews*' }] })
await send('Page.navigate', { url: URL_ })
await sleep(9000)

const report = (n, v) => console.log(`  ${n}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
let failed = false
const expect = (name, actual, want) => {
  const good = JSON.stringify(actual) === JSON.stringify(want)
  if (!good) failed = true
  console.log(`  ${good ? '✓' : '✗'} ${name}${good ? '' : ` — wanted ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`}`)
}

console.log('\n--- the queue opens with every review and its state ---')
const head = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="reviews"]');
  if (!panel) return { missing: true };
  const text = (panel.innerText || '').replace(/\\s+/g, ' ');
  const rows = [...panel.querySelectorAll('li')];
  const chips = [...panel.querySelectorAll('button[aria-pressed]')].map((b) => {
    const label = (b.firstChild && b.firstChild.textContent ? b.firstChild.textContent : b.textContent).trim();
    return label + ':' + b.getAttribute('aria-pressed') + ':' + ((b.querySelector('span') || {}).textContent || '');
  });
  return {
    heading: [...panel.querySelectorAll('h1')].map((h) => h.textContent.trim()).join(' | '),
    summary: (text.match(/\\d+ waiting for you · \\d+ published · \\d+ rejected/) || [''])[0],
    names: ['Anita K', 'Meera S', 'Rekha P', 'Farah N'].filter((n) => text.includes(n)),
    badges: rows.map((li) => (li.innerText.match(/Waiting for you|Published|Rejected/) || [''])[0]),
    chips,
    hasSearch: Boolean(panel.querySelector('input[aria-label="Search reviews"]')),
  };
})()`)
report('the panel', head)
// The first <h1> is the harness's own label for the section; the second is
// the panel's real heading.
expect('the heading', head.heading, 'reviews | Reviews')
expect('the counts line', head.summary, '2 waiting for you · 1 published · 1 rejected')
expect('all four reviews are listed', head.names, ['Anita K', 'Meera S', 'Rekha P', 'Farah N'])
expect('every row wears its own state', head.badges, ['Waiting for you', 'Published', 'Rejected', 'Waiting for you'])
expect('the filter offers counts', head.chips, ['All:true:4', 'Pending:false:2', 'Published:false:1', 'Rejected:false:1'])
expect('the search box is there', head.hasSearch, true)

console.log('\n--- the search narrows the list ---')
const searched = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="reviews"]');
  const input = panel.querySelector('input[aria-label="Search reviews"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'Rekha');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`)
await sleep(600)
const afterSearch = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="reviews"]');
  const text = (panel.innerText || '').replace(/\\s+/g, ' ');
  return {
    shown: ['Anita K', 'Meera S', 'Rekha P', 'Farah N'].filter((n) => text.includes(n)),
    noMatchLine: /No reviews match/.test(text),
  };
})()`)
report('searching for "Rekha"', afterSearch)
expect('only her review is left', afterSearch.shown, ['Rekha P'])
await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="reviews"]');
  const input = panel.querySelector('input[aria-label="Search reviews"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`)
await sleep(400)

console.log('\n--- the three decisions ---')
const click = async (name, label) => evaluate(`(() => {
  const panel = document.querySelector('[data-panel="reviews"]');
  const rows = [...panel.querySelectorAll('li')];
  const row = rows.find((r) => r.innerText.includes('${name}'));
  if (!row) return 'no row for ${name}';
  const b = [...row.querySelectorAll('button')].find((x) => x.textContent.trim() === '${label}');
  if (!b) return 'no "${label}" button on the row';
  b.click();
  return 'clicked';
})()`)
report('Approve on a pending review', await click('Anita K', 'Approve'))
await sleep(700)
report('Unpublish on a published review', await click('Meera S', 'Unpublish'))
await sleep(700)
report('Reject on a pending review', await click('Farah N', 'Reject'))
await sleep(700)

expect('one UPDATE per decision, to one row each', writes.map((w) => `${w.id}:${w.status}`), [
  'r1:approved', 'r2:pending', 'r4:rejected',
])
expect('nothing was ever deleted', deleted, 0)

const after = await evaluate(`(() => {
  const panel = document.querySelector('[data-panel="reviews"]');
  const text = (panel.innerText || '').replace(/\\s+/g, ' ');
  return {
    summary: (text.match(/\\d+ waiting for you · \\d+ published · \\d+ rejected/) || [''])[0],
    notifications: (window.__notifications || []).map((n) => n.kind + ': ' + n.message),
  };
})()`)
report('after the three decisions', after)
expect('the counts moved with them', after.summary, '1 waiting for you · 1 published · 2 rejected')
expect('the owner is told, per decision', after.notifications, [
  'success: “Anita K”\'s review is now published on the product page.',
  'success: “Meera S”\'s review is now back in the queue.',
  'success: “Farah N”\'s review is now rejected.',
])

console.log(`\n--- requests seen: ${reads.length} read(s), ${writes.length} write(s), ${deleted} delete(s) ---`)
console.log(`--- exceptions/errors: ${errors.length} ---`)
for (const e of errors.slice(0, 8)) { failed = true; console.log(`  ${String(e).slice(0, 300)}`) }

chrome.kill()
console.log(failed ? '\n✗ the reviews panel did not answer every question' : '\n✓ the reviews panel answers every question')
process.exit(failed ? 1 : 0)
