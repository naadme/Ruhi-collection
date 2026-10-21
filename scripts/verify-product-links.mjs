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
const PORT = 9355

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
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/ruhi-chrome-product-links', 'about:blank',
], { stdio: 'ignore' })

let wsUrl = ''
for (let i = 0; i < 40 && !wsUrl; i += 1) {
  await sleep(500)
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const page = list.find((t) => t.type === 'page')
    if (page?.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl
  } catch { /* chrome is still starting */ }
}
if (!wsUrl) {
  bad('Chrome did not start')
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
  await sleep(2200)
  return cdp.evaluate(`(() => {
    const img = document.querySelector('section img')
    const norm = (f) => String(f || '').split('/').pop().replace(/-640(\\.[a-z0-9]+)$/i, '$1')
    const price = [...document.querySelectorAll('p')].map((p) => (p.innerText || '').trim())
      .find((t) => /^₹[\\d,]+$/.test(t)) || ''
    return {
      url: location.pathname + location.search,
      name: (document.querySelector('h1') || {}).innerText || '',
      price,
      colour: (document.querySelector('fieldset legend') || {}).innerText || '',
      sizes: [...document.querySelectorAll('#size-options button')].map((b) => b.innerText.trim()).join(','),
      image: norm(img && (img.currentSrc || img.src)),
      notFound: document.body.innerText.includes('Product not found'),
    }
  })()`)
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
