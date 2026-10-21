// Click every homepage category card in a real browser and check where it
// lands and what it shows.
//
//   node scripts/verify-category-clicks.mjs [baseUrl]
//
// This is the end-to-end check of the homepage's "Shop by Category" row: the
// card is clicked the way a shopper clicks it (on the picture), and the page
// it opens, its heading and the products on it are read back.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = (process.argv[2] || 'https://www.ruhi-collections.com').replace(/\/$/, '')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// No fixed debugging port: Chrome picks one and announces it (see below).

const ok = (m) => console.log(`  \u2713 ${m}`)
const bad = (m) => console.log(`  \u2717 ${m}`)

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
      }, 30000)
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
  '--user-data-dir=/tmp/ruhi-chrome-profile-' + process.pid, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

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

const go = async (url) => {
  await cdp.send('Page.navigate', { url })
  for (let i = 0; i < 60; i += 1) {
    await sleep(500)
    const ready = await cdp.evaluate('document.readyState === "complete" && !!document.querySelector("main")')
    if (ready) break
  }
  // the catalogue arrives from the database after the shell has rendered
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    const n = await cdp.evaluate('document.querySelectorAll(\'a[href^="/product/"]\').length')
    if (n > 0) break
  }
}

let failures = 0
try {
  console.log(`\nThe homepage category cards on ${BASE}`)
  await go(BASE)

  // The cards, as the browser sees them.
  const cards = await cdp.evaluate(`(() => {
    const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Shop by Category')
    if (!heading) return { error: 'the "Shop by Category" section is not on the page' }
    const grid = heading.parentElement.querySelector('.grid')
    return [...grid.querySelectorAll('a')].map((a) => ({
      href: a.getAttribute('href'),
      label: a.textContent.trim(),
      image: a.querySelector('img')?.getAttribute('src') || '',
      hasPicture: !!a.querySelector('img'),
    }))
  })()`)

  if (cards?.error) {
    bad(cards.error)
    failures += 1
  } else {
    ok(`${cards.length} category card(s) on the homepage`)
    for (const card of cards) {
      const label = card.label || '(no label)'
      if (!card.hasPicture) {
        bad(`${label}: the card has no picture`)
        failures += 1
        continue
      }
      if (!/^\/shop\?type=[a-z0-9-]+$/.test(card.href)) {
        bad(`${label}: the card points at ${card.href} instead of a category in the shop`)
        failures += 1
        continue
      }
      const key = new URLSearchParams(card.href.split('?')[1]).get('type')

      // Click the PICTURE, the way a shopper does.
      await go(BASE)
      const clicked = await cdp.evaluate(`(() => {
        const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Shop by Category')
        const grid = heading.parentElement.querySelector('.grid')
        const link = [...grid.querySelectorAll('a')].find((a) => a.getAttribute('href') === ${JSON.stringify(card.href)})
        if (!link) return false
        link.querySelector('img').click()
        return true
      })()`)
      if (!clicked) {
        bad(`${label}: the card could not be clicked`)
        failures += 1
        continue
      }

      // Wait for the shop page to take over.
      let url = ''
      for (let i = 0; i < 40; i += 1) {
        await sleep(250)
        url = await cdp.evaluate('location.pathname + location.search')
        if (url.includes('/shop')) break
      }
      for (let i = 0; i < 40; i += 1) {
        await sleep(250)
        const n = await cdp.evaluate('document.querySelectorAll(\'a[href^="/product/"]\').length')
        if (n > 0) break
      }

      const page = await cdp.evaluate(`({
        url: location.pathname + location.search,
        heading: document.querySelector('h1')?.textContent.trim() || '',
        count: document.querySelectorAll('a[href^="/product/"]').length,
        selected: document.querySelector('select')?.value || '',
        products: [...document.querySelectorAll('a[href^="/product/"]')].map((a) => a.getAttribute('href')),
      })`)

      const problems = []
      if (page.url !== card.href) problems.push(`landed on ${page.url}`)
      if (page.selected !== key) problems.push(`the Type filter shows "${page.selected}"`)
      if (!page.count) problems.push('no products are shown')
      if (problems.length) {
        bad(`${label} → ${card.href}: ${problems.join('; ')}`)
        failures += 1
      } else {
        ok(`${label} → ${page.url} — heading “${page.heading}”, ${page.count} style(s), filter “${page.selected}”`)
      }
    }
  }
} finally {
  chrome.kill()
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nEvery category card opens its own category.')
process.exit(failures ? 1 : 0)
