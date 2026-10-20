// Newest-first ordering, for orders (requirement 3) and for products
// (requirement 7). Both are decided where the rows are read, so the order
// survives a refresh and is the same for the list, the count and the export.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { filterAndSortOrders } from '../src/lib/orderFiltering.js'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

test('orders: the query itself asks for newest first', () => {
  const panel = read('src/admin/OrdersPanel.jsx')
  assert.match(
    panel,
    /\.from\('orders'\)\s*\n?\s*\.select\('\*, order_items\(\*\)'\)\s*\n?\s*\.order\('created_at', \{ ascending: false \}\)/,
    'the data layer orders by created_at descending — not the rendering',
  )
  assert.match(panel, /useState\('newest'\)/, 'the panel opens on newest first')
})

test('orders: the newest order is first, and the toggle still reverses it', () => {
  const orders = [
    { id: '1', reference: 'RCH-1', created_at: '2026-10-01T10:00:00Z', status: 'pending' },
    { id: '3', reference: 'RCH-3', created_at: '2026-10-03T10:00:00Z', status: 'pending' },
    { id: '2', reference: 'RCH-2', created_at: '2026-10-02T10:00:00Z', status: 'pending' },
  ]
  assert.deepEqual(filterAndSortOrders(orders).map((o) => o.id), ['3', '2', '1'], 'default is newest')
  assert.deepEqual(
    filterAndSortOrders(orders, { sort: 'oldest' }).map((o) => o.id),
    ['1', '2', '3'],
    'the oldest/newest toggle still works',
  )
})

test('orders: filtering, searching and dates still agree with the export', () => {
  const orders = [
    { id: '1', reference: 'RCH-1', created_at: '2026-10-01T10:00:00Z', status: 'pending', city: 'Pune' },
    { id: '2', reference: 'RCH-2', created_at: '2026-10-05T10:00:00Z', status: 'shipped', city: 'Delhi' },
  ]
  const rows = filterAndSortOrders(orders, { status: 'shipped' })
  assert.deepEqual(rows.map((o) => o.id), ['2'], 'the status filter is untouched')
  assert.deepEqual(filterAndSortOrders(orders, { query: 'pune' }).map((o) => o.id), ['1'], 'search')
  assert.deepEqual(
    filterAndSortOrders(orders, { from: '2026-10-02', to: '2026-10-06' }).map((o) => o.id),
    ['2'],
    'the date range',
  )
  // The Excel download and the Google Sheet both consume this array, so the
  // ordering the admin sees IS the ordering the file has.
  assert.match(read('src/admin/OrdersPanel.jsx'), /downloadOrdersXlsx\(rows\)/, 'the export takes exactly the rows on screen')
})

test('products: the query asks for newest first, with a stable tie-break', () => {
  const ctx = read('src/context/ProductsContext.jsx')
  assert.match(
    ctx,
    /\.from\('products'\)\.select\('\*'\)\s*\n?\s*\.order\('created_at', \{ ascending: false \}\)\s*\n?\s*\.order\('id', \{ ascending: true \}\)/,
    'newest first at the query layer, so it survives a refresh',
  )
})

test('products: a row Supabase confirms goes to the TOP, and stays there', () => {
  const ctx = read('src/context/ProductsContext.jsx')
  assert.match(
    ctx,
    /if \(at < 0\) return \[keep, \.\.\.prev\]/,
    'applyRow prepends a newly saved product instead of appending it',
  )
  assert.doesNotMatch(ctx, /if \(at < 0\) return \[\.\.\.prev, keep\]/, 'the old append is gone')
  // A row that already exists is replaced in place: an edit must not move an
  // old product to the top of the list.
  assert.match(ctx, /next\[at\] = keep/, 'an existing row keeps its position')
})

test('products: created_at cannot be null, so nothing can sink out of order', () => {
  const migration = read('supabase/migrations/20260928151147_products_admin_dashboard.sql')
  assert.match(migration, /created_at\s+timestamptz not null default now\(\)/i)
})
