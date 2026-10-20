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
//
// The date RANGE is the shop's own day, not the browser's: the Order ID
// `01102601` means "the first order of the 1st of October 2026 in the shop",
// so the filter that decides which orders belong to a day has to use the same
// clock. Otherwise an admin working from another time zone would filter by a
// different day from the one the customer's Order ID names.

import { shopDayEndExclusive, shopDayStart } from './shopTime.js'

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
  // Both ends of the range are the SHOP's day: "from = 2026-10-19" starts at
  // 00:00 in the shop, and "to = 2026-10-19" runs to the end of that same day.
  const start = shopDayStart(from)
  const endOfDay = shopDayEndExclusive(to)

  const filtered = (Array.isArray(orders) ? orders : []).filter((o) => {
    if (!o) return false
    if (status !== 'all' && o.status !== status) return false

    if (start !== null || endOfDay !== null) {
      const t = new Date(o.created_at).getTime()
      if (!Number.isFinite(t)) return false
      if (start !== null && t < start) return false
      if (endOfDay !== null && t >= endOfDay) return false
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
