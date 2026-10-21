// Order export: the admin Orders panel's "Export Excel" download.
//
// Reads only what the panel already loaded through the admin's own
// authenticated Supabase session (`orders` + `order_items`, gated by the
// same RLS that shows the panel) — there is no separate endpoint and no
// client-side query that could expose orders. One spreadsheet row per item,
// so an order with several products exports correctly; order-level money
// (coupon, discount, subtotal, shipping, total) is written on the FIRST row
// of each order only, so summing the column never double-counts.
//
// Columns follow the real schema — nothing is invented. The colour comes
// from the stored item title ("Stripes Dress - Pink" → "Pink"), the same
// " - Colour" rule the storefront grouping uses; coupon/discount columns are
// blank for orders placed before coupons existed.

import { buildXlsx } from '../lib/xlsx.js'
import { splitTitle } from '../lib/productGrouping.js'
import { formatShopDateTime } from '../lib/shopTime.js'

const PAY_METHOD = {
  razorpay: 'Online payment (Razorpay)',
  cod: 'Cash on delivery',
  offline: 'Offline payment',
}

export const EXPORT_COLUMNS = [
  'Order ID', 'Order date', 'Order status', 'Payment method', 'Payment status',
  'Customer name', 'Customer email', 'Customer phone', 'Shipping address',
  // "Product ID" is the client's six-character Product ID (CCPPCL) — the
  // number they read off the product. The product's own link is kept beside it so the
  // internal id is never lost.
  'Product ID', 'Product link', 'Product', 'Colour', 'Size', 'Quantity',
  'Item price', 'Item total',
  'Coupon code', 'Discount', 'Subtotal', 'Shipping', 'Order total', 'Delivery note',
]

const money = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// The shop's own date and time — the same clock the order's ID uses, so the
// date in the file and the date in the ID can never disagree.
const orderDate = (v) => formatShopDateTime(v)

const addressOf = (o) =>
  [o.address, o.city, o.state, o.pincode].map((p) => String(p || '').trim()).filter(Boolean).join(', ')

/** One spreadsheet row per order item (or one blank-item row for an order
 *  whose items are gone), with the order facts on the first row only. */
export function ordersToRows(orders) {
  const rows = []
  for (const o of orders || []) {
    const items = Array.isArray(o.order_items) ? o.order_items : []
    const orderCells = (first) =>
      first
        ? [
            o.reference || '',
            orderDate(o.created_at),
            o.status || '',
            PAY_METHOD[o.payment_method] || o.payment_method || '',
            o.payment_status || '',
            o.full_name || '',
            o.email || '',
            o.phone || '',
            addressOf(o),
          ]
        : ['', '', '', '', '', '', '', '', '']
    const moneyCells = (first) =>
      first
        ? [
            o.coupon_code || '',
            money(o.discount),
            money(o.subtotal),
            money(o.shipping),
            money(o.total),
            o.note || '',
          ]
        : ['', '', '', '', '', '']
    if (!items.length) {
      rows.push([...orderCells(true), '', '', '', '', '', '', '', '', ...moneyCells(true)])
      continue
    }
    items.forEach((it, i) => {
      rows.push([
        ...orderCells(i === 0),
        // The Product ID of the exact row that was bought, snapshotted onto
        // the line when the order was placed.
        it.sku || '',
        it.product_id || '',
        it.title || '',
        splitTitle(it.title)?.colour || '',
        it.size || '',
        money(it.qty),
        money(it.unit_price),
        money(it.unit_price) * money(it.qty),
        ...moneyCells(i === 0),
      ])
    })
  }
  return rows
}

/** Build the workbook bytes for these orders. */
export function ordersWorkbook(orders) {
  return buildXlsx({ sheetName: 'Orders', columns: EXPORT_COLUMNS, rows: ordersToRows(orders) })
}

/** Trigger a browser download of the orders as a real .xlsx file; returns the
 *  file name that was saved. */
export function downloadOrdersXlsx(orders) {
  const name = `ruhi-orders-${new Date().toISOString().slice(0, 10)}.xlsx`
  const blob = new Blob([ordersWorkbook(orders)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return name
}
