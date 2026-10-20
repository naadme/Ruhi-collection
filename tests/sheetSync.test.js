// The automatic Google Sheet sync.
//
// The client wants the sheet to hold every order, updated every day, without
// anyone having to press "Export". These tests fix the rules that make that
// safe: an order is never sent twice, a changed status is updated in place,
// and a failure never loses an order.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  isEligible,
  mapOrderRows,
  selectNewOrders,
  selectStatusChanges,
} from '../supabase/functions/_shared/sheetSync.mjs'

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8')

const order = (over = {}) => ({
  id: 'o1',
  reference: '01102601',
  status: 'pending',
  payment_status: 'paid',
  created_at: '2026-10-01T10:00:00.000Z',
  ...over,
})

test('a paid order is eligible for the sheet', () => {
  assert.equal(isEligible(order()), true)
  assert.equal(isEligible(order({ payment_status: 'pending' })), false,
    'an order whose payment was never taken is an abandoned basket')
  assert.equal(isEligible(order({ status: 'cancelled' })), false)
  assert.equal(isEligible(null), false)
})

test('an order the sheet already has is never sent again', () => {
  const orders = [order({ id: 'a' }), order({ id: 'b' }), order({ id: 'c' })]
  const { fresh, skipped } = selectNewOrders(orders, ['a', 'c'])
  assert.deepEqual(fresh.map((o) => o.id), ['b'])
  assert.deepEqual(skipped.map((o) => o.id), ['a', 'c'])
})

test('an unpaid order is not sent, however new it is', () => {
  const { fresh } = selectNewOrders([order({ id: 'b', payment_status: 'pending' })], [])
  assert.deepEqual(fresh, [])
})

test('a status the sheet is out of date about is found', () => {
  const orders = [
    order({ id: 'a', status: 'shipped', payment_status: 'paid' }),
    order({ id: 'b', status: 'pending', payment_status: 'paid' }),
  ]
  const ledger = [
    { order_id: 'a', last_status: 'pending', last_payment_status: 'paid' },
    { order_id: 'b', last_status: 'pending', last_payment_status: 'paid' },
  ]
  const changes = selectStatusChanges(orders, ledger)
  assert.deepEqual(changes.map((c) => c.order.id), ['a'], 'only the order whose status changed')
  assert.equal(changes[0].was, 'pending')
  assert.equal(changes[0].now, 'shipped')
})

test('a changed payment status is found as well', () => {
  const orders = [order({ id: 'a', status: 'pending', payment_status: 'refunded' })]
  const ledger = [{ order_id: 'a', last_status: 'pending', last_payment_status: 'paid' }]
  const changes = selectStatusChanges(orders, ledger)
  assert.equal(changes.length, 1)
})

test('an order the ledger has never seen is not a status change', () => {
  const orders = [order({ id: 'new' })]
  assert.deepEqual(selectStatusChanges(orders, []), [])
})

test('the sheet rows are found by the Order ID in the first column', () => {
  const rows = [
    ['Reference', 'Placed at'],
    ['01102601', '2026-10-01'],
    ['01102602', '2026-10-01'],
  ]
  const where = mapOrderRows(rows)
  assert.equal(where.get('01102601'), 2, 'spreadsheets count from 1')
  assert.equal(where.get('01102602'), 3)
  assert.equal(where.get('missing'), undefined)
})

test('the sync is reachable from the payment path and from a schedule', () => {
  const verify = read('supabase/functions/verify-razorpay-payment/index.ts')
  const webhook = read('supabase/functions/razorpay-webhook/index.ts')
  assert.match(verify, /syncSheetQuietly\(\)/, 'a verified payment sends the order to the sheet')
  assert.match(webhook, /syncSheetQuietly\(\)/, 'and so does a webhook delivery')

  const vercel = JSON.parse(read('vercel.json'))
  assert.ok(Array.isArray(vercel.crons) && vercel.crons.length, 'a scheduled job runs the sync')
  assert.equal(vercel.crons[0].path, '/api/google-sheets-sync')
  assert.match(vercel.crons[0].schedule, /^\d+ \d+ \* \* \*$/, 'and it runs every day')

  const job = read('api/google-sheets-sync.js')
  assert.match(job, /x-sync-secret/, 'the job proves itself with the shared secret')
  assert.match(job, /functions\/v1\/google-sheets-sync/, 'and asks the Edge Function to do the work')
})

test('the sync never touches an order, and never decides a payment', () => {
  const sync = read('supabase/functions/_shared/sheetSyncRun.ts')
  assert.ok(!/from\('orders'\)\s*\.update|\.from\('orders'\)\s*\.patch/.test(sync),
    'the sync only reads orders')
  assert.ok(!/payment_status:\s*'paid'/.test(sync), 'and never writes a payment status')
  const trigger = read('supabase/functions/_shared/sheetSyncTrigger.ts')
  assert.match(trigger, /catch/, 'a failure is swallowed — a sheet problem is never a payment problem')
})

test('the admin panel shows what the automatic sync did', () => {
  const panel = read('src/admin/GoogleSheetsPanel.jsx')
  assert.match(panel, /lastSync/, 'the last automatic sync is shown')
  assert.match(panel, /lastSync\?\.error/, 'and so is the reason it could not finish')
  const status = read('supabase/functions/google-sheets/index.ts')
  assert.match(status, /lastSync:\s*\{/, 'and the status action carries it')
})
