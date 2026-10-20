// The shop's own clock.
//
// The Order ID says which day an order belongs to: `01102601` is the first
// order of the 1st of October 2026 IN THE SHOP. The admin panel's date filter
// has to use the same day, or the filter and the ID would disagree — and the
// ID is the number the customer quotes on the phone.
//
// These tests fix the behaviour in the shop's time zone, whatever time zone
// the machine running them is in.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  SHOP_TIME_ZONE,
  SHOP_TIME_ZONE_LABEL,
  formatShopDateTime,
  shopDayEndExclusive,
  shopDayOf,
  shopDayStart,
  shopTimestamp,
} from '../src/lib/shopTime.js'
import { filterAndSortOrders } from '../src/lib/orderFiltering.js'

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8')

test('the shop keeps its own time zone', () => {
  assert.equal(SHOP_TIME_ZONE, 'Asia/Kolkata')
  assert.equal(SHOP_TIME_ZONE_LABEL, 'IST')
})

test('a day starts at midnight in the shop, not in the reader\'s own zone', () => {
  // 1 October 2026, 00:00 in the shop = 30 September, 18:30 UTC.
  const start = shopDayStart('2026-10-01')
  assert.equal(new Date(start).toISOString(), '2026-09-30T18:30:00.000Z')
  assert.equal(shopDayEndExclusive('2026-10-01'), start + 24 * 60 * 60 * 1000)
})

test('a half-typed date filter narrows nothing', () => {
  assert.equal(shopDayStart(''), null)
  assert.equal(shopDayStart('2026-10'), null)
  assert.equal(shopDayStart('not-a-date'), null)
  assert.equal(shopDayEndExclusive(''), null)
})

test('the day an order belongs to is the shop\'s day', () => {
  // 01:30 in the shop on the 1st is still the 1st in UTC terms — it is
  // 20:00 on the 30th. The ID says 01102601, so the filter must say the 1st.
  const justAfterMidnight = '2026-09-30T20:00:00.000Z'
  assert.equal(shopDayOf(justAfterMidnight), '2026-10-01')
  // And 23:30 in the shop on the 1st is 18:00 UTC on the 1st.
  assert.equal(shopDayOf('2026-10-01T18:00:00.000Z'), '2026-10-01')
})

test('the date filter uses the shop\'s day, so it and the Order ID agree', () => {
  const orders = [
    // 01:30 IST on 1 October 2026 — the ID would be 01102601.
    { id: 'a', reference: '01102601', created_at: '2026-09-30T20:00:00.000Z' },
    // 23:30 IST on 1 October 2026 — still 01102602.
    { id: 'b', reference: '01102602', created_at: '2026-10-01T18:00:00.000Z' },
    // 00:30 IST on 2 October 2026 — 02102601.
    { id: 'c', reference: '02102601', created_at: '2026-10-01T19:00:00.000Z' },
  ]
  const onTheFirst = filterAndSortOrders(orders, { from: '2026-10-01', to: '2026-10-01' })
  assert.deepEqual(onTheFirst.map((o) => o.reference), ['01102602', '01102601'],
    'both orders of the first of October, and nothing from the second')
})

test('the end date covers the whole day, and the start date covers none of it', () => {
  const orders = [
    { id: 'a', reference: 'A', created_at: '2026-09-30T18:29:59.000Z' }, // 23:59 IST on the 30th
    { id: 'b', reference: 'B', created_at: '2026-09-30T18:30:00.000Z' }, // 00:00 IST on the 1st
    { id: 'c', reference: 'C', created_at: '2026-10-01T18:29:59.000Z' }, // 23:59 IST on the 1st
    { id: 'd', reference: 'D', created_at: '2026-10-01T18:30:00.000Z' }, // 00:00 IST on the 2nd
  ]
  const first = filterAndSortOrders(orders, { from: '2026-10-01', to: '2026-10-01' })
  assert.deepEqual(first.map((o) => o.reference).sort(), ['B', 'C'])
})

test('an order with no usable date is left out of a date range, not into it', () => {
  const orders = [
    { id: 'a', reference: 'A', created_at: '2026-10-01T10:00:00.000Z' },
    { id: 'b', reference: 'B', created_at: 'not-a-date' },
  ]
  const inRange = filterAndSortOrders(orders, { from: '2026-10-01', to: '2026-10-01' })
  assert.deepEqual(inRange.map((o) => o.reference), ['A'])
})

test('the order date is shown in the shop\'s own time zone', () => {
  const shown = formatShopDateTime('2026-10-01T18:00:00.000Z')
  assert.match(shown, /1 Oct 2026/)
  assert.match(shown, /11:30/)
  assert.match(shown, /IST/)
})

test('a spreadsheet timestamp is the shop\'s own wall clock', () => {
  assert.equal(shopTimestamp('2026-10-01T18:00:00.000Z'), '2026-10-01 23:30:00')
  assert.equal(shopTimestamp('not-a-date'), '')
})

test('the admin panel and the export both use the shop\'s clock', () => {
  const panel = read('src/admin/OrdersPanel.jsx')
  assert.match(panel, /formatShopDateTime\(order\.created_at\)/, 'the order date in the list')
  assert.match(panel, /formatShopDateTime\(order\.paid_at\)/, 'and the date the payment landed')
  const exportFile = read('src/admin/orderExport.js')
  assert.match(exportFile, /formatShopDateTime/, 'and the date in the Excel download')
  // The old rule — the browser's own day — must be gone.
  assert.ok(!/new Date\(order\.created_at\)\.toLocaleString/.test(panel),
    'the browser\'s own time zone is no longer used')
})
