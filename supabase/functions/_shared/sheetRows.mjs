// Turning the orders the admin is looking at into the rows a Google Sheet
// receives. Plain JavaScript on purpose: the Edge Function imports it and so
// does the Node test suite, so the sheet can never disagree with what the
// tests proved.
//
// THE NEW LAYOUT — one row per order
// ----------------------------------
// The client asked for a sheet with one line per order and these columns:
//
//   Order ID · Date · Customer Name · Phone · Email · Products · Quantity ·
//   Total Amount · Payment Status · Order Status
//
// so that is what `SHEET_COLUMNS` starts with. One order is one row, which is
// what makes "the same order must never appear twice" true even when a status
// changes or an export is retried: the order is found by its Order ID and the
// existing row is updated in place.
//
// A few useful columns follow the ten required ones. They are appended AFTER
// them so the client's required columns stay in the order she asked for.
//
// THE OLD LAYOUT — one row per line item
// -------------------------------------
// Spreadsheets created by the previous version of this feature have a
// different first row (`Reference`, `Placed at`, …). Those sheets are still
// honoured: their layout is detected from the header and the export keeps
// writing the shape they already have, so existing data does not move. New
// spreadsheets are always created with the new layout.

import { orderItemColour } from './orderItems.mjs'

/** The name of the spreadsheet this integration creates. */
export const DEFAULT_SHEET_TITLE = 'Ruhi Collections – Orders'

/** The columns of a new spreadsheet, in order. The first ten are the client's. */
export const SHEET_COLUMNS = [
  'Order ID',
  'Date',
  'Customer Name',
  'Phone',
  'Email',
  'Products',
  'Quantity',
  'Total Amount',
  'Payment Status',
  'Order Status',
  // Extra context, after the columns the client asked for.
  'Payment Method',
  'Address',
  'City',
  'State',
  'Pincode',
  'Subtotal (₹)',
  'Discount (₹)',
  'Coupon',
  'Shipping (₹)',
  'Razorpay Order ID',
  'Razorpay Payment ID',
  'Note',
  'Product ID',
  'Colour',
]

/** The columns of spreadsheets made by the previous version. Never changed. */
export const LEGACY_SHEET_COLUMNS = [
  'Reference', 'Placed at', 'Status', 'Payment status', 'Payment method',
  'Customer', 'Email', 'Phone', 'Address', 'City', 'State', 'Pincode',
  'Item', 'Size', 'Qty', 'Unit price (₹)', 'Line total (₹)', 'Subtotal (₹)',
  'Discount (₹)', 'Coupon', 'Shipping (₹)', 'Order total (₹)',
  'Razorpay order', 'Razorpay payment', 'Note',
  'Product ID', 'Colour',
]

export const ORDER_LAYOUT = 'order'
export const LEGACY_LAYOUT = 'legacy'

/** The tab the export writes into. */
export const SHEET_TAB = 'Orders'

/** Which columns a layout has. */
export function sheetColumnsFor(layout) {
  return layout === LEGACY_LAYOUT ? LEGACY_SHEET_COLUMNS : SHEET_COLUMNS
}

/**
 * Which layout a sheet already has, read from its first row.
 *
 *   'order'   a sheet this version made (or an empty sheet it may fill)
 *   'legacy'  a sheet the previous version made; keep its shape
 *   'empty'   no header yet
 *   'unknown' a sheet with somebody else's data in it — never overwrite it
 */
export function detectSheetLayout(header) {
  const first = String((Array.isArray(header) ? header[0] : header) ?? '').trim()
  if (!first) return 'empty'
  if (first === SHEET_COLUMNS[0]) return ORDER_LAYOUT
  if (first === LEGACY_SHEET_COLUMNS[0]) return LEGACY_LAYOUT
  return 'unknown'
}

/** The exact range and values that update the two status columns of a row. */
export function statusUpdate(layout, row, status, paymentStatus) {
  const n = Math.max(1, Math.floor(Number(row) || 1))
  if (layout === LEGACY_LAYOUT) {
    // Reference · Placed at · Status · Payment status …
    return { range: `C${n}:D${n}`, values: [[asText(status), asText(paymentStatus)]] }
  }
  // … Payment Status (I) · Order Status (J)
  return { range: `I${n}:J${n}`, values: [[asText(paymentStatus), asText(status)]] }
}

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

/** "Denim Shirt - Blue (Size M) × 2; …" — everything bought, on one line. */
export function formatProducts(order) {
  const items = Array.isArray(order?.order_items) ? order.order_items : []
  if (!items.length) return ''
  return items.map((it) => {
    const title = String(it?.title ?? '').trim() || 'Item'
    const size = String(it?.size ?? '').trim()
    const qty = Math.max(0, Math.floor(asNumber(it?.qty)))
    return `${title}${size ? ` (Size ${size})` : ''} × ${qty}`
  }).join('; ')
}

/** How many pieces the whole order contains. */
export function totalQuantity(order) {
  const items = Array.isArray(order?.order_items) ? order.order_items : []
  return items.reduce((sum, it) => sum + Math.max(0, Math.floor(asNumber(it?.qty))), 0)
}

/**
 * One order -> one row in the new layout.
 *
 * `Products` is a readable list of every line; `Quantity` is the total number
 * of pieces. Both are on the order's own row, so a filter or sort in Sheets
 * can never split one order across several unrelated rows.
 */
export function orderRows(order) {
  if (!order) return []
  return [[
    asText(order.reference),
    formatPlacedAt(order.created_at),
    asText(order.full_name),
    asText(order.phone),
    asText(order.email),
    formatProducts(order),
    totalQuantity(order),
    asNumber(order.total),
    asText(order.payment_status),
    asText(order.status),
    asText(order.payment_method),
    asText(order.address),
    asText(order.city),
    asText(order.state),
    asText(order.pincode),
    asNumber(order.subtotal),
    asNumber(order.discount),
    asText(order.coupon_code),
    asNumber(order.shipping),
    asText(order.razorpay_order_id),
    asText(order.razorpay_payment_id),
    asText(order.note),
    productIdsOf(order),
    coloursOf(order),
  ]]
}

/** The Product IDs on the order, once each, comma separated. */
export function productIdsOf(order) {
  const items = Array.isArray(order?.order_items) ? order.order_items : []
  const ids = items.map((it) => String(it?.sku ?? '').trim()).filter(Boolean)
  return [...new Set(ids)].join(', ')
}

/** The colours recorded on the order's lines, once each. */
export function coloursOf(order) {
  const items = Array.isArray(order?.order_items) ? order.order_items : []
  const colours = items.map((it) => orderItemColour(it?.title)).filter(Boolean)
  return [...new Set(colours)].join(', ')
}

/**
 * One order -> the rows a LEGACY sheet expects (one per line item, or one
 * when it has none). Kept byte-for-byte compatible with what that sheet
 * already holds; new sheets never use this.
 */
export function legacyOrderRows(order) {
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
    asText(it.sku),
    orderItemColour(it.title),
  ])
}

/**
 * Every order in the admin's CURRENT view — the same filtered, sorted array
 * the list on screen and the Excel download already describe.
 *
 * The header row is written separately, by `ensureSheetHeader`, before the
 * data is appended. That keeps headers out of the middle of the data even if
 * two exports run close together.
 */
export function buildSheetValues(orders, filters = {}, options = {}) {
  const layout = options.layout === LEGACY_LAYOUT ? LEGACY_LAYOUT : ORDER_LAYOUT
  const rows = []
  if (options.includeHeaders !== false) rows.push(sheetColumnsFor(layout))
  // The old layout wrote a filter sentence above its data. Keep doing so for
  // legacy sheets (their readers expect it); never put a non-order row in a
  // new sheet, where the Order ID column must identify every row.
  if (layout === LEGACY_LAYOUT) {
    const described = describeFilters(filters)
    if (described) rows.push([described])
  }
  for (const order of Array.isArray(orders) ? orders : []) {
    rows.push(...(layout === LEGACY_LAYOUT ? legacyOrderRows(order) : orderRows(order)))
  }
  return rows
}

/** The filter banner written above the data on legacy sheets. */
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
