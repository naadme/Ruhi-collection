// Order search, status filtering, date-range filtering and date sorting for
// the admin Orders panel.
//
// Kept as a pure function on purpose: the panel loads every order the admin is
// allowed to see in one request (there is no server-side pagination in this
// store), so filtering and sorting are applied to that whole set — never to a
// single visible page. Making it pure also means the sort direction, the date
// range and the export all agree, because the Excel download consumes exactly
// the array this returns.
//
// Dates always use `orders.created_at` — the moment the order was placed — and
// never `updated_at`, which moves whenever an admin edits a status.

/** Fields searched by the free-text box, joined then lower-cased.
 *
 *  The order's PREVIOUS reference is searched too: orders placed before the
 *  DDMMYYNN format keep their old "RCH-XXXXXXXX" number beside the new one,
 *  and a customer who still has that number written down must be able to find
 *  their order with it. */
export function orderSearchText(order) {
  if (!order) return ''
  return [
    order.reference, order.previous_reference, order.full_name, order.email, order.phone, order.city,
    order.state, order.pincode, order.razorpay_order_id, order.razorpay_payment_id,
  ].filter(Boolean).join(' ').toLowerCase()
}

/** Parse a `yyyy-mm-dd` from an <input type="date"> into a Date, or null. */
function dayStart(value) {
  if (!value) return null
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Filter and sort a list of orders.
 *
 * @param {Array}  orders          every order the session may see
 * @param {object} opts
 * @param {string} opts.status     'all' or a status key
 * @param {string} opts.query      free-text search
 * @param {string} opts.sort       'newest' | 'oldest'
 * @param {string} opts.from       inclusive start date, yyyy-mm-dd
 * @param {string} opts.to         inclusive end date,   yyyy-mm-dd
 * @param {(v:unknown)=>string} opts.searchText  injectable for tests
 * @returns {Array} filtered, newest-first or oldest-first
 */
export function filterAndSortOrders(orders, opts = {}, searchText = orderSearchText) {
  const {
    status = 'all', query = '', sort = 'newest', from = '', to = '',
  } = opts || {}

  const needle = String(query || '').trim().toLowerCase()
  const start = dayStart(from)
  // The end date is inclusive of the whole day, so "to = 2026-10-19" still
  // contains an order placed at 23:59 that night.
  const endOfDay = dayStart(to)
  if (endOfDay) endOfDay.setDate(endOfDay.getDate() + 1)

  const filtered = (Array.isArray(orders) ? orders : []).filter((o) => {
    if (!o) return false
    if (status !== 'all' && o.status !== status) return false

    if (start || endOfDay) {
      const t = new Date(o.created_at).getTime()
      if (!Number.isFinite(t)) return false
      if (start && t < start.getTime()) return false
      if (endOfDay && t >= endOfDay.getTime()) return false
    }

    if (!needle) return true
    return searchText(o).includes(needle)
  })

  const dir = sort === 'oldest' ? 1 : -1
  return filtered.sort((a, b) => {
    const ta = new Date(a?.created_at).getTime()
    const tb = new Date(b?.created_at).getTime()
    // Invalid timestamps sink to the end in either direction rather than
    // landing randomly in the middle of the list.
    const va = Number.isFinite(ta) ? ta : null
    const vb = Number.isFinite(tb) ? tb : null
    if (va === null && vb === null) return 0
    if (va === null) return 1
    if (vb === null) return -1
    if (va === tb) return 0
    return (va - tb) * dir
  })
}
