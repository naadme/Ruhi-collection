// Every product card on the live site, clicked for real.
//
//   node scripts/verify-product-links.mjs [baseUrl]
//
// The shop's grids — the homepage, a category page, the search results, the
// wishlist and the "you may also like" row — all render the same card, and
// every one of them must open the product it shows. This walks the live site
// in a real browser, clicks the PHOTOGRAPH of every card on every page (the
// way a shopper clicks it) and reads back what the page it opened shows: the
// address, the product id, the photograph, the name, the price, the colour
// and the sizes.
//
// A card that opens the category listing, another product, or a "not found"
// page fails the check. A product that does not exist must show the "Product
// not found" state rather than somebody else's product.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = (process.argv[2] || 'https://www.ruhi-collections.com').replace(/\/$/, '')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// No fixed debugging port: Chrome picks one and announces it (see below).

const ok = (m) => console.log(`  \u2713 ${m}`)
const bad = (m) => { console.log(`  \u2717 ${m}`); failures += 1 }
let failures = 0

// ---- a tiny Chrome DevTools Protocol client --------------------------------
class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`${method} timed out`))
        }
      }, 60000)
    })
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    })
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'the page threw')
    return res.result.value
  }
}

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=0',
  '--user-data-dir=/tmp/ruhi-chrome-product-links-' + process.pid, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

// Chrome chooses the port and announces it on stderr. Asking for a fixed port
// instead would mean that a browser left behind by a run that died could hold
// it — and this script would then quietly drive *that* browser, with its old
// catalogue and its old scroll positions, instead of the one it just started.
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
  bad('Chrome did not start')
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
  bad('Chrome did not open a tab')
  chrome.kill()
  process.exit(1)
}

const ws = new WebSocket(wsUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})
const cdp = new CDP(ws)
await cdp.send('Page.enable')
await cdp.send('Runtime.enable')
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

/** Read until two consecutive readings agree.
 *
 *  The catalogue arrives from the database some moments after the page paints
 *  (the bundled seed in `src/data/products.js` fills that gap), so a reading
 *  taken in between describes the seed — its placeholder prices and its old
 *  photographs — rather than the shop. Waiting for the page to stop changing
 *  describes the shop, and costs only the moments the seed was showing. */
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

/** Open a page and wait for the catalogue to arrive. */
const go = async (url) => {
  await cdp.send('Page.navigate', { url })
  for (let i = 0; i < 60; i += 1) {
    await sleep(500)
    const ready = await cdp.evaluate('document.readyState === "complete" && !!document.querySelector("main")')
    if (ready) break
  }
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    const n = await cdp.evaluate('document.querySelectorAll(\'a[href^="/product/"]\').length')
    if (n > 0) break
  }
  // …and then for the catalogue the database sent to be the one on screen.
  return settle(() => cdp.evaluate(`[...document.querySelectorAll('a[href^="/product/"]')]
    .map((a) => { const img = a.querySelector('img');
      return a.getAttribute('href') + '|' + (a.innerText || '').match(/₹[\\d,]+/) + '|' + (img ? (img.getAttribute('src') || '') : '') })`))
}

/** The cards on the page, as the browser sees them. */
const cardsOn = (page) => cdp.evaluate(`(() => {
  const norm = (f) => String(f || '').split('/').pop().replace(/-640(\\.[a-z0-9]+)$/i, '$1')
  return [...document.querySelectorAll('a[href^="/product/"]')].map((a) => {
    const img = a.querySelector('img')
    const text = (a.innerText || '').trim().replace(/\\s+/g, ' ')
    return {
      href: a.getAttribute('href'),
      name: (a.querySelector('h3') || {}).innerText || text.split('₹')[0].trim(),
      price: (text.match(/₹[\\d,]+/) || [])[0] || '',
      image: norm(img && (img.currentSrc || img.src)),
    }
  })
})()`)

/** A REAL click on the photograph of the card with this address.
 *
 *  The card is found by its ADDRESS and not by its position: the homepage's
 *  row is the owner's own selection as soon as it arrives and the derived one
 *  until then, so the same card can sit at a different index on two loads. */
const clickPhoto = async (href) => {
  const expr = `(() => {
    const a = [...document.querySelectorAll('a[href^="/product/"]')].find((x) => x.getAttribute('href') === ${JSON.stringify(href)})
    if (!a) return null
    const img = a.querySelector('img')
    if (!img) return null
    img.scrollIntoView({ block: 'center' })
    const r = img.getBoundingClientRect()
    if (!r.width) return null
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`
  const at = await cdp.evaluate(expr)
  if (!at) return null
  await sleep(300)
  const again = await cdp.evaluate(expr)
  if (!again) return null
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: again.x, y: again.y })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: again.x, y: again.y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: again.x, y: again.y, button: 'left', clickCount: 1 })
  await sleep(1600)
  // The product page paints from the same bundled seed for a moment before
  // the database answers, so — as on the listing — the reading is taken once
  // the page has stopped changing.
  return settle(() => cdp.evaluate(`(() => {
    const img = document.querySelector('section img')
    const norm = (f) => String(f || '').split('/').pop().replace(/-640(\\.[a-z0-9]+)$/i, '$1')
    // The price line may also carry the "was" price and the discount
    // ("₹849 ₹999 15% off"), so the first ₹ on the first price line of the
    // product's own section is the price — not a card further down the page.
    const section = document.querySelector('section')
    const price = [...(section ? section.querySelectorAll('p') : [])].map((p) => (p.innerText || '').trim())
      .map((t) => (t.match(/^₹[\\d,]+/) || [''])[0]).find(Boolean) || ''
    return {
      url: location.pathname + location.search,
      name: (document.querySelector('h1') || {}).innerText || '',
      price,
      colour: (document.querySelector('fieldset legend') || {}).innerText || '',
      sizes: [...document.querySelectorAll('#size-options button')].map((b) => b.innerText.trim()).join(','),
      image: norm(img && (img.currentSrc || img.src)),
      notFound: document.body.innerText.includes('Product not found'),
    }
  })()`))
}

const PAGES = ['/', '/shop', '/shop?type=tops', '/shop?type=dress', '/shop?type=coord',
  '/shop?type=trousers', '/shop?q=blue', '/shop?q=red', '/collections', '/wishlist']

try {
  console.log(`\nThe product cards on ${BASE}\n`)
  for (const path of PAGES) {
    await go(`${BASE}${path}`)
    const cards = await cardsOn()
    if (!cards.length) {
      console.log(`  ${path} — no product cards`)
      continue
    }
    let checked = 0
    for (const card of cards) {
      await go(`${BASE}${path}`)
      const page = await clickPhoto(card.href)
      if (!page) {
        bad(`${path}: the photograph of "${card.name}" could not be clicked`)
        continue
      }
      checked += 1
      if (page.url !== card.href) {
        bad(`${path}: "${card.name}" opened ${page.url}, not ${card.href}`)
        continue
      }
      if (page.notFound) {
        bad(`${path}: "${card.name}" opened a Product not found page`)
        continue
      }
      if (page.image && card.image && page.image !== card.image) {
        bad(`${path}: "${card.name}" opened a page with the photograph ${page.image}, not ${card.image}`)
        continue
      }
      if (card.price && page.price && page.price !== card.price) {
        bad(`${path}: "${card.name}" opened a page priced ${page.price}, not ${card.price}`)
        continue
      }
      ok(`${path}: "${card.name}" → ${page.url} (${page.name}, ${page.price}, ${page.colour || 'no colour row'}, sizes ${page.sizes || '—'})`)
    }
    console.log(`  ${path} — ${checked} card(s) checked`)
  }

  // A product that does not exist must say so, and must not open another one.
  await go(`${BASE}/product/this-product-was-deleted`)
  const gone = await cdp.evaluate('({ h1: (document.querySelector("h1") || {}).innerText || "" })')
  if (/not found/i.test(gone.h1)) ok(`a product that does not exist shows "${gone.h1}"`)
  else bad(`a product that does not exist shows "${gone.h1}" instead of a Product not found state`)
} finally {
  chrome.kill()
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nEvery product card opens the product it shows.')
process.exit(failures ? 1 : 0)
