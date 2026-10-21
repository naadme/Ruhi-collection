// The product page as a customer sees it, live: the Product ID, the
// description and the customer reviews.
//
//   node scripts/audit-product-page.mjs           (npm run audit:product)
//
// What it proves, against the shop that is actually running:
//   * the Product ID printed on the page is the row's own six-character code;
//   * a description is shown as the owner typed it, with its line breaks;
//   * a product with no description still marks where one would go, and
//     shows no empty paragraph;
//   * the reviews section is always there, and says plainly when there are
//     none yet, rather than pretending a product has never been reviewed.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import fs from 'node:fs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.RUHI_BASE || 'https://www.ruhi-collections.com'

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n')
  .filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const H = { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${env.VITE_SUPABASE_PUBLISHABLE_KEY}` }

// Two products to look at: one the owner has written a description for, and
// one they have not.
const catalogue = await (await fetch(
  `${env.VITE_SUPABASE_URL}/rest/v1/products?select=id,title,sku,description,price,reviews,rating&order=id.asc&limit=400`,
  { headers: H },
)).json()
const withText = catalogue.find((p) => String(p.description || '').trim().length > 20)
const withoutText = catalogue.find((p) => !String(p.description || '').trim())
if (!withText || !withoutText) {
  console.log('the catalogue has no product with a description, or none without — nothing to compare')
  process.exit(1)
}

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=0', '--user-data-dir=/tmp/ruhi-chrome-product-page-' + process.pid,
  'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })

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
if (!announced) { console.log('Chrome did not start'); chrome.kill(); process.exit(1) }

let wsUrl = ''
for (let i = 0; i < 20 && !wsUrl; i += 1) {
  await sleep(300)
  try {
    const list = await (await fetch(`http://127.0.0.1:${announced}/json/list`)).json()
    const page = list.find((t) => t.type === 'page')
    if (page?.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl
  } catch { /* the target list is not up yet */ }
}
if (!wsUrl) { console.log('Chrome did not open a tab'); chrome.kill(); process.exit(1) }

const ws = new WebSocket(wsUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})
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
})
const send = (method, params = {}) => {
  const n = ++id
  ws.send(JSON.stringify({ id: n, method, params }))
  return new Promise((resolve, reject) => pending.set(n, { resolve, reject }))
}
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
  return r.result.value
}
await send('Page.enable')
await send('Runtime.enable')

/** Read until two readings agree: the page paints from the bundled seed
 *  before the database answers, and a reading taken in between describes the
 *  seed rather than the shop. */
const settle = async (read, tries = 40) => {
  let last = JSON.stringify(await read())
  for (let i = 0; i < tries; i += 1) {
    await sleep(700)
    const now = JSON.stringify(await read())
    if (now === last) return JSON.parse(now)
    last = now
  }
  return JSON.parse(last)
}

const READ = `(() => {
  const text = (el) => (el ? (el.innerText || '').replace(/\\s+/g, ' ').trim() : '');
  const headings = [...document.querySelectorAll('h2')];
  const descHead = headings.find((h) => (h.innerText || '').trim() === 'Description');
  const descBlock = descHead ? descHead.parentElement : null;
  const descPara = descBlock ? [...descBlock.querySelectorAll('p')].map((p) => p.innerText).find((t) => t && t.trim()) : '';
  const idLine = [...document.querySelectorAll('p')].find((p) => (p.innerText || '').includes('Product ID'));
  const code = idLine ? (idLine.innerText.match(/[A-Z0-9]{6}/) || [''])[0] : '';
  const reviewHead = document.querySelector('#reviews-heading');
  const reviewBlock = reviewHead ? reviewHead.closest('section') : null;
  return {
    url: location.pathname,
    name: text(document.querySelector('h1')),
    code,
    descHead: Boolean(descHead),
    desc: (descPara || '').trim(),
    reviewsHead: text(reviewHead),
    reviewsBody: reviewBlock ? text(reviewBlock).slice(text(reviewHead).length).trim() : '',
    rating: text(document.querySelector('fieldset legend')),
    price: ([...document.querySelectorAll('p')].map((p) => (p.innerText || '').trim()).find((t) => /^₹[\\d,]+/.test(t)) || ''),
    canWrite: Boolean([...document.querySelectorAll('h3')].find((h) => (h.innerText || '').trim() === 'Write a review')),
  };
})()`

const open = async (id) => {
  await send('Page.navigate', { url: `${BASE}/product/${id}` })
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    const ready = await evaluate('document.readyState === "complete" && !!document.querySelector("h1")')
    if (ready) break
  }
  return settle(() => evaluate(READ))
}

let failed = false
const expect = (name, actual, want) => {
  const good = JSON.stringify(actual) === JSON.stringify(want)
  if (!good) failed = true
  console.log(`  ${good ? '✓' : '✗'} ${name}${good ? '' : ` — wanted ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`}`)
}

console.log('\n--- a product the owner has written about ---')
const a = await open(withText.id)
console.log('  the page:', JSON.stringify(a))
expect('the name is the product', a.name, withText.title.replace(/ - [^]+$/, '').trim())
expect('the Product ID printed is the row’s own code', a.code, withText.sku)
expect('the description is shown', a.desc, String(withText.description).trim())
expect('the reviews section is there', a.reviewsHead, 'Customer reviews')
// Nobody is signed in here, and only someone who actually bought the piece
// may be offered the writing box.
expect('a visitor who is not signed in is offered no review form', a.canWrite, false)

console.log('\n--- a product with no description ---')
const b = await open(withoutText.id)
console.log('  the page:', JSON.stringify(b))
expect('the Product ID printed is the row’s own code', b.code, withoutText.sku)
expect('the place for a description is still marked', b.descHead, true)
expect('but no empty paragraph is shown', b.desc, '')
expect('the reviews section is there', b.reviewsHead, 'Customer reviews')
expect('and it says plainly that there are none yet', /No reviews yet/.test(b.reviewsBody), true)

console.log(`\n--- browser exceptions: ${errors.length} ---`)
for (const e of errors.slice(0, 6)) { failed = true; console.log(`  ${String(e).slice(0, 240)}`) }

chrome.kill()
console.log(failed ? '\n✗ the product page did not answer every question' : '\n✓ the product page answers every question')
process.exit(failed ? 1 : 0)
