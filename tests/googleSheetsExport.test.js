// Google Sheets export (requirement 4).
//
// The row building and the setup messaging live in
// supabase/functions/_shared/sheetRows.mjs — plain JavaScript on purpose, so
// the Edge Function and this suite run the SAME code. The handler itself is
// pinned by source assertions, because it needs Deno, a JWT and a service
// account to run.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  SHEET_COLUMNS, buildSheetValues, describeFilters, missingConfig,
  missingConfigMessage, orderRows,
} from '../supabase/functions/_shared/sheetRows.mjs'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const FN = 'supabase/functions/export-orders-sheet/index.ts'

const order = (extra = {}) => ({
  id: 'o1', reference: 'RCH-0001', created_at: '2026-10-05T10:30:00+00:00', status: 'confirmed',
  payment_status: 'paid', full_name: 'Asha Rao', email: 'a@example.com', phone: '9000000000',
  address: '1 Main Street', city: 'Pune', state: 'MH', pincode: '411001',
  subtotal: 958, discount: 0, coupon_code: null, shipping: 0, total: 958,
  razorpay_order_id: 'order_A', razorpay_payment_id: 'pay_A', note: null,
  order_items: [],
  ...extra,
})

test('one order becomes one row per item, with the totals repeated', () => {
  const rows = orderRows(order({
    order_items: [
      { title: 'Denim Shirt - Blue', size: 'M', qty: 2, unit_price: 479 },
      { title: 'Denim Shirt - Red', size: 'L', qty: 1, unit_price: 479 },
    ],
  }))
  assert.equal(rows.length, 2)
  assert.equal(rows[0].length, SHEET_COLUMNS.length)
  assert.equal(rows[0][0], 'RCH-0001', 'reference')
  assert.equal(rows[0][11], 'Denim Shirt - Blue', 'item')
  assert.equal(rows[0][14], 479, 'unit price')
  assert.equal(rows[0][15], 958, 'line total is qty × unit price')
  assert.equal(rows[1][15], 479)
  assert.equal(rows[0][20], 958, 'the order total repeats on every item row')
})

test('an order with no line items still gets exactly one row', () => {
  const rows = orderRows(order())
  assert.equal(rows.length, 1)
  assert.equal(rows[0].length, SHEET_COLUMNS.length)
  assert.equal(rows[0][0], 'RCH-0001')
})

test('dates are written the way the admin already reads them', () => {
  const [row] = orderRows(order())
  assert.match(String(row[1]), /2026/, 'the year survives')
  assert.equal(orderRows(order({ created_at: 'not-a-date' }))[0][1], 'not-a-date')
})

test('the active filters are recorded, so a saved sheet still says what it holds', () => {
  assert.equal(describeFilters({}), '')
  assert.equal(describeFilters({ status: 'all' }), '')
  assert.match(describeFilters({ status: 'shipped', query: 'pune' }), /status: shipped/)
  assert.match(describeFilters({ from: '2026-10-01', to: '2026-10-03' }), /from 2026-10-01/)

  const values = buildSheetValues([order()], { status: 'shipped' })
  assert.deepEqual(values[0], SHEET_COLUMNS, 'header first')
  assert.match(values[1][0], /Filtered to status: shipped/, 'then the filter banner')
  assert.equal(values[2][0], 'RCH-0001', 'then the data')
})

test('missing credentials produce a useful setup message, never a success', () => {
  assert.deepEqual(missingConfig({}), [
    'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEET_ID',
  ])
  assert.deepEqual(
    missingConfig({ GOOGLE_SHEET_ID: '   ' }),
    ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEET_ID'],
    'a blank value counts as missing',
  )
  assert.deepEqual(missingConfig({ GOOGLE_SHEET_ID: 's' }), ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY'])
  assert.deepEqual(missingConfig({ GOOGLE_SERVICE_ACCOUNT_EMAIL: 'a@b.iam.gserviceaccount.com', GOOGLE_PRIVATE_KEY: 'k', GOOGLE_SHEET_ID: 's' }), [])

  const text = missingConfigMessage(['GOOGLE_PRIVATE_KEY']).join('\n')
  assert.match(text, /not set up/)
  assert.match(text, /Still missing: GOOGLE_PRIVATE_KEY/)
  assert.match(text, /Google Sheets API/)
  assert.match(text, /service account/)
  assert.match(text, /share/i)
  assert.match(text, /GOOGLE_SERVICE_ACCOUNT_EMAIL/)
  assert.match(text, /Excel download keeps working/)
  assert.doesNotMatch(text, /BEGIN PRIVATE KEY/, 'a key never appears in a message shown in a browser')
})

// ---- the handler ------------------------------------------------------------

test('the handler keeps every credential server-side', () => {
  const fn = read(FN)
  assert.doesNotMatch(fn, /REACT_APP_|VITE_|import\.meta\.env/, 'nothing is read from the Vite bundle')
  assert.match(fn, /GOOGLE_PRIVATE_KEY/, 'read from Edge Function secrets only')
  assert.doesNotMatch(fn, /console\.(log|warn|info)\([^)]*GOOGLE_PRIVATE_KEY/,
    'the key itself is never logged')
  assert.match(fn, /json\(501, \{[\s\S]*setup:/, 'an unconfigured project answers with setup steps, not with a fake export')
  assert.match(fn, /ok: true/, 'only a real append announces success')
})

test('the handler authorises the caller instead of trusting the request', () => {
  const fn = read(FN)
  assert.match(fn, /isAdmin\(userId\)/, 'the caller must be in public.admins')
  assert.match(fn, /fail\(403, 'Only the store owner can export/, 'everyone else is refused')
  assert.match(fn, /auth\/v1\/user/, "the caller's own JWT is verified by Supabase Auth")
  assert.match(fn, /serviceFetch\(\s*\n?\s*`\/rest\/v1\/admins\?user_id=/, 'the admin check runs with the service role')
})

test('the handler reads only the rows the admin asked for, with their items', () => {
  const fn = read(FN)
  assert.match(fn, /order_items\(title,size,qty,unit_price\)/, 'item-level rows are fetched')
  assert.match(fn, /order=created_at\.desc/, 'the sheet is newest-first like the screen')
  assert.match(fn, /ids\.length > MAX_IDS/, 'a runaway request is refused')
})

test('a Google refusal is reported as a setup problem, never as a success', () => {
  const fn = read(FN)
  assert.match(fn, /res\.status === 401 \|\| res\.status === 403/, 'a bad key or scope')
  assert.match(fn, /res\.status === 404/, 'a sheet the service account cannot open')
  assert.match(fn, /Share.*service account|service account email as an Editor/,
    'the 404 answer tells the owner to share the sheet')
})

test('the Excel export is still there', () => {
  const panel = read('src/admin/OrdersPanel.jsx')
  assert.match(panel, /downloadOrdersXlsx/, 'the existing download is untouched')
  assert.match(panel, /Export to Google Sheets/, 'and the new action sits beside it')
  assert.match(panel, /exportToSheets/)
  assert.match(panel, /sheets\.setup/, 'a failed export shows the setup steps')
})
