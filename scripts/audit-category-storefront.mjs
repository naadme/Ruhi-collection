// A new category on the storefront, and a photograph that is switched off.
//
// The check runs against a live site: a category is created, with a product in
// it, and the shop is looked at in a real browser to see that
//
//   * the new category is in the navigation and in the shop's own filter,
//   * the homepage's "Shop by Category" row shows it, with its photograph,
//   * switching that photograph off leaves the category and its products
//     exactly where they were, and the site falls back to another picture.
//
// Everything it creates is removed before it finishes.
//
// Usage: node scripts/audit-category-storefront.mjs [base-url]

import { execFileSync } from 'node:child_process'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = (process.argv[2] || 'http://localhost:5199').replace(/\/$/, '')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9383

const REF = 'xhsjwhzutalckeektluj'
const API = `https://${REF}.supabase.co`
const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=')
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
  }),
)
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY

const sql = (query) => {
  const out = execFileSync('/tmp/sql.sh', [query], { encoding: 'utf8' })
  const parsed = JSON.parse(out)
  if (parsed && parsed.message) throw new Error(parsed.message)
  return Array.isArray(parsed) ? parsed : (parsed[0] || [])
}
const rest = async (path) => {
  const res = await fetch(`${API}${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
  return res.json()
}

const KEY = 'audit-shop-category'
const LABEL = 'Audit Shop Category'
const PRODUCT = 'audit-shop-product'
// Two different pictures that really exist, so which one the site shows is
// unambiguous.
const CATEGORY_PHOTO = '/images/products/acid-wash-coord-set-beige.jpg'
const PRODUCT_PHOTO = '/images/products/denim-pant-coord-set-black.jpg'

const failures = []
const report = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

console.log(`\nA new category on the storefront (${BASE})\n`)

if (sql(`select key from public.categories where key = '${KEY}'`).length) {
  console.log(`  ✖ “${KEY}” already exists — this script will not touch it.`)
  process.exit(1)
}

// --- set the scene ----------------------------------------------------------
try {
  sql(`insert into public.categories (key, label, position, image)
       values ('${KEY}', '${LABEL}', 99, '${CATEGORY_PHOTO}')`)
  sql(`insert into public.products (id, title, type, price, image, colour, is_active)
       values ('${PRODUCT}', 'Audit Shop Product', '${KEY}', 499, '${PRODUCT_PHOTO}', 'Blue', true)`)

  // --- drive a real browser ------------------------------------------------
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/ruhi-chrome-shop', 'about:blank'], { stdio: 'ignore' })
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

  const visit = async (path) => {
    await send('Page.navigate', { url: `${BASE}${path}` })
    await sleep(6000)
    // The page reads the catalogue and the categories from the database, and
    // the homepage's category row only shows a category once its products
    // have arrived — so wait for the tile itself, not for the navigation.
    for (let i = 0; i < 40; i += 1) {
      const ready = await evaluate(`!!document.querySelector('a[href*="type=${KEY}"] img')`)
      if (ready) break
      await sleep(500)
    }
    return evaluate(`(() => {
      const links = [...document.querySelectorAll('a[href*="type=${KEY}"]')].map(a => a.getAttribute('href'));
      const tile = [...document.querySelectorAll('a[href*="type=${KEY}"] img')].map(i => i.getAttribute('src'));
      const body = (document.body.innerText || '');
      return { links, tile, mentions: body.includes('${LABEL}'), options: [...document.querySelectorAll('option')].filter(o => o.value === '${KEY}').length };
    })()`)
  }

  console.log('--- with the photograph switched on ---')
  const home = await visit('/')
  report('the new category is in the navigation', (home.links || []).length > 0, (home.links || []).join(' | '))
  report('the homepage shows its photograph',
    (home.tile || []).some((src) => String(src).includes(CATEGORY_PHOTO.split('/').pop().replace('.jpg', ''))),
    (home.tile || []).join(' | '))
  const shop = await visit('/shop')
  report('the shop’s own category filter offers it', (shop.options || []) > 0, `${shop.options} option(s)`)
  report('the shop page names the category', shop.mentions === true)

  // A product in the new category, and the shop page that filters to it.
  const filtered = await visit(`/shop?type=${KEY}`)
  const productShown = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('a[href^="/product/"] h3')].map(h => h.textContent.trim());
    return { cards, mentions: (document.body.innerText || '').includes('Audit Shop Product') };
  })()`)
  report('a product in the new category is listed in that category',
    (productShown.cards || []).includes('Audit Shop Product'),
    (productShown.cards || []).join(' | ') || 'no products listed')
  report('the filtered shop page names the category', filtered.mentions === true)

  console.log('\n--- with the photograph switched off ---')
  sql(`update public.categories set image_active = false where key = '${KEY}'`)
  const home2 = await visit('/')
  report('the category is still on the site', (home2.links || []).length > 0, (home2.links || []).join(' | '))
  report('the photograph that was switched off is not shown',
    !(home2.tile || []).some((src) => String(src).includes(CATEGORY_PHOTO.split('/').pop().replace('.jpg', ''))),
    (home2.tile || []).join(' | '))
  report('the site falls back to another picture',
    (home2.tile || []).some((src) => String(src).includes(PRODUCT_PHOTO.split('/').pop().replace('.jpg', ''))),
    (home2.tile || []).join(' | '))
  const stillThere = await rest(`/rest/v1/categories?key=eq.${KEY}&select=key,label,image_active`)
  report('the category itself is kept', Array.isArray(stillThere) && stillThere.length === 1,
    JSON.stringify(stillThere))
  const productStillThere = await rest(`/rest/v1/products?id=eq.${PRODUCT}&select=id,type`)
  report('and so are its products', Array.isArray(productStillThere) && productStillThere.length === 1,
    JSON.stringify(productStillThere))

  console.log(`\n  --- browser exceptions: ${errors.length} ---`)
  for (const e of errors.slice(0, 5)) console.log(`    ${String(e).slice(0, 200)}`)
  chrome.kill()
} finally {
  sql(`delete from public.products where id = '${PRODUCT}'`)
  sql(`delete from public.categories where key = '${KEY}'`)
  const left = sql(`select key from public.categories where key = '${KEY}'`)
  console.log(`\n  the cleanup left ${left.length} category row(s) behind`)
}

console.log(`\n  ${failures.length ? `${failures.length} checks failed` : 'every check passed'}`)
process.exit(failures.length ? 1 : 0)
