// The page starts its slowest work before the app's code arrives (13 Nov 2026):
// the app's first database reads, and the download of the photo the page opens
// on (src/boot/earlyStart.js, wired by vite.config.js, picked up through
// src/lib/earlyData.js). These tests pin that the early reads are EXACTLY the
// app's own reads, that the preloaded photo is exactly the one the page shows
// (same file, same srcset, same sizes — or the browser downloads it twice),
// that signed-in visitors and the dashboard are left alone, and that nothing
// here can break a page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { earlyStart } from '../src/boot/earlyStart.js'
import { earlyRows, takeEarly } from '../src/lib/earlyData.js'
import { HERO_PHOTO_SIZES, IMAGE_SIZES, PRODUCT_PHOTO_SIZES, UPLOAD_QUALITY, UPLOAD_WIDTHS, imageCopy } from '../src/lib/imageSrcSet.js'
import { HOME_HERO_SLOT } from '../src/lib/bannerSlot.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const SUPA = 'https://abcdefghijklmnop.supabase.co'
const CFG = {
  url: SUPA,
  key: 'sb_publishable_test',
  widths: UPLOAD_WIDTHS,
  smallWidth: IMAGE_SIZES.small,
  quality: UPLOAD_QUALITY,
  sizes: { product: PRODUCT_PHOTO_SIZES, hero: HERO_PHOTO_SIZES },
  heroSlot: HOME_HERO_SLOT,
  ratingsPage: 1000,
}
const upload = (name) => `${SUPA}/storage/v1/object/public/product-images/${name}.jpg`

// A browser just big enough for earlyStart: an address, storage, a <head>, fetch.
function browser({ path = '/', search = '', hash = '', stored = [], answers = {}, failing = false, storageThrows = false } = {}) {
  const head = []
  const calls = []
  const win = {
    location: { pathname: path, search, hash },
    document: {
      head: { appendChild: (el) => head.push(el) },
      createElement: (tag) => ({ tag, attrs: {}, setAttribute(k, v) { this.attrs[k] = v } }),
    },
    fetch: (url, init) => {
      calls.push({ url, init })
      if (failing) return Promise.reject(new Error('offline'))
      const table = url.slice(`${SUPA}/rest/v1/`.length).split('?')[0]
      return Promise.resolve({ ok: true, json: async () => answers[table] ?? [] })
    },
  }
  if (storageThrows) Object.defineProperty(win, 'localStorage', { get() { throw new Error('blocked') } })
  else win.localStorage = { length: stored.length, key: (i) => stored[i] ?? null }
  return { win, head, calls }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const queries = (calls) => calls.map((c) => c.url.slice(`${SUPA}/rest/v1/`.length))

// ------------------------------------------------------------ what it reads

test('a shop page starts the app\'s own first reads: catalogue, categories, ratings', () => {
  const { win, calls } = browser({ path: '/product/navy-set' })
  earlyStart(win, CFG)
  assert.deepEqual(queries(calls), [
    // ProductsContext: select('*'), newest first, then by id.
    'products?select=*&order=created_at.desc,id.asc',
    // CategoriesContext → fetchCategories: by position, then key.
    'categories?select=*&order=position.asc,key.asc',
    // RatingsContext → fetchRatingRows: the first page of 1000.
    'product_reviews?select=product_id,rating&status=eq.approved&order=id.asc&offset=0&limit=1000',
  ])
  // The publishable key in the `apikey` header, as the anonymous app sends it.
  for (const c of calls) assert.deepEqual(c.init, { headers: { apikey: 'sb_publishable_test' } })
  for (const name of ['products', 'categories', 'ratings']) assert.equal(typeof win.__ruhiEarly[name].then, 'function')
})

test('only the homepage also reads the hero banners', () => {
  const home = browser({ path: '/' })
  earlyStart(home.win, CFG)
  assert.equal(queries(home.calls)[3], 'banners?select=*&slot=eq.home_hero&order=position.asc,created_at.asc')
  const shop = browser({ path: '/shop' })
  earlyStart(shop.win, CFG)
  assert.equal(shop.calls.length, 3)
  assert.equal(shop.win.__ruhiEarly.banners, undefined)
})

test('the early queries are the ones the app\'s code builds', () => {
  // The app's queries, as written in its source: if one changes, this test
  // points at the early copy that has to change with it.
  assert.match(read('src/context/ProductsContext.jsx'), /\.from\('products'\)\.select\('\*'\)\s*\.order\('created_at', \{ ascending: false \}\)\s*\.order\('id', \{ ascending: true \}\)/)
  assert.match(read('src/lib/categories.js'), /\.from\('categories'\)\s*\.select\('\*'\)\s*\.order\('position', \{ ascending: true \}\)\s*\.order\('key', \{ ascending: true \}\)/)
  assert.match(read('src/lib/reviewStore.js'), /\.from\('product_reviews'\)\s*\.select\('product_id, rating'\)\s*\.eq\('status', 'approved'\)\s*\.order\('id', \{ ascending: true \}\)\s*\.range\(from, from \+ pageSize - 1\)/)
  assert.match(read('src/lib/reviewStore.js'), /fetchRatingRows\(\{ pageSize = 1000,/)
  assert.match(read('src/lib/banners.js'), /\.from\('banners'\)\s*\.select\('\*'\)\s*\.eq\('slot', HOME_HERO_SLOT\)\s*\.order\('position', \{ ascending: true \}\)\s*\.order\('created_at', \{ ascending: true \}\)/)
})

// ------------------------------------------------------- who is left alone

test('the dashboard, a signed-in visitor and a returning Google sign-in read for themselves', () => {
  for (const setup of [
    { path: '/admin' },
    { path: '/admin/orders' },
    { path: '/product/navy-set', stored: ['ruhi:cart', 'sb-xhsjwhzutalckeektluj-auth-token'] },
    { path: '/', hash: '#access_token=abc&refresh_token=def' },
    { path: '/account', search: '?code=1234' },
  ]) {
    const { win, calls } = browser(setup)
    earlyStart(win, CFG)
    assert.equal(calls.length, 0, JSON.stringify(setup))
    assert.equal(win.__ruhiEarly, undefined)
  }
  // Other things a shopper's phone stores (the cart, checkout details) are no reason to stop.
  const shopper = browser({ path: '/product/navy-set', stored: ['ruhi:cart', 'ruhi:checkout-details'] })
  earlyStart(shopper.win, CFG)
  assert.equal(shopper.calls.length, 3)
})

test('without settings or fetch it does nothing, and it never throws', async () => {
  const none = browser({ path: '/' })
  earlyStart(none.win, { ...CFG, key: '' })
  assert.equal(none.calls.length, 0)
  const old = browser({ path: '/' })
  delete old.win.fetch
  assert.doesNotThrow(() => earlyStart(old.win, CFG))
  // Storage that throws (a privacy mode): reads still start.
  const blocked = browser({ path: '/shop', storageThrows: true })
  assert.doesNotThrow(() => earlyStart(blocked.win, CFG))
  assert.equal(blocked.calls.length, 3)
  // A dead network: the reads fail quietly and the app is left to ask again.
  const offline = browser({ path: '/product/navy-set', failing: true })
  assert.doesNotThrow(() => earlyStart(offline.win, CFG))
  await settle()
  assert.equal(await earlyRows('products', offline.win), undefined)
  assert.doesNotThrow(() => earlyStart(null, CFG))
})

// -------------------------------------------------------- the first photo

test('a product page preloads the photo its gallery opens on, exactly as the <img> asks for it', async () => {
  const rows = [
    { id: 'other-colour', gallery: [upload('other')], image: upload('other') },
    { id: 'navy-set', gallery: [upload('navy-front'), upload('navy-back')], image: upload('navy-main'), hover: upload('navy-hover') },
  ]
  const { win, head } = browser({ path: '/product/navy-set/', answers: { products: rows } })
  earlyStart(win, CFG)
  await settle(); await settle()
  assert.equal(head.length, 1)
  const [link] = head
  const copy = imageCopy(upload('navy-front'))
  assert.equal(link.rel, 'preload')
  assert.equal(link.attrs.as, 'image')
  assert.equal(link.href, copy.small)
  assert.equal(link.attrs.imagesrcset, copy.srcset)
  assert.equal(link.attrs.imagesizes, PRODUCT_PHOTO_SIZES)
  assert.equal(link.attrs.fetchpriority, 'high')
})

test('the photo order is the gallery first, then the main photo, then the hover photo', async () => {
  const cases = [
    [{ id: 'a', gallery: [], image: upload('main'), hover: upload('hover') }, upload('main')],
    [{ id: 'a', gallery: null, image: null, hover: upload('hover') }, upload('hover')],
    [{ id: 'a', gallery: [null, upload('g2')], image: upload('main') }, upload('g2')],
  ]
  for (const [row, expected] of cases) {
    const { win, head } = browser({ path: '/product/a', answers: { products: [row] } })
    earlyStart(win, CFG)
    await settle(); await settle()
    assert.equal(head[0]?.attrs.imagesrcset, imageCopy(expected).srcset)
  }
})

test('nothing is preloaded for an unknown product or a photo with no resized copies', async () => {
  for (const rows of [[{ id: 'b', image: upload('b') }], [{ id: 'a', image: '/images/products/a.jpg' }], [{ id: 'a' }]]) {
    const { win, head } = browser({ path: '/product/a', answers: { products: rows } })
    earlyStart(win, CFG)
    await settle(); await settle()
    assert.equal(head.length, 0)
  }
})

test('the homepage preloads the first active banner with the hero\'s sizes', async () => {
  const banners = [
    { id: 1, image: '  ', is_active: true },
    { id: 2, image: upload('switched-off'), is_active: false },
    { id: 3, image: upload('hero'), is_active: true },
  ]
  const { win, head } = browser({ path: '/', answers: { banners } })
  earlyStart(win, CFG)
  await settle(); await settle()
  assert.equal(head.length, 1)
  assert.equal(head[0].attrs.imagesrcset, imageCopy(upload('hero')).srcset)
  assert.equal(head[0].attrs.imagesizes, HERO_PHOTO_SIZES)
})

test('the page and the preload share their sizes through one constant each', () => {
  const product = read('src/pages/Product.jsx')
  assert.match(product, /sizes=\{PRODUCT_PHOTO_SIZES\}/)
  assert.match(product, /fetchpriority=\{active === 0 \? 'high' : undefined\}/)
  const hero = read('src/components/Sections.jsx')
  assert.match(hero, /sizes=\{HERO_PHOTO_SIZES\}/)
  assert.match(hero, /fetchpriority=\{at === 0 \? 'high' : undefined\}/)
  const config = read('vite.config.js')
  assert.match(config, /sizes: \{ product: PRODUCT_PHOTO_SIZES, hero: HERO_PHOTO_SIZES \}/)
  assert.match(config, /widths: UPLOAD_WIDTHS/)
  assert.match(config, /quality: UPLOAD_QUALITY/)
  assert.match(config, /smallWidth: IMAGE_SIZES\.small/)
})

// ------------------------------------------------------ how the app uses it

test('each early read is handed out once, and a failed or odd answer means "ask yourself"', async () => {
  const win = { __ruhiEarly: { products: Promise.resolve([{ id: 1 }]), categories: Promise.reject(new Error('x')), ratings: Promise.resolve({ not: 'rows' }) } }
  win.__ruhiEarly.categories.catch(() => {})
  assert.deepEqual(await earlyRows('products', win), [{ id: 1 }])
  assert.equal(await earlyRows('products', win), undefined, 'the second read goes to the database')
  assert.equal(await earlyRows('categories', win), undefined)
  assert.equal(await earlyRows('ratings', win), undefined)
  assert.equal(takeEarly('banners', win), null)
  assert.equal(takeEarly('products', undefined), null)
})

test('the catalogue, categories, ratings and hero use the early answer before asking', () => {
  const products = read('src/context/ProductsContext.jsx')
  assert.match(products, /const early = await earlyRows\('products'\)/)
  assert.match(products, /const \{ data, error \} = early\s*\? \{ data: early, error: null \}/)
  assert.match(read('src/context/CategoriesContext.jsx'), /earlyRows\('categories'\)\s*\.then\(\(rows\) => fetchCategories\(\{ rows \}\)\)/)
  assert.match(read('src/context/RatingsContext.jsx'), /earlyRows\('ratings'\)\s*\.then\(\(firstPage\) => fetchRatingRows\(\{ firstPage \}\)\)/)
  assert.match(read('src/components/Sections.jsx'), /earlyRows\('banners'\)\s*\.then\(\(rows\) => fetchHomeBanners\(\{ rows \}\)\)/)
  // The dashboard's strict reads never take the early answer.
  assert.match(read('src/admin/BannerPanel.jsx'), /fetchHomeBanners\(\{ strict: true \}\)/)
})

// ------------------------------------------------------------- the build

test('the build puts the script right after GTM, before any stylesheet, with a preconnect for photos', async () => {
  process.env.VITE_SUPABASE_URL = SUPA
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test'
  const { default: config } = await import('../vite.config.js')
  const plugin = config.plugins.flat().find((p) => p && p.name === 'early-start')
  assert.ok(plugin, 'the early-start plugin is registered')
  plugin.configResolved({ mode: 'test-no-env-file', root: '/nonexistent-ruhi-root' })
  const html = await plugin.transformIndexHtml.handler(read('index.html'))
  const gtmEnd = html.indexOf('<!-- End Google Tag Manager -->')
  const script = html.indexOf('<script>', gtmEnd)
  const firstStylesheet = html.indexOf('rel="stylesheet"')
  assert.ok(gtmEnd > 0 && script > gtmEnd, 'GTM stays first in <head>, as the tracking brief asks')
  // index.html itself has no stylesheet since the fonts moved into the CSS bundle
  // (D2); Vite adds its own CSS link at the end of <head>, after this script.
  assert.ok(firstStylesheet === -1 || script < firstStylesheet, 'a script after a stylesheet would wait for it')
  assert.match(html.slice(script, html.indexOf('</script>', script)), /__ruhiEarly/)
  assert.match(html, new RegExp(`<link rel="preconnect" href="${SUPA}" />`))
  // Small enough to cost nothing: a few hundred bytes compressed.
  const inline = html.slice(script, html.indexOf('</script>', script))
  assert.ok(inline.length < 3000, `inline script is ${inline.length} bytes`)
})

// --------------------------------------------------------- live updates

test('only a signed-in visitor opens the live product link', () => {
  const products = read('src/context/ProductsContext.jsx')
  const effect = products.slice(products.indexOf("let channel = null"), products.indexOf("}, [applyRow, removeRow, reload])"))
  assert.match(effect, /\.then\(\(\{ data \}\) => \{ if \(data\?\.session\) open\(\) \}\)/)
  assert.match(effect, /if \(session\) open\(\)\s*else if \(event === 'SIGNED_OUT'\) close\(\)/)
  assert.match(effect, /\.channel\('products-changes'\)/)
})
