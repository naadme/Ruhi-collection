// The manual export — the admin's own "Export to Google Sheets" button.
//
// Google is mocked, so nothing is sent and no spreadsheet is touched: the test
// proves WHAT the export would write — the rows, the headings and the order of
// the columns — because a mistake there is invisible until the owner's sheet is
// full of the wrong things.
//
// The client's sheet holds ONE row per order. The ten columns she asked for
// come first, and an order that is already there is refreshed in its own row
// rather than appended a second time.
import test from 'node:test'
import assert from 'node:assert/strict'

import { exportOrdersToSheet } from '../supabase/functions/_shared/googleSheets.mjs'
import { SHEET_COLUMNS } from '../supabase/functions/_shared/sheetRows.mjs'

const REQUIRED = [
  'Order ID', 'Date', 'Customer Name', 'Phone', 'Email',
  'Products', 'Quantity', 'Total Amount', 'Payment Status', 'Order Status',
]

/** A stand-in for Google's API that records what it was asked to do. */
function mockGoogle({ headerRow = null, columnA = null, appendOk = true } = {}) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const href = String(url)
    calls.push({ url: href, method, body: init.body ? JSON.parse(init.body) : null })
    if (href.includes('/values/') && method === 'PUT') {
      return { ok: true, status: 200, json: async () => ({ updatedRange: 'Orders!A1:B1' }) }
    }
    if (href.includes('/values/') && method === 'GET') {
      // The order-id column is read to find the row an order already occupies.
      if (decodeURIComponent(href).includes('!A1:A5000')) {
        const values = columnA ?? (headerRow === null ? [] : [headerRow])
        return { ok: true, status: 200, json: async () => ({ values }) }
      }
      // The sheet's first row — what the export reads to see which columns
      // are already named.
      const values = headerRow === null ? [] : [headerRow]
      return { ok: true, status: 200, json: async () => ({ values }) }
    }
    if (href.includes('/values/') && method === 'POST') {
      if (!appendOk) return { ok: false, status: 400, json: async () => ({ error: { message: 'refused' } }) }
      return { ok: true, status: 200, json: async () => ({ updates: { updatedRange: 'Orders!A2:Y24' } }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  }
  return calls
}

const order = (over = {}) => ({
  id: 'o1',
  reference: '21102601',
  created_at: '2026-10-20T18:30:00.000Z',
  status: 'pending',
  payment_status: 'paid',
  payment_method: 'razorpay',
  full_name: 'Priya Sharma',
  email: 'priya@example.com',
  phone: '9046651272',
  address: '12 Rose Garden',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  subtotal: 1800,
  discount: 0,
  coupon_code: null,
  shipping: 0,
  total: 1800,
  note: '',
  order_items: [{ title: 'Denim Shirt - Blue', size: 'M', qty: 2, unit_price: 900, sku: '0101BU' }],
  ...over,
})

test.after(() => { delete globalThis.fetch })

test('the client\'s ten columns come first, in the order she asked for', () => {
  assert.deepEqual(SHEET_COLUMNS.slice(0, 10), REQUIRED)
})

test('the export writes one row per order, with every required column', async () => {
  const calls = mockGoogle({ headerRow: SHEET_COLUMNS })
  const result = await exportOrdersToSheet({
    accessToken: 'token', sheetId: 'sheet', tab: 'Orders',
    orders: [order()], alreadyExported: [], includeExported: false, filters: {},
  })
  assert.equal(result.ok, true)
  assert.equal(result.orders, 1)
  const append = calls.find((c) => c.method === 'POST')
  assert.ok(append, 'the rows were appended')
  const values = append.body.values
  assert.equal(values.length, 1, 'one row per order — the header is not repeated')
  const row = values[0]
  assert.equal(row.length, SHEET_COLUMNS.length, 'the row is as wide as the columns')
  const at = (name) => row[SHEET_COLUMNS.indexOf(name)]
  assert.equal(at('Order ID'), '21102601')
  assert.equal(at('Date'), '2026-10-21 00:00:00', 'the shop\'s own time')
  assert.equal(at('Customer Name'), 'Priya Sharma')
  assert.equal(at('Phone'), '9046651272')
  assert.equal(at('Email'), 'priya@example.com')
  assert.equal(at('Products'), 'Denim Shirt - Blue (Size M) × 2')
  assert.equal(at('Quantity'), 2)
  assert.equal(at('Total Amount'), 1800)
  assert.equal(at('Payment Status'), 'paid')
  assert.equal(at('Order Status'), 'pending')
  assert.equal(at('Product ID'), '0101BU')
  assert.equal(at('Colour'), 'Blue')
})

test('an order with several lines is still ONE row, with the lines joined', async () => {
  const calls = mockGoogle({ headerRow: SHEET_COLUMNS })
  const result = await exportOrdersToSheet({
    accessToken: 'token', sheetId: 'sheet', tab: 'Orders',
    orders: [order({
      total: 3000,
      order_items: [
        { title: 'Denim Shirt - Blue', size: 'M', qty: 2, unit_price: 900, sku: '0101BU' },
        { title: 'Cotton Dress', size: 'L', qty: 1, unit_price: 1200, sku: '0202CD' },
      ],
    })],
    alreadyExported: [], includeExported: false, filters: {},
  })
  assert.equal(result.orders, 1)
  const row = calls.find((c) => c.method === 'POST').body.values[0]
  const at = (name) => row[SHEET_COLUMNS.indexOf(name)]
  assert.equal(at('Products'), 'Denim Shirt - Blue (Size M) × 2; Cotton Dress (Size L) × 1')
  assert.equal(at('Quantity'), 3, 'the pieces of every line, added up')
  assert.equal(at('Order ID'), '21102601', 'one Order ID, one row')
})

test('the headers are written into an empty sheet, once', async () => {
  const calls = mockGoogle()
  await exportOrdersToSheet({
    accessToken: 'token', sheetId: 'sheet', tab: 'Orders',
    orders: [order()], alreadyExported: [], includeExported: false, filters: {},
  })
  const put = calls.find((c) => c.method === 'PUT')
  assert.ok(put, 'the header was written')
  assert.deepEqual(put.body.values, [SHEET_COLUMNS], 'the full header, in one row')
  const append = calls.find((c) => c.method === 'POST')
  assert.equal(append.body.values.length, 1, 'the header is not sent again with the data')

  const calls2 = mockGoogle({ headerRow: SHEET_COLUMNS })
  await exportOrdersToSheet({
    accessToken: 'token', sheetId: 'sheet', tab: 'Orders',
    orders: [order({ id: 'o2', reference: '21102602' })], alreadyExported: ['o1'], includeExported: false, filters: {},
  })
  assert.equal(calls2.filter((c) => c.method === 'PUT').length, 0,
    'a sheet whose header is already right is never rewritten')
})

test('a column added since the sheet was created is named in the first row', async () => {
  // The sheet was created with the old 22 columns; the Product ID, the
  // colour and (26 Nov 2026) the product links are new, so their headings
  // are written into the row that is already there. Nothing else moves.
  const oldHeader = SHEET_COLUMNS.slice(0, SHEET_COLUMNS.length - 3)
  const calls = mockGoogle({ headerRow: oldHeader })
  const result = await exportOrdersToSheet({
    accessToken: 'token', sheetId: 'sheet', tab: 'Orders',
    orders: [order()], alreadyExported: [], includeExported: false, filters: {},
  })
  assert.equal(result.headingsWritten, 3, 'the three new headings were written')
  const put = calls.find((c) => c.method === 'PUT')
  assert.ok(put, 'a write was made')
  assert.match(put.url, /W1%3AY1/, 'into the cells after the ones already there')
  assert.deepEqual(put.body.values, [['Product ID', 'Colour', 'Product Links']])
})

test('a sheet that already has the Product ID and colour gains only the product links', async () => {
  // The live sheet as it was on 26 Nov 2026: 24 columns, ending in Colour.
  const calls = mockGoogle({ headerRow: SHEET_COLUMNS.slice(0, SHEET_COLUMNS.length - 1) })
  const result = await exportOrdersToSheet({
    accessToken: 'token', sheetId: 'sheet', tab: 'Orders',
    orders: [order()], alreadyExported: [], includeExported: false, filters: {},
  })
  assert.equal(result.headingsWritten, 1)
  const put = calls.find((c) => c.method === 'PUT')
  assert.match(put.url, /Y1%3AY1/, 'the one new heading goes in the next empty cell')
  assert.deepEqual(put.body.values, [['Product Links']])
})

test('a sheet whose first row is data is never overwritten', async () => {
  const calls = mockGoogle({ headerRow: ['21102601', '2026-10-21'] })
  const result = await exportOrdersToSheet({
    accessToken: 'token', sheetId: 'sheet', tab: 'Orders',
    orders: [order()], alreadyExported: [], includeExported: false, filters: {},
  })
  assert.equal(result.ok, false, 'somebody else\'s sheet is refused')
  assert.equal(result.status, 409)
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 0, 'and no cell was touched')
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0, 'and nothing was appended')
})

test('an order already in the sheet is not sent again', async () => {
  const calls = mockGoogle({ headerRow: SHEET_COLUMNS })
  const result = await exportOrdersToSheet({
    accessToken: 'token', sheetId: 'sheet', tab: 'Orders',
    orders: [order()], alreadyExported: ['o1'], includeExported: false, filters: {},
  })
  assert.equal(result.orders, 0)
  assert.equal(result.skipped, 1)
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0, 'nothing was appended')
})

test('asking for a refresh updates the existing row instead of adding a duplicate', async () => {
  const calls = mockGoogle({
    headerRow: SHEET_COLUMNS,
    columnA: [['Order ID'], ['21102601']],
  })
  const result = await exportOrdersToSheet({
    accessToken: 'token', sheetId: 'sheet', tab: 'Orders',
    orders: [order({ status: 'shipped' })],
    alreadyExported: ['o1'], includeExported: true, filters: {},
  })
  assert.equal(result.ok, true)
  assert.equal(result.orders, 0, 'nothing new was appended')
  assert.equal(result.refreshed, 1, 'the existing row was brought up to date')
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0, 'no duplicate row')
  const put = calls.find((c) => c.method === 'PUT')
  assert.ok(put, 'the row was rewritten in place')
  assert.match(put.url, /A2%3AY2/, 'the row the order already occupies')
  assert.equal(put.body.values[0][0], '21102601')
  assert.equal(put.body.values[0][SHEET_COLUMNS.indexOf('Order Status')], 'shipped')
})

test('a refused write is reported, never counted as done', async () => {
  mockGoogle({ headerRow: SHEET_COLUMNS, appendOk: false })
  const result = await exportOrdersToSheet({
    accessToken: 'token', sheetId: 'sheet', tab: 'Orders',
    orders: [order()], alreadyExported: [], includeExported: false, filters: {},
  })
  assert.equal(result.ok, false, 'the export says it failed')
  assert.equal(result.status, 400)
})
