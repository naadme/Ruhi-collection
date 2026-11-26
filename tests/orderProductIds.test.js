// The Product ID on an ordered line.
//
// The client reads a product's six-character ID (CCPPCL) off the product and
// wants to see the SAME ID on the order line they bought — in the admin
// panel, in the Google Sheet, in the Excel download and on the confirmation
// email.
//
// The ID is SNAPSHOT onto the line when the order is placed, exactly like the
// title and the price. It is never looked up again, so a product that is
// renamed, renumbered or deleted cannot change what an old order says.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { LEGACY_SHEET_COLUMNS, SHEET_COLUMNS, legacyOrderRows, orderRows } from '../supabase/functions/_shared/sheetRows.mjs'
import { orderItemColour } from '../supabase/functions/_shared/orderItems.mjs'
import { EXPORT_COLUMNS, ordersToRows } from '../src/admin/orderExport.js'

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8')
const MIGRATIONS = path.join(process.cwd(), 'supabase/migrations')

const migration = read('supabase/migrations/20261021090000_order_item_skus.sql')

test('the order line carries the Product ID', () => {
  assert.match(migration, /add column if not exists sku text/,
    'order_items gains a sku column')
  assert.match(migration, /insert into public\.order_items \([^)]*sku\)/,
    'and create_order writes it')
  assert.match(migration, /v_product\.sku/, 'from the exact product that was bought')
})

test('the Product ID is snapshot, never looked up again', () => {
  // The line's own column is the only source. A lookup against `products` at
  // display time would show the ID of a different product after a renumber.
  const sheetRows = read('supabase/functions/_shared/sheetRows.mjs')
  assert.match(sheetRows, /it\?\.sku/, 'the sheet reads the line\'s own snapshot')
  assert.ok(!/from\(products\)|from\('products'\)/.test(sheetRows),
    'the sheet never looks the ID up again')
})

test('the orders that already exist are backfilled from the product they name', () => {
  assert.match(migration, /update public\.order_items oi[\s\S]*?set sku = p\.sku[\s\S]*?where p\.id = oi\.product_id/,
    'the backfill joins on the product the line names, not on a name match')
  assert.match(migration, /product no[\s\S]*?longer exists keeps a NULL/,
    'and a line whose product is gone keeps nothing rather than a guess')
})

test('the admin order details show the Product ID of every line', () => {
  const panel = read('src/admin/OrdersPanel.jsx')
  assert.match(panel, /it\.sku/, 'the line\'s Product ID is rendered')
  assert.match(panel, /font-mono/, 'in the same monospaced style the order ID uses')
})

test('each ordered line in the admin has a "View product" button for the exact colour', () => {
  // 26 Nov 2026, the owner's ask: from any order, open the exact product the
  // customer bought, on the colour she chose.
  const panel = read('src/admin/OrdersPanel.jsx')
  assert.match(panel, /const href = productHref\(\{ id: it\.product_id \}\)/,
    'the link is the line\'s own colour row, the page that opens on that colour')
  assert.match(panel, /const colour = orderLineColour\(it\.title\)/, 'the colour comes from the order\'s own snapshot')
  const button = panel.match(/<a\s+href=\{href\}\s+target="_blank"\s+rel="noopener noreferrer"\s+className="adm-view-product"[\s\S]*?<\/a>/)
  assert.ok(button, 'a button-styled link, in a new tab, so the Orders screen stays open')
  assert.match(button[0], /View product/)
  assert.match(button[0], /\{colour\}/, 'and it names the colour')
  // Admin-only look lives in admin.css: a Tailwind class used only here would
  // add bytes to every shopper's stylesheet.
  const css = read('src/admin/admin.css')
  assert.match(css, /\.adm-view-product \{[\s\S]*?min-height: 40px/, 'big enough to tap on a phone')
  assert.doesNotMatch(button[0], /lucide|<svg/i, 'no new icon: every package ships to shoppers too')
})

test('the Google Sheet carries the Product ID, the colour and the product links', () => {
  assert.ok(SHEET_COLUMNS.includes('Product ID'))
  assert.ok(SHEET_COLUMNS.includes('Colour'))
  // The new columns are at the END: the export appends, so a column inserted in
  // the middle would shift every column to its right.
  assert.equal(SHEET_COLUMNS[SHEET_COLUMNS.length - 3], 'Product ID')
  assert.equal(SHEET_COLUMNS[SHEET_COLUMNS.length - 2], 'Colour')
  assert.equal(SHEET_COLUMNS[SHEET_COLUMNS.length - 1], 'Product Links', '26 Nov 2026: appended last')
  assert.equal(LEGACY_SHEET_COLUMNS[LEGACY_SHEET_COLUMNS.length - 1], 'Product link', 'old sheets get it last too')

  const [row] = orderRows({
    reference: '01102601',
    created_at: '2026-10-01T10:00:00.000Z',
    order_items: [
      { product_id: 'denim-shirt-blue', title: 'Denim Shirt - Blue', size: 'M', qty: 2, unit_price: 900, sku: '0101BU' },
      { product_id: 'cotton-dress-green', title: 'Cotton Dress - Green', size: 'L', qty: 1, unit_price: 800, sku: '0302GR' },
    ],
  })
  assert.equal(row.length, SHEET_COLUMNS.length, 'one cell per column')
  const at = (name) => row[SHEET_COLUMNS.indexOf(name)]
  assert.equal(at('Product ID'), '0101BU, 0302GR')
  assert.equal(at('Colour'), 'Blue, Green')
  assert.equal(at('Products'), 'Denim Shirt - Blue (Size M) × 2; Cotton Dress - Green (Size L) × 1')
  assert.equal(at('Product Links'),
    'https://www.ruhi-collections.com/product/denim-shirt-blue\nhttps://www.ruhi-collections.com/product/cotton-dress-green',
    'one link per line, in the order the Products column lists them')

  const legacy = legacyOrderRows({
    reference: '01102601',
    created_at: '2026-10-01T10:00:00.000Z',
    order_items: [{ product_id: 'denim-shirt-blue', title: 'Denim Shirt - Blue', size: 'M', qty: 2, unit_price: 900, sku: '0101BU' }],
  })
  assert.equal(legacy[0].length, LEGACY_SHEET_COLUMNS.length)
  assert.equal(legacy[0][LEGACY_SHEET_COLUMNS.indexOf('Product link')], 'https://www.ruhi-collections.com/product/denim-shirt-blue')
  assert.equal(legacyOrderRows({ reference: 'x', order_items: [] })[0].length, LEGACY_SHEET_COLUMNS.length,
    'an order with no lines still fills every column')
})

test('the Excel download carries the Product ID', () => {
  assert.ok(EXPORT_COLUMNS.includes('Product ID'))
  const rows = ordersToRows([{
    reference: '01102601',
    created_at: '2026-10-01T10:00:00.000Z',
    order_items: [{ product_id: 'denim-shirt-blue', title: 'Denim Shirt - Blue', size: 'M', qty: 1, unit_price: 900, sku: '0101BU' }],
  }])
  const at = (name) => rows[0][EXPORT_COLUMNS.indexOf(name)]
  assert.equal(at('Product ID'), '0101BU')
  assert.equal(at('Product link'), 'https://www.ruhi-collections.com/product/denim-shirt-blue',
    'the product\'s own full link is kept beside it (26 Nov 2026: was the bare id)')
})

test('the emails read the product of each line, so they can link to it', () => {
  for (const f of ['confirmation.ts', 'ownerNotification.ts']) {
    assert.match(read(`supabase/functions/_shared/${f}`), /select=product_id,title,size,qty,unit_price,sku/,
      `${f} reads the line's product, for its link`)
  }
  // The body itself lives in the shared module, which the test suite drives
  // directly (tests/orderEmail.test.js, tests/orderNotification.test.js).
  // Since 26 Nov 2026 the Product ID is in the OWNER's mail only — once.
  const body = read('supabase/functions/_shared/orderEmail.mjs')
  assert.equal((body.match(/Product ID \$\{asText\(item\.sku\)\}/g) || []).length, 1,
    'the Product ID is in one item line: the owner\'s')
})

test('the colour of an ordered line is read from the title it snapshotted', () => {
  assert.equal(orderItemColour('Solid Shirt and Denim pant Combo - Black'), 'Black')
  assert.equal(orderItemColour('Cotton Dress'), '', 'a product with no colour has no colour')
  assert.equal(orderItemColour('Kurta Set - 2 Piece'), '', 'a suffix that is not a word is part of the name')
})

test('the migrations folder is the record of what the database holds', () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))
  assert.ok(files.includes('20261021090000_order_item_skus.sql'))
  assert.ok(files.includes('20261021100000_active_switches_and_sync_ledger.sql'))
})
