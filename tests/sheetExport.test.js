// The manual export — the admin's own "Export to Google Sheets" button.
//
// Google is mocked, so nothing is sent and no spreadsheet is touched: the
// test proves WHAT the export would write — the rows, the headings and the
// order of the columns — because a mistake there is invisible until the
// owner's sheet is full of the wrong things.
import test from 'node:test'
import assert from 'node:assert/strict'

import { exportOrdersToSheet } from '../supabase/functions/_shared/googleSheets.mjs'
import { SHEET_COLUMNS } from '../supabase/functions/_shared/sheetRows.mjs'

/** A stand-in for Google's API that records what it was asked to do. */
function mockGoogle({ headerRow = null, appendOk = true } = {}) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    calls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null })
    if (String(url).includes('/values/') && method === 'PUT') {
      return { ok: true, status: 200, json: async () => ({ updatedRange: 'Orders!A1:B1' }) }
    }
    if (String(url).includes('/values/') && method === 'GET') {
      // The sheet's first row — what the export reads to see which columns
      // are already named.
      const values = headerRow === null ? [] : [headerRow]
      return { ok: true, status: 200, json: async () => ({ values }) }
    }
    if (String(url).includes('/values/') && method === 'POST') {
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

test('the export appends one row per line item, with the Product ID', async () => {
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
  assert.equal(values.length, 2, 'the header row and the order row')
  const row = values[1]
  assert.equal(row.length, SHEET_COLUMNS.length, 'the row is as wide as the columns')
  const at = (name) => row[SHEET_COLUMNS.indexOf(name)]
  assert.equal(at('Reference'), '21102601')
  assert.equal(at('Item'), 'Denim Shirt - Blue')
  assert.equal(at('Product ID'), '0101BU')
  assert.equal(at('Colour'), 'Blue')
  assert.equal(at('Size'), 'M')
  assert.equal(at('Qty'), 2)
  assert.equal(at('Unit price (₹)'), 900)
  assert.equal(at('Line total (₹)'), 1800)
  assert.equal(at('Order total (₹)'), 1800)
  assert.equal(at('Customer'), 'Priya Sharma')
  assert.equal(at('Placed at'), '2026-10-21 00:00:00', 'the shop\'s own time')
})

test('the headers are written only for the first export to a sheet', async () => {
  const calls = mockGoogle({ headerRow: SHEET_COLUMNS })
  await exportOrdersToSheet({
    accessToken: 'token', sheetId: 'sheet', tab: 'Orders',
    orders: [order()], alreadyExported: [], includeExported: false, filters: {},
  })
  const append = calls.find((c) => c.method === 'POST')
  assert.deepEqual(append.body.values[0], SHEET_COLUMNS, 'the first export names the columns')

  const calls2 = mockGoogle({ headerRow: SHEET_COLUMNS })
  await exportOrdersToSheet({
    accessToken: 'token', sheetId: 'sheet', tab: 'Orders',
    orders: [order({ id: 'o2' })], alreadyExported: ['o1'], includeExported: false, filters: {},
  })
  const append2 = calls2.find((c) => c.method === 'POST')
  assert.equal(append2.body.values[0].length, SHEET_COLUMNS.length,
    'a later export does not repeat the header')
})

test('a column added since the sheet was created is named in the first row', async () => {
  // The sheet was created with the old 25 columns; the Product ID and the
  // colour are new, so their headings are written into the row that is
  // already there. Nothing else moves.
  const oldHeader = SHEET_COLUMNS.slice(0, SHEET_COLUMNS.length - 2)
  const calls = mockGoogle({ headerRow: oldHeader })
  const result = await exportOrdersToSheet({
    accessToken: 'token', sheetId: 'sheet', tab: 'Orders',
    orders: [order()], alreadyExported: [], includeExported: false, filters: {},
  })
  assert.equal(result.headingsWritten, 2, 'the two new headings were written')
  const put = calls.find((c) => c.method === 'PUT')
  assert.ok(put, 'a write was made')
  assert.match(put.url, /Z1%3AAA1/, 'into the cells after the ones already there')
  assert.deepEqual(put.body.values, [['Product ID', 'Colour']])
})

test('a sheet whose first row is data is never overwritten', async () => {
  const calls = mockGoogle({ headerRow: ['21102601', '2026-10-21'] })
  const result = await exportOrdersToSheet({
    accessToken: 'token', sheetId: 'sheet', tab: 'Orders',
    orders: [order()], alreadyExported: [], includeExported: false, filters: {},
  })
  assert.equal(result.headingsWritten, 0, 'nothing was written')
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 0, 'and no cell was touched')
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

test('the owner can send the same orders again on purpose', async () => {
  const calls = mockGoogle({ headerRow: SHEET_COLUMNS })
  const result = await exportOrdersToSheet({
    accessToken: 'token', sheetId: 'sheet', tab: 'Orders',
    orders: [order()], alreadyExported: ['o1'], includeExported: true, filters: {},
  })
  assert.equal(result.orders, 1)
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1)
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
