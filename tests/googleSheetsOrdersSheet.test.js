// The client's orders spreadsheet, as she asked for it.
//
// These tests pin the promises that are visible to her: the spreadsheet's exact
// name, the ten columns in the order she listed, one row per order, a status
// that is kept up to date in the same row, and a dashboard button that opens
// the real sheet. They also pin the boundary: no Google credential or service
// key may appear in the browser code.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  DEFAULT_SHEET_TITLE,
  LEGACY_LAYOUT,
  LEGACY_SHEET_COLUMNS,
  ORDER_LAYOUT,
  SHEET_COLUMNS,
  detectSheetLayout,
  orderRows,
  statusUpdate,
} from '../supabase/functions/_shared/sheetRows.mjs'

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8')

const REQUIRED_COLUMNS = [
  'Order ID', 'Date', 'Customer Name', 'Phone', 'Email',
  'Products', 'Quantity', 'Total Amount', 'Payment Status', 'Order Status',
]

const ORDER = {
  id: 'o1',
  reference: '21102601',
  created_at: '2026-10-20T18:30:00.000Z',
  status: 'shipped',
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
}

test('the spreadsheet has the exact name the client was given', () => {
  assert.equal(DEFAULT_SHEET_TITLE, 'Ruhi Collections – Orders',
    'an en dash, exactly as written for the client')
  const panel = read('src/admin/GoogleSheetsPanel.jsx')
  assert.match(panel, /Ruhi Collections – Orders/, 'the panel names the same sheet')
})

test('the ten required columns come first, in the client\'s order', () => {
  assert.deepEqual(SHEET_COLUMNS.slice(0, 10), REQUIRED_COLUMNS)
})

test('one order is one row, and status updates stay in that row', () => {
  const rows = orderRows(ORDER)
  assert.equal(rows.length, 1, 'one order, one row')
  const row = rows[0]
  const at = (name) => row[SHEET_COLUMNS.indexOf(name)]
  assert.equal(at('Order ID'), '21102601')
  assert.equal(at('Products'), 'Denim Shirt - Blue (Size M) × 2')
  assert.equal(at('Quantity'), 2)
  assert.equal(at('Total Amount'), 1800)
  assert.equal(at('Payment Status'), 'paid')
  assert.equal(at('Order Status'), 'shipped')

  // Payment Status is column I and Order Status is column J on the order row.
  assert.deepEqual(statusUpdate(ORDER_LAYOUT, 7, 'delivered', 'paid'), {
    range: 'I7:J7',
    values: [['paid', 'delivered']],
  })
})

test('a sheet made by the previous version keeps its old shape', () => {
  assert.equal(detectSheetLayout(['Order ID']), ORDER_LAYOUT)
  assert.equal(detectSheetLayout(['Reference']), LEGACY_LAYOUT)
  assert.equal(detectSheetLayout([]), 'empty')
  assert.equal(detectSheetLayout(['Somebody else\'s data']), 'unknown')
  // The legacy sheet still has its status columns where they always were.
  assert.deepEqual(statusUpdate(LEGACY_LAYOUT, 4, 'delivered', 'paid'), {
    range: 'C4:D4',
    values: [['delivered', 'paid']],
  })
  assert.equal(LEGACY_SHEET_COLUMNS[0], 'Reference')
})

test('the admin dashboard shows a visible Google Sheets – Orders button', () => {
  const button = read('src/admin/GoogleSheetsButton.jsx')
  assert.match(button, /Google Sheets – Orders/, 'the label is exactly what the client asked for')
  assert.match(button, /docs\.google\.com\/spreadsheets\/d\//, 'it is a real link to the spreadsheet')
  assert.match(button, /target="_blank"/, 'and opens in a new tab')
  assert.match(button, /connect=1/, 'before setup it starts the one-time connection instead of being a dead link')

  const dashboard = read('src/admin/Dashboard.jsx')
  const rendered = dashboard.match(/<GoogleSheetsButton \/>/g) || []
  assert.ok(rendered.length >= 2, 'it is shown on the products view and on every owner section')
})

test('the panel offers open, share and sync, and says what is in the sheet', () => {
  const panel = read('src/admin/GoogleSheetsPanel.jsx')
  assert.match(panel, /Open spreadsheet/)
  assert.match(panel, /Share with client/)
  assert.match(panel, /Sync now/)
  assert.match(panel, /createSheet/, 'a create action is wired, not a placeholder')
  assert.match(panel, /includeExported/, 'refreshing an existing order is offered')
  assert.match(panel, /never appears twice|never adds a duplicate row/i,
    'the panel explains that a retry does not duplicate a row')
  assert.match(panel, /sheetLayout|layout === 'legacy'/, 'the real layout is shown')
  assert.match(panel, /share\?\.shared/, 'and whether Google really shared it')
})

test('the browser never receives or sends a Google credential', () => {
  for (const file of [
    'src/lib/googleSheets.js',
    'src/admin/GoogleSheetsPanel.jsx',
    'src/admin/GoogleSheetsButton.jsx',
  ]) {
    const code = read(file)
    assert.doesNotMatch(code, /service_role/i, `${file} has no service-role key`)
    assert.doesNotMatch(code, /GOOGLE_CLIENT_SECRET|client_secret/i, `${file} has no Google client secret`)
    assert.doesNotMatch(code, /refresh_token/i, `${file} has no refresh token`)
    assert.doesNotMatch(code, /supabase\.co\/functions\/v1\/google-sheets-callback/,
      `${file} talks to the function, never to the OAuth callback directly`)
  }
  const client = read('src/lib/googleSheets.js')
  assert.match(client, /CLIENT_SHEET_EMAIL = 'ruhicollections2026@gmail\.com'/,
    'only the public client address is named')
  assert.match(client, /shareSheet/, 'sharing goes through the Edge Function')
})

test('the Edge Function reports the layout and the share, and can share on demand', () => {
  const fn = read('supabase/functions/google-sheets/index.ts')
  assert.match(fn, /sheetLayout:/, 'the status carries the real layout')
  assert.match(fn, /share:\s*\{/, 'and whether the client can open the sheet')
  assert.match(fn, /async function actionShare/, 'sharing is its own action')
  assert.match(fn, /case 'share': return actionShare/, 'and is reachable from the panel')
  assert.match(fn, /GOOGLE_SHEET_CLIENT_EMAIL/, 'the client address is configurable, not hardcoded twice')
  assert.doesNotMatch(fn, /console\.(log|warn|error)\([^)]*refresh_token/i,
    'a refresh token is never logged')
})

test('a status change reaches the sheet without waiting for the daily job', () => {
  const orders = read('src/admin/OrdersPanel.jsx')
  assert.match(orders, /import \{ syncSheetsNow \} from '..\/lib\/googleSheets'/)
  assert.match(orders, /syncSheetsNow\(\)/, 'a saved status updates the sheet now')
  assert.match(orders, /\.catch\(\(\) => notify\('error', 'Order saved, but the Google Sheet/,
    'and a Google failure is never reported as a failed order')
})

test('the share state is stored in the database, so it survives a restart', () => {
  const mig = read('supabase/migrations/20261114100000_google_sheets_client_share.sql')
  assert.match(mig, /shared_with_email text/)
  assert.match(mig, /shared_at timestamptz/)
  assert.match(mig, /share_error text/)
})
