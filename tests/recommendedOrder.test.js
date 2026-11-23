// "Recommended" on category pages (23 Nov 2026): bestsellers (the Badge says
// Bestseller), then designs first added in the last 14 days, then the rest by
// orders received and then views (one position per design from
// public.product_rank). All Products and search keep "Featured".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  NEW_ARRIVAL_DAYS, firstAdded, isBestseller, isNewArrival, recommendedOrder,
} from '../src/lib/recommendedOrder.js'
import { earlyStart } from '../src/boot/earlyStart.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const NOW = Date.parse('2026-11-23T12:00:00+05:30')
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()
const card = (id, { badge = null, added = 60, colours } = {}) => ({
  id: `${id}-red`,
  design_id: id,
  badge,
  created_at: daysAgo(added),
  ...(colours ? { colors: colours.map((d, i) => ({ id: `${id}-${i}`, design_id: id, created_at: daysAgo(d) })) } : {}),
})
const ids = (cards) => cards.map((c) => c.design_id)

test('bestsellers first, then new arrivals, then the rest', () => {
  const cards = [
    card('old-a', { added: 50 }),
    card('new-a', { added: 3 }),
    card('best-a', { badge: 'Bestseller', added: 40 }),
    card('old-b', { added: 30 }),
    card('new-b', { added: 10 }),
  ]
  const ranks = new Map([['old-b', 1], ['old-a', 2]])
  assert.deepEqual(ids(recommendedOrder(cards, { ranks, now: NOW })), ['best-a', 'new-a', 'new-b', 'old-b', 'old-a'])
})

test('bestsellers and the rest follow the ranking (orders, then views); new arrivals go newest first', () => {
  const cards = [
    card('best-low', { badge: 'Bestseller' }),
    card('best-top', { badge: 'Bestseller' }),
    card('new-older', { added: 12 }),
    card('new-newest', { added: 1 }),
    card('rest-low'),
    card('rest-top'),
  ]
  // A new arrival's own position does not move it: its group is newest first.
  const ranks = new Map([['best-top', 1], ['new-older', 2], ['rest-top', 3], ['best-low', 4], ['rest-low', 5], ['new-newest', 6]])
  assert.deepEqual(
    ids(recommendedOrder(cards, { ranks, now: NOW })),
    ['best-top', 'best-low', 'new-newest', 'new-older', 'rest-top', 'rest-low'],
  )
})

test('a bestseller that is also new stays with the bestsellers', () => {
  const cards = [card('new', { added: 2 }), card('best-new', { badge: 'Bestseller', added: 1 })]
  assert.deepEqual(ids(recommendedOrder(cards, { now: NOW })), ['best-new', 'new'])
})

test('without the ranking (slow or failed read) each group goes newest first', () => {
  const cards = [card('rest-old', { added: 90 }), card('rest-mid', { added: 30 }), card('best', { badge: 'Bestseller' }), card('new', { added: 5 })]
  for (const ranks of [undefined, new Map()]) {
    assert.deepEqual(ids(recommendedOrder(cards, { ranks, now: NOW })), ['best', 'new', 'rest-mid', 'rest-old'])
  }
})

test('a design without a position goes after the ranked ones in its group', () => {
  const cards = [card('unranked', { added: 20 }), card('ranked', { added: 80 })]
  assert.deepEqual(ids(recommendedOrder(cards, { ranks: new Map([['ranked', 9]]), now: NOW })), ['ranked', 'unranked'])
})

test('new arrival: first added within 14 days; a new colour does not make an old design new', () => {
  assert.equal(NEW_ARRIVAL_DAYS, 14)
  assert.equal(isNewArrival(card('a', { added: 13.9 }), NOW), true)
  assert.equal(isNewArrival(card('b', { added: 14.1 }), NOW), false)
  // An older design that gained a colour 2 days ago: its first colour decides.
  const grown = card('c', { added: 2, colours: [40, 2] })
  assert.equal(firstAdded(grown), Date.parse(daysAgo(40)))
  assert.equal(isNewArrival(grown, NOW), false)
  // No date at all (the bundled starter catalogue): never new.
  assert.equal(isNewArrival({ id: 'x' }, NOW), false)
})

test('the Bestseller badge is read whatever its case or spacing; other badges are not bestsellers', () => {
  for (const badge of ['Bestseller', 'BESTSELLER', 'Best seller', ' best-seller ']) assert.equal(isBestseller({ badge }), true, badge)
  for (const badge of ['New arrival', '', null, undefined, 'Bestseller pick']) assert.equal(isBestseller({ badge }), false, String(badge))
})

test('the list it was given is left as it was', () => {
  const cards = [card('a', { added: 50 }), card('b', { badge: 'Bestseller' })]
  const before = ids(cards)
  recommendedOrder(cards, { now: NOW })
  assert.deepEqual(ids(cards), before)
})

test('the shop: Recommended is the default on category pages only, Featured elsewhere', () => {
  const shop = read('src/pages/Shop.jsx')
  assert.match(shop, /const categoryView = !!t && !searching/)
  assert.match(shop, /const recommended = categoryView && !sort/)
  assert.match(shop, /\['', categoryView \? 'Recommended' : 'Featured'\]/)
  assert.match(shop, /if \(recommended\) return recommendedOrder\(filtered, \{ ranks \}\)/)
  // The cards are shown once, in their final order: the grid waits (at most
  // RANK_WAIT_MS) for the ranking instead of reordering after it lands.
  assert.match(shop, /\(recommended && !ranksSettled\)/)
  // Every product carries the date it was added (already in the row read).
  assert.match(read('src/context/ProductsContext.jsx'), /created_at: r\.created_at \|\| null/)
})

test('only a category landing starts the ranking read early', () => {
  const browser = (path, search = '') => {
    const calls = []
    const win = {
      location: { pathname: path, search, hash: '' },
      localStorage: { length: 0, key: () => null },
      document: { head: { appendChild() {} }, createElement: () => ({ setAttribute() {} }) },
      fetch: (url) => { calls.push(url); return Promise.resolve({ ok: true, json: async () => [] }) },
    }
    return { win, calls }
  }
  const CFG = { url: 'https://abc.supabase.co', key: 'k', widths: [320], smallWidth: 320, quality: 70, sizes: { product: '', hero: '' }, heroSlot: 'home_hero', ratingsPage: 1000 }
  const reads = (path, search) => {
    const b = browser(path, search)
    earlyStart(b.win, CFG)
    return { urls: b.calls.map((u) => u.split('/rest/v1/')[1]), box: b.win.__ruhiEarly }
  }
  const category = reads('/shop', '?type=coord')
  assert.ok(category.urls.includes('product_rank?select=design_id,position'))
  assert.equal(typeof category.box.ranks.then, 'function')
  for (const [path, search] of [['/shop', ''], ['/shop', '?q=red'], ['/shop', '?type=coord&q=red'], ['/', ''], ['/product/navy-set', '']]) {
    const r = reads(path, search)
    assert.ok(!r.urls.some((u) => u.startsWith('product_rank')), `${path}${search}`)
  }
  // The same query the app makes (src/lib/productRank.js).
  assert.match(read('src/lib/productRank.js'), /\.from\('product_rank'\)\.select\('design_id,position'\)/)
  assert.match(read('src/lib/productRank.js'), /earlyRows\('ranks'\)/)
})

test('the ranking table: positions only, readable by anyone, written only by the hourly job', () => {
  const sql = read('supabase/migrations/20261123120000_product_rank.sql')
  assert.match(sql, /create table if not exists public\.product_rank \(\s*design_id\s+text primary key,\s*position\s+integer not null,\s*updated_at\s+timestamptz not null default now\(\)\s*\)/)
  assert.doesNotMatch(sql.split('create or replace function')[0], /orders\s+integer|views\s+integer/, 'no counts are published')
  assert.match(sql, /grant select on public\.product_rank to anon, authenticated/)
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*product_rank/)
  assert.match(sql, /revoke all on function public\.refresh_product_rank\(\) from public, anon, authenticated/)
  assert.match(sql, /o\.payment_status = 'paid'\s+and coalesce\(o\.is_test, false\) = false\s+and o\.created_at >= now\(\) - interval '30 days'/)
  assert.match(sql, /count\(distinct oi\.order_id\)/)
  assert.match(sql, /order by coalesce\(o\.orders, 0\) desc, coalesce\(v\.views, 0\) desc, d\.first_added desc, d\.design_id/)
  assert.match(sql, /cron\.schedule\('product-rank-hourly', '20 \* \* \* \*', 'select public\.refresh_product_rank\(\)'\)/)
})
