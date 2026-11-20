// Sold out (20 Nov 2026, Sold_Out_Proposal_2026-11-20.html). The user's rules:
//   1. no stock counting: each colour, in each size, is in stock or sold out;
//   2. people keep landing on a sold-out page (video ads, shares), so it must
//      sell something else properly;
//   3. a sold-out item is never recommended.
// The owner's decisions: fully sold-out designs leave the shop grid; no
// WhatsApp "coming back?" link; the 6 colours hidden since 20 Oct stay hidden
// (stopped); a colour sold out in every size raises an admin alert that
// becomes a 24-hour reminder to change the ad by hand; the block gets its own
// GA4 list name.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  designRows, firstInStockSize, inStockSizes, isColourSoldOut, isDesignSoldOut, isSizeSoldOut, listableRows, soldOutSizes,
} from '../src/lib/stock.js'
import { cardInSize, crossPromotion, otherColours } from '../src/lib/crossPromotion.js'
import { alertTiming, bestColourInStock, REMIND_AFTER_MS, sellsOutDesign, stockLabel, stockSummary } from '../src/lib/stockAdmin.js'
import { groupedCards } from '../src/lib/productGrouping.js'
import { feedItems } from '../src/lib/productFeed.js'
import { viewedItem } from '../src/lib/trackingItems.js'
import { LISTS } from '../src/lib/itemLists.js'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
// A catalogue row; its colour column is the title's " - Colour" part, as the
// admin writes it (src/lib/productForm.js), so rows group into designs.
const row = (id, title, extra = {}) => ({
  id, title, type: 'coord', price: 849, sizes: ['M', 'L', 'XL'], is_active: true, sold_out_sizes: [],
  colour: title.includes(' - ') ? title.split(' - ').pop() : null, ...extra,
})

// ---- what "sold out" means ---------------------------------------------------

test('a size, a colour and a design are sold out by the marks alone', () => {
  const navy = row('combo-navy', 'Solid Combo - Navy', { sold_out_sizes: ['XL'] })
  const wine = row('combo-wine', 'Solid Combo - Wine')
  assert.deepEqual(soldOutSizes(navy), ['XL'])
  assert.deepEqual(soldOutSizes({ id: 'old row' }), [], 'a row read before the column existed has none')
  assert.equal(isSizeSoldOut(navy, 'XL'), true)
  assert.equal(isSizeSoldOut(navy, 'L'), false)
  assert.equal(isSizeSoldOut(navy, null), false, 'no size chosen is not a sold-out size')
  assert.deepEqual(inStockSizes(navy), ['M', 'L'])
  assert.equal(isColourSoldOut(navy), false)
  assert.equal(isColourSoldOut({ ...navy, sold_out_sizes: ['M', 'L', 'XL'] }), true)
  assert.equal(isColourSoldOut({ ...navy, sizes: [], sold_out_sizes: [] }), false, 'a colour with no sizes is not "sold out"')
  assert.equal(firstInStockSize(navy), 'M')
  assert.equal(firstInStockSize({ ...navy, sold_out_sizes: ['M'] }), 'L')

  const design = { ...navy, colors: [navy, wine] }
  assert.deepEqual(designRows(design), [navy, wine])
  assert.deepEqual(designRows(wine), [wine], 'a design without colours is its own row')
  assert.equal(isDesignSoldOut(design), false)
  const gone = { ...navy, colors: [{ ...navy, sold_out_sizes: ['M', 'L', 'XL'] }, { ...wine, sold_out_sizes: ['M', 'L', 'XL'] }] }
  assert.equal(isDesignSoldOut(gone), true)
})

test('lists see only what can be bought: sold-out sizes gone, sold-out colours gone, hidden gone', () => {
  const untouched = row('combo-wine', 'Solid Combo - Wine')
  const rows = [
    row('combo-navy', 'Solid Combo - Navy', { sold_out_sizes: ['M', 'L', 'XL'] }),
    untouched,
    row('combo-olive', 'Solid Combo - Olive', { sold_out_sizes: ['XL'] }),
    row('combo-rust', 'Solid Combo - Rust', { is_active: false }),
  ]
  const listed = listableRows(rows)
  assert.deepEqual(listed.map((r) => r.id), ['combo-wine', 'combo-olive'])
  assert.equal(listed[0], untouched, 'a row with nothing sold out is passed through as it is')
  assert.deepEqual(listed[1].sizes, ['M', 'L'], 'a list carries only the sizes in stock, so a search for XL skips it')
})

test('a design whose lead colour sold out leads with a colour in stock; a design sold out everywhere is not listed', () => {
  const rows = [
    row('combo-navy', 'Solid Combo - Navy', { price: 799, sold_out_sizes: ['M', 'L', 'XL'] }),
    row('combo-wine', 'Solid Combo - Wine'),
    row('acid-grey', 'Acid Set - Grey', { sold_out_sizes: ['M', 'L', 'XL'] }),
    row('acid-brown', 'Acid Set - Brown', { sold_out_sizes: ['M', 'L', 'XL'] }),
  ]
  const all = groupedCards(rows)
  assert.equal(all.length, 2, 'every design still has its page')
  assert.equal(all[0].id, 'combo-navy', 'the full catalogue leads with the cheapest colour, sold out or not')
  const listed = groupedCards(listableRows(rows))
  assert.deepEqual(listed.map((c) => c.id), ['combo-wine'], 'lists lead with wine, and the acid set is gone')
})

// ---- the cross-promotion block -------------------------------------------------

const shopRows = () => [
  row('combo-navy', 'Solid Combo - Navy', { sold_out_sizes: ['XL'] }),
  row('combo-wine', 'Solid Combo - Wine'),
  row('combo-olive', 'Solid Combo - Olive', { sold_out_sizes: ['XL'] }),
  row('emb-red', 'Embroidery Set - Red', { sold_out_sizes: ['XL'] }),
  row('emb-blue', 'Embroidery Set - Blue'),
  row('belt-black', 'Belt Combo - Black', { sizes: ['M', 'L'] }),
  row('acid-grey', 'Acid Set - Grey'),
  row('dress-pink', 'Maxi Dress - Pink', { type: 'dress' }),
  row('dress-blue', 'Wrap Dress - Blue', { type: 'dress' }),
]

test('the block offers the same set in other colours that have her size', () => {
  const design = groupedCards(shopRows())[0]
  assert.equal(design.title, 'Solid Combo')
  assert.deepEqual(otherColours(design, 'combo-navy', 'XL').map((c) => c.id), ['combo-wine'], 'olive has no XL either')
  assert.deepEqual(otherColours(design, 'combo-navy', '').map((c) => c.id), ['combo-wine', 'combo-olive'])
  const hiddenWine = { ...design, colors: design.colors.map((c) => (c.id === 'combo-wine' ? { ...c, is_active: false } : c)) }
  assert.deepEqual(otherColours(hiddenWine, 'combo-navy', 'XL').map((c) => c.id), [])
})

test('similar sets: in her size, shown in a colour that has it, same category first, never the design itself', () => {
  const rows = shopRows()
  const design = groupedCards(rows)[0]
  const listable = groupedCards(listableRows(rows))
  const { similar } = crossPromotion({ design, currentId: 'combo-navy', size: 'XL', listable })
  assert.deepEqual(similar.map((c) => c.title), ['Embroidery Set', 'Acid Set', 'Maxi Dress', 'Wrap Dress'],
    'belt has no XL; Solid Combo is the design itself; two co-ord sets, so the dresses fill up to 4')
  assert.equal(similar[0].id, 'emb-blue', 'the embroidery set is shown in blue, its colour with XL in stock')
  const few = crossPromotion({ design, currentId: 'combo-navy', size: 'XL', listable: listable.filter((c) => c.title !== 'Wrap Dress') })
  assert.equal(few.similar.length, 3, 'filled from other categories only with what has her size')
  const any = crossPromotion({ design, currentId: 'combo-navy', size: '', listable })
  assert.deepEqual(any.similar.map((c) => c.title), ['Embroidery Set', 'Belt Combo', 'Acid Set', 'Maxi Dress'])
})

test('similar sets are ordered: the owner’s picks, then the most reviewed, then the newest', () => {
  const rows = [
    row('base-a', 'Base - Navy'),
    row('one', 'One Set - Red'),
    row('two', 'Two Set - Red'),
    row('three', 'Three Set - Red'),
  ]
  const design = groupedCards(rows)[0]
  const listable = groupedCards(listableRows(rows))
  const rating = (card) => (card.id === 'three' ? { count: 9, average: 4.8 } : null)
  assert.deepEqual(crossPromotion({ design, currentId: 'base-a', listable, rating }).similar.map((c) => c.id), ['three', 'one', 'two'])
  assert.deepEqual(crossPromotion({ design, currentId: 'base-a', listable, rating, picks: ['two'] }).similar.map((c) => c.id), ['two', 'three', 'one'])
})

test('at most 6 similar sets', () => {
  const rows = [row('base', 'Base - Navy'), ...Array.from({ length: 9 }, (_, i) => row(`s${i}`, `Set ${i} - Red`))]
  const design = groupedCards(rows)[0]
  const { similar } = crossPromotion({ design, currentId: 'base', listable: groupedCards(listableRows(rows)) })
  assert.equal(similar.length, 6)
})

test('a card is re-led by the colour that has her size, or dropped', () => {
  const card = groupedCards(listableRows([
    row('emb-red', 'Embroidery Set - Red', { sold_out_sizes: ['XL'] }),
    row('emb-blue', 'Embroidery Set - Blue'),
  ]))[0]
  assert.equal(cardInSize(card, '').id, 'emb-red', 'no size: the card as it is')
  assert.equal(cardInSize(card, 'M').id, 'emb-red', 'its own colour has M')
  const xl = cardInSize(card, 'XL')
  assert.equal(xl.id, 'emb-blue')
  assert.equal(xl.title, 'Embroidery Set', 'under the design’s name')
  assert.equal(cardInSize(card, 'XXL'), null)
})

// ---- what the admin sees ------------------------------------------------------------

test('the admin summary: "1 size sold out", "4 of 15 sizes sold out", "All sold out"', () => {
  const one = [row('a', 'A - Navy', { sold_out_sizes: ['XL'] }), row('b', 'A - Wine')]
  assert.equal(stockLabel(stockSummary(one)), '1 size sold out')
  const acid = ['grey', 'brown', 'maroon', 'olive', 'blue'].map((c, i) => row(c, `Acid - ${c}`, { sold_out_sizes: i < 1 ? ['M', 'L', 'XL'] : i < 2 ? ['XL'] : [] }))
  assert.equal(stockLabel(stockSummary(acid)), '4 of 15 sizes sold out')
  assert.equal(stockSummary(acid).coloursOut, 1)
  const gone = one.map((r) => ({ ...r, sold_out_sizes: ['M', 'L', 'XL'] }))
  assert.equal(stockLabel(stockSummary(gone)), 'All sold out')
  assert.equal(stockLabel(stockSummary([row('c', 'C')])), '')
  assert.equal(stockSummary([row('d', 'D', { is_active: false, sold_out_sizes: ['M'] })]).sizesOut, 0, 'hidden colours do not count')
})

test('only the tap that sells out the whole design asks first', () => {
  const rows = [row('a', 'A - Navy', { sold_out_sizes: ['M', 'L'] }), row('b', 'A - Wine', { sold_out_sizes: ['M', 'L', 'XL'] })]
  assert.equal(sellsOutDesign(rows, 'a', ['XL']), true)
  assert.equal(sellsOutDesign(rows, 'a', ['M']), false)
  assert.equal(sellsOutDesign([...rows, row('c', 'A - Rust', { is_active: false })], 'a', ['XL']), true, 'a hidden colour does not keep a design on sale')
})

test('the best colour in stock: most paid pieces, then most sizes in stock, then catalogue order', () => {
  const rows = [
    row('navy', 'Combo - Navy', { sold_out_sizes: ['M', 'L', 'XL'] }),
    row('wine', 'Combo - Wine', { sold_out_sizes: ['XL'] }),
    row('choc', 'Combo - Choc'),
    row('rust', 'Combo - Rust', { is_active: false }),
  ]
  assert.equal(bestColourInStock(rows, 'navy').id, 'choc', 'no sales known: the most sizes in stock')
  assert.equal(bestColourInStock(rows, 'navy', new Map([['wine', 3], ['choc', 1]])).id, 'wine')
  assert.equal(bestColourInStock([rows[0]], 'navy'), null)
})

test('the alert becomes a reminder after exactly 24 hours', () => {
  assert.equal(REMIND_AFTER_MS, 24 * 60 * 60 * 1000)
  const at = '2026-11-20T10:00:00.000Z'
  const t0 = Date.parse(at)
  assert.deepEqual(alertTiming(at, t0), { due: false, hoursLeft: 24 })
  assert.deepEqual(alertTiming(at, t0 + 23.5 * 3600000), { due: false, hoursLeft: 1 })
  assert.equal(alertTiming(at, t0 + 24 * 3600000).due, true)
  assert.equal(alertTiming('not a date', t0).due, false)
})

// ---- ads, tracking ----------------------------------------------------------------------

test('the feed sends a sold-out size as out_of_stock and the rest as in_stock', () => {
  const items = feedItems([
    row('combo-navy', 'Solid Combo - Navy', { sku: 'CS01NV', image: '/a.jpg', sold_out_sizes: ['XL'] }),
  ], { site: 'https://www.ruhi-collections.com' })
  const by = Object.fromEntries(items.map((i) => [i.size, i.availability]))
  assert.deepEqual(by, { M: 'in_stock', L: 'in_stock', XL: 'out_of_stock' })
  const api = read('api/product-feed.js')
  assert.match(api, /WITH_STOCK = `\$\{WITH_DESIGN\},sold_out_sizes`/)
  assert.match(api, /read\(WITH_STOCK\)[\s\S]*status === 400\) response = await read\(WITH_DESIGN\)/, 'a database without the column still gets a feed')
})

test('view_item describes the first size in stock until she picks one (brief, A3)', () => {
  const navy = row('combo-navy', 'Solid Combo - Navy', { sku: 'CS01NV', colour: 'Navy', sold_out_sizes: ['M'] })
  assert.equal(viewedItem(navy, 'combo-navy', null).item_variant, 'Navy / L', 'L, the first size in stock')
  assert.equal(viewedItem(navy, 'combo-navy', 'M').item_variant, 'Navy / M', 'a size she picked is described as picked')
  assert.equal(viewedItem({ ...navy, sold_out_sizes: [] }, 'combo-navy', null).item_variant, 'Navy / M', 'nothing sold out: the first size, as before')
})

test('the block has its own GA4 list name (the owner’s OK)', () => {
  assert.deepEqual(LISTS.soldOutSimilar, { id: 'sold_out_similar', name: 'Sold out – similar' })
  assert.match(read('src/components/SoldOutBlock.jsx'), /<ItemList list=\{LISTS\.soldOutSimilar\}/)
})

// ---- where each rule is used --------------------------------------------------------------

test('every list reads the in-stock catalogue; product pages, the cart and the wishlist read all of it', () => {
  assert.match(read('src/pages/Shop.jsx'), /const \{ listable: products, loading, answered, error, source \} = useProducts\(\)/)
  assert.match(read('src/components/SearchBar.jsx'), /const \{ listable: products, loading \} = useProducts\(\)/)
  assert.match(read('src/pages/Collections.jsx'), /const \{ listable: products, loading \} = useProducts\(\)/)
  const home = read('src/components/Sections.jsx')
  assert.match(home, /const \{ listable: products, getProduct, answered \} = useProducts\(\)/, 'hero fallback slides')
  assert.match(home, /const \{ listable: products, answered \} = useProducts\(\)/, 'category tiles')
  assert.match(home, /const \{ products: everything, listable: products, loading, source \} = useProducts\(\)/, 'best sellers')
  const page = read('src/pages/Product.jsx')
  assert.match(page, /const rel = listable\.filter\(\(x\) => x\.type === p\.type && notOwn\(x\)\)/, '"You may also like"')
  assert.match(page, /relatedReady && !blockOn && related\.length > 0/, 'and it steps aside while the block shows')
  assert.match(read('src/pages/Wishlist.jsx'), /const \{ products, loading, source \} = useProducts\(\)/, 'her wishlist keeps what she saved')
  assert.match(read('src/context/ProductsContext.jsx'), /const listable = useMemo\(\(\) => groupColours\(listableRows\(all\)\), \[all\]\)/)
})

test('the product page: sold-out sizes stay on screen, struck through, and nothing sold out can be added', () => {
  const page = read('src/pages/Product.jsx')
  assert.match(page, /const out = isSizeSoldOut\(shown, s\)/)
  assert.match(page, /\$\{out \? ' line-through' : ''\}/)
  assert.doesNotMatch(page, /shown\.sizes\.filter\(/, 'no size is hidden')
  assert.match(page, /if \(isSizeSoldOut\(shown, size \|\| shown\.sizes\[0\]\)\) \{\s*toBlock\(\)\s*return/)
  assert.match(page, /sold_out_sizes: chosen\.sold_out_sizes \|\| \[\]/, 'the marks follow the colour on screen')
  assert.match(page, /\{blockOn \? \(/, 'the block takes the buy buttons’ place')
  assert.doesNotMatch(read('src/components/SoldOutBlock.jsx') + page, /coming back/i, 'no "coming back?" WhatsApp link (owner, 20 Nov)')
})

test('the rare parts load on demand, never in the main script', () => {
  const parts = read('src/lib/soldOutParts.js')
  for (const file of ['SoldOutBlock', 'SoldOutCartLines', 'NoLongerAvailable']) {
    assert.match(parts, new RegExp(`import\\('\\.\\./components/${file}'\\)`), `${file} is a dynamic import`)
  }
  const statics = []
  const walk = (dir) => {
    for (const f of fs.readdirSync(path.join(process.cwd(), dir))) {
      const rel = `${dir}/${f}`
      if (fs.statSync(path.join(process.cwd(), rel)).isDirectory()) walk(rel)
      else if (/\.(jsx?|mjs)$/.test(f) && /^import [^\n]* from ['"][^'"\n]*\/(SoldOutBlock|SoldOutCartLines|NoLongerAvailable)['"]/m.test(read(rel))) statics.push(rel)
    }
  }
  walk('src')
  assert.deepEqual(statics, [], 'nothing imports them statically')
  assert.match(read('src/pages/Product.jsx'), /useEffect\(\(\) => \{ if \(anySoldOut\) soldOutBlock\.prefetch\(\) \}, \[anySoldOut\]\)/, 'fetched as soon as the product has a sold-out size')
})

test('the cart keeps a sold-out line apart: shown and named, never charged or ordered', () => {
  const cart = read('src/context/CartContext.jsx')
  assert.match(cart, /if \(line\.soldOut\) \{ out\.push\(line\); continue \}/)
  assert.match(cart, /sub \+= i\.qty \* line\.price/)
  const checkout = read('src/pages/Checkout.jsx')
  assert.match(checkout, /const items = lines\.map\(\(l\) => \(\{ product_id: l\.id, size: l\.size, qty: l\.qty \}\)\)/, 'the order is built from `lines` only')
  assert.match(checkout, /if \(\/sold out\/i\.test\(err\?\.message \|\| ''\)\) reload\(\)/, 'a late sell-out refreshes the catalogue')
})

// ---- the database ----------------------------------------------------------------------------

const SQL = read('supabase/migrations/20261120210000_sold_out.sql')

test('the migration: one column, no counts, inside one transaction', () => {
  assert.match(SQL, /^begin;$/m)
  assert.match(SQL, /^commit;$/m)
  assert.match(SQL, /add column if not exists sold_out_sizes text\[\] not null default '\{\}'/)
  assert.doesNotMatch(SQL, /\b(stock_count|quantity_left|qty_left|units_left)\b/, 'nothing counts pieces')
  assert.doesNotMatch(SQL, /create or replace function public\.create_order/, 'create_order is not restated')
  assert.match(SQL, /before insert or update of sizes, sold_out_sizes on public\.products/, 'marks stay a subset of the sizes')
})

test('the migration: only catalogue managers can mark, read alerts or read the log', () => {
  assert.match(SQL, /function public\.set_sold_out\(p_id text, p_sizes text\[\], p_sold_out boolean\)[\s\S]*security invoker/)
  assert.match(SQL, /if not public\.can_manage_products\(\) then/)
  assert.match(SQL, /revoke all on function public\.set_sold_out\(text, text\[\], boolean\) from public, anon;/)
  assert.match(SQL, /grant execute on function public\.set_sold_out\(text, text\[\], boolean\) to authenticated;/)
  for (const table of ['sold_out_alerts', 'stock_changes']) {
    assert.match(SQL, new RegExp(`alter table public\\.${table} enable row level security;`))
    assert.match(SQL, new RegExp(`revoke all on table public\\.${table} from anon, authenticated;`))
  }
  assert.match(SQL, /grant update \(closed_at\) on table public\.sold_out_alerts to authenticated;/, 'the dashboard can only close an alert')
})

test('the migration: an alert per live colour sold out in every size, gone when it is back', () => {
  assert.match(SQL, /if new\.is_active\s+and cardinality\(new\.sizes\) > 0\s+and new\.sizes <@ new\.sold_out_sizes then/)
  assert.match(SQL, /on conflict \(product_id\) do nothing/, 'the clock is not reset while it stays sold out')
  assert.match(SQL, /delete from public\.sold_out_alerts where product_id = new\.id/)
})

test('the migration: a new order line for a sold-out size is refused with a message the shopper can act on', () => {
  assert.match(SQL, /before insert on public\.order_items/)
  assert.match(SQL, /raise exception '% in size % has just sold out\. Remove it from your cart to order the rest\.'/)
})

test('the admin never edits an ad and never redirects a shopper', () => {
  const alerts = read('src/admin/SoldOutAlerts.jsx')
  assert.doesNotMatch(alerts, /graph\.facebook|facebook\.com\/v\d|adsets|navigate\(/)
  assert.match(alerts, /change the ad&apos;s website URL in\s+Meta/)
  const page = read('src/pages/Product.jsx')
  assert.doesNotMatch(page, /sold_out_at|REMIND_AFTER_MS/, 'the shop page never switches colour by itself')
})

test('the Stock screen is there for the owner and for product managers', () => {
  const dash = read('src/admin/Dashboard.jsx')
  assert.match(dash, /\['stock', 'Stock'\]/)
  assert.match(dash, /if \(section === 'stock'\) \{[\s\S]{0,400}<StockPanel \/>/)
  assert.match(dash, /<SoldOutAlerts \/>/)
})
