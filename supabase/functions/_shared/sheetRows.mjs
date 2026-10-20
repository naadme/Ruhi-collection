// Turning the orders the admin is looking at into the rows a Google Sheet
// receives. Plain JavaScript on purpose: the Edge Function imports it and so
// does the Node test suite, so the sheet can never disagree with what the
// tests proved.

/** The columns every export writes, in order. */
export const SHEET_COLUMNS = [
  'Reference', 'Placed at', 'Status', 'Payment', 'Customer', 'Email', 'Phone',
  'Address', 'City', 'State', 'Pincode', 'Item', 'Size', 'Qty', 'Unit price',
  'Line total', 'Subtotal', 'Discount', 'Coupon', 'Shipping', 'Order total',
  'Razorpay order', 'Razorpay payment', 'Note',
]

const asText = (v) => (v === null || v === undefined ? '' : v)

/** A timestamp as the admin already reads it in the panel — en-IN, so a sheet
 *  and the Orders screen can never describe the same order differently. */
export function formatPlacedAt(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return asText(value)
  try {
    return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return d.toISOString()
  }
}

/**
 * One order -> one row per line item (and one row when it has none).
 *
 * The order's own money is repeated on every item row, so filtering or
 * pivoting a column of a real sheet never splits an order's totals across
 * rows that can no longer be traced back to it.
 */
export function orderRows(order) {
  if (!order) return []
  const head = [
    asText(order.reference),
    formatPlacedAt(order.created_at),
    asText(order.status),
    asText(order.payment_status || ''),
    asText(order.full_name),
    asText(order.email),
    asText(order.phone),
    asText(order.address),
    asText(order.city),
    asText(order.state),
    asText(order.pincode),
  ]
  const tail = [
    Number(order.subtotal) || 0,
    Number(order.discount) || 0,
    asText(order.coupon_code),
    Number(order.shipping) || 0,
    Number(order.total) || 0,
    asText(order.razorpay_order_id),
    asText(order.razorpay_payment_id),
    asText(order.note),
  ]
  const items = Array.isArray(order.order_items) ? order.order_items : []
  if (!items.length) return [[...head, '', '', '', '', '', ...tail]]
  return items.map((it) => [
    ...head,
    asText(it.title),
    asText(it.size),
    Number(it.qty) || 0,
    Number(it.unit_price) || 0,
    (Number(it.qty) || 0) * (Number(it.unit_price) || 0),
    ...tail,
  ])
}

/**
 * Every order in the admin's CURRENT view — the same filtered, sorted array
 * the list on screen and the Excel download already describe.
 */
export function buildSheetValues(orders, filters = {}) {
  const rows = [SHEET_COLUMNS]
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
 * The message an admin needs when the integration has not been set up yet.
 *
 * Never mentions a value, only the names of the variables — this text is
 * rendered in a browser, so it must be safe to show even to someone who is
 * not the person who configured the project.
 */
export function missingConfigMessage(missing) {
  const names = (Array.isArray(missing) ? missing : []).filter(Boolean)
  return [
    'Google Sheets export is not set up on this project yet.',
    names.length ? `Still missing: ${names.join(', ')}.` : '',
    '1. Create a Google Cloud project and enable the Google Sheets API.',
    '2. Create a service account, download its JSON key, and share the target spreadsheet with the service account email (Editor).',
    `3. Add the project secrets: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY${names.includes('GOOGLE_SHEET_ID') ? ', GOOGLE_SHEET_ID' : ''}.`,
    '4. Deploy the export-orders-sheet Edge Function, then try again.',
    'The Excel download keeps working in the meantime.',
  ].filter(Boolean)
}

/** Which of the settings the function needs are absent from `env`. */
export function missingConfig(env, keys = ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEET_ID']) {
  return keys.filter((k) => {
    const v = env?.[k]
    return typeof v !== 'string' || v.trim().length === 0
  })
}
