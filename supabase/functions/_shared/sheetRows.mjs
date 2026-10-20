// Turning the orders the admin is looking at into the rows a Google Sheet
// receives. Plain JavaScript on purpose: the Edge Function imports it and so
// does the Node test suite, so the sheet can never disagree with what the
// tests proved.
//
// The formatting is chosen so a real spreadsheet is useful the moment it
// lands, without the owner having to clean anything up:
//   * a header row, so the columns are named;
//   * dates as `YYYY-MM-DD HH:MM:SS` in the store's own time zone — Sheets
//     reads that as a real date cell, so it can be sorted and filtered;
//   * money as plain numbers, with the unit in the column name;
//   * one row per line item, with the order's own totals repeated on every
//     item row, so a column of the sheet can never split an order's money
//     away from the order it belongs to.

/** The columns every export writes, in order.
 *
 *  The two newest columns are at the END on purpose: the export appends, so a
 *  column inserted in the middle would shift every column to its right and
 *  the sheet the owner already has would show the wrong headings against the
 *  wrong data. Appending leaves the existing rows exactly where they are.
 */

import { orderItemColour } from './orderItems.mjs'
export const SHEET_COLUMNS = [
  'Reference', 'Placed at', 'Status', 'Payment status', 'Payment method',
  'Customer', 'Email', 'Phone', 'Address', 'City', 'State', 'Pincode',
  'Item', 'Size', 'Qty', 'Unit price (₹)', 'Line total (₹)', 'Subtotal (₹)',
  'Discount (₹)', 'Coupon', 'Shipping (₹)', 'Order total (₹)',
  'Razorpay order', 'Razorpay payment', 'Note',
  'Product ID', 'Colour',
]

/** The tab the export writes into, and the range it appends to. */
export const SHEET_TAB = 'Orders'
export const SHEET_RANGE = `${SHEET_TAB}!A1`

const asText = (v) => (v === null || v === undefined ? '' : v)
const asNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/**
 * A timestamp as the shop's own wall clock — `2026-10-05 16:00:00`.
 *
 * The store is in India and keeps no daylight saving, so the offset is fixed
 * and the conversion needs no timezone database. Sheets parses this shape as
 * a date and time, which is what makes the column sortable.
 */
export function formatPlacedAt(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return asText(value)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (type) => parts.find((p) => p.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

/**
 * One order -> one row per line item (and one row when it has none).
 */
export function orderRows(order) {
  if (!order) return []
  const head = [
    asText(order.reference),
    formatPlacedAt(order.created_at),
    asText(order.status),
    asText(order.payment_status || ''),
    asText(order.payment_method || ''),
    asText(order.full_name),
    asText(order.email),
    asText(order.phone),
    asText(order.address),
    asText(order.city),
    asText(order.state),
    asText(order.pincode),
  ]
  const tail = [
    asNumber(order.subtotal),
    asNumber(order.discount),
    asText(order.coupon_code),
    asNumber(order.shipping),
    asNumber(order.total),
    asText(order.razorpay_order_id),
    asText(order.razorpay_payment_id),
    asText(order.note),
  ]
  const items = Array.isArray(order.order_items) ? order.order_items : []
  if (!items.length) return [[...head, '', '', '', '', '', ...tail, '', '']]
  return items.map((it) => [
    ...head,
    asText(it.title),
    asText(it.size),
    asNumber(it.qty),
    asNumber(it.unit_price),
    asNumber(it.qty) * asNumber(it.unit_price),
    ...tail,
    // The Product ID of the exact product that was bought, and the colour the
    // shopper chose, both from the line itself.
    asText(it.sku),
    orderItemColour(it.title),
  ])
}

/**
 * Every order in the admin's CURRENT view — the same filtered, sorted array
 * the list on screen and the Excel download already describe.
 *
 * The header row is written only on the FIRST export to a sheet: the export
 * appends, so writing the headers every time would put them in the middle of
 * the data. The caller knows which case it is, because the export ledger
 * already says whether the sheet has anything in it.
 */
export function buildSheetValues(orders, filters = {}, options = {}) {
  const rows = []
  if (options.includeHeaders !== false) rows.push(SHEET_COLUMNS)
  const described = describeFilters(filters)
  if (described) rows.push([described])
  for (const order of Array.isArray(orders) ? orders : []) rows.push(...orderRows(order))
  return rows
}

/** The filter banner written above the data, so a saved sheet still says what
 *  it contains. Returns '' when nothing was filtered. */
export function describeFilters(filters = {}) {
  const parts = []
  if (filters.status && filters.status !== 'all') parts.push(`status: ${filters.status}`)
  if (filters.query) parts.push(`search: “${filters.query}”`)
  if (filters.from) parts.push(`from ${filters.from}`)
  if (filters.to) parts.push(`to ${filters.to}`)
  return parts.length ? `Filtered to ${parts.join(' · ')}` : ''
}

/**
 * Which of these orders are already in this sheet.
 *
 * The export is append-only, so an order that has been sent before must not
 * be sent again — that is how a sheet stops filling up with the same three
 * orders every week. A plain set membership test, so it can be unit-tested
 * without a database.
 */
export function duplicatesAmong(orders, alreadyExported) {
  const seen = new Set((Array.isArray(alreadyExported) ? alreadyExported : []).map(String))
  const fresh = []
  const repeated = []
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!order?.id) continue
    if (seen.has(String(order.id))) repeated.push(order)
    else fresh.push(order)
  }
  return { fresh, repeated }
}
