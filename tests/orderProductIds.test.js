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

import { SHEET_COLUMNS, orderRows } from '../supabase/functions/_shared/sheetRows.mjs'
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
  assert.match(sheetRows, /asText\(it\.sku\)/, 'the sheet reads the line\'s own snapshot')
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

test('the Google Sheet carries the Product ID and the colour', () => {
  assert.ok(SHEET_COLUMNS.includes('Product ID'))
  assert.ok(SHEET_COLUMNS.includes('Colour'))
  // The new columns are at the END: the export appends, so a column inserted in
  // the middle would shift every column to its right.
  assert.equal(SHEET_COLUMNS[SHEET_COLUMNS.length - 2], 'Product ID')
  assert.equal(SHEET_COLUMNS[SHEET_COLUMNS.length - 1], 'Colour')

  const [row] = orderRows({
    reference: '01102601',
    created_at: '2026-10-01T10:00:00.000Z',
    order_items: [{ title: 'Denim Shirt - Blue', size: 'M', qty: 2, unit_price: 900, sku: '0101BU' }],
  })
  const at = (name) => row[SHEET_COLUMNS.indexOf(name)]
  assert.equal(at('Product ID'), '0101BU')
  assert.equal(at('Colour'), 'Blue')
  assert.equal(at('Item'), 'Denim Shirt - Blue')
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
  assert.equal(at('Product link'), 'denim-shirt-blue', 'the product\'s own link is kept beside it')
})

test('the confirmation email carries the Product ID', () => {
  const confirmation = read('supabase/functions/_shared/confirmation.ts')
  assert.match(confirmation, /Product ID \$\{asString\(item\.sku\)\}/,
    'the Product ID is in the item line')
  assert.match(confirmation, /select=title,size,qty,unit_price,sku/,
    'and it is read from the line')
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
