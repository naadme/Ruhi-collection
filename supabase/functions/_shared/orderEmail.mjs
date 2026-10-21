// The text of the two order emails: the customer's confirmation and the store
// owner's new-order notification.
//
// It lives here, in plain JavaScript, for two reasons: the Edge Functions that
// send them and the Node test suite both read it, so the email the test proves
// is the email that goes out — and the body can be checked without a mail
// server, without an account and without sending anything to anybody.
//
// Plain text only. The shop's own words, the customer's own details, and
// nothing that could be mistaken for markup.

import { orderItemColour } from './orderItems.mjs'

/** ₹1,234 — the same shape the storefront shows. */
const money = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const inr = (v) => `₹${money(v).toLocaleString('en-IN')}`

const asText = (v) => (v === null || v === undefined ? '' : String(v))

const STATUS_LABEL = {
  pending: 'Received',
  confirmed: 'Confirmed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

/**
 * The order's own date and time, in the shop's time zone (IST).
 *
 * The store is in India and keeps no daylight saving, so the offset is fixed
 * and the date needs no timezone database. The date the customer reads here is
 * the same day the order's ID names — `01102601` is the first order of the 1st
 * of October 2026, and this is that date.
 */
export function formatOrderDate(value) {
  const ms = value instanceof Date ? value.getTime() : new Date(String(value ?? '')).getTime()
  if (!Number.isFinite(ms)) return ''
  const shifted = new Date(ms + (5 * 60 + 30) * 60 * 1000) // +05:30, five and a half hours
  const p = (n) => String(n).padStart(2, '0')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return (
    `${shifted.getUTCDate()} ${months[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}` +
    `, ${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())} IST`
  )
}

/** The delivery address, as the lines the customer gave. */
export function addressLines(order) {
  return [
    asText(order?.address),
    [asText(order?.city), asText(order?.state)].filter(Boolean).join(', '),
    asText(order?.pincode),
  ].map((line) => line.trim()).filter(Boolean)
}

// ---------------------------------------------------------------------------
// The two payment methods, and what each one means for the money.
// ---------------------------------------------------------------------------

/** True when the order is to be paid in cash when it is delivered. */
export function isCashOnDelivery(order) {
  return asText(order?.payment_method).toLowerCase() === 'cod'
}

/** True when the gateway has confirmed the money. */
export function isPaid(order) {
  return asText(order?.payment_status).toLowerCase() === 'paid'
}

/**
 * How the order is paid, in the customer's own words.
 *
 * A cash-on-delivery order has not been paid — it is paid on arrival — so it
 * must never be described as "paid". An online order is only "paid" once the
 * gateway says so.
 */
export function paymentLabel(order) {
  const method = asText(order?.payment_method).toLowerCase()
  if (method === 'cod') return 'Cash on delivery — pay when it arrives'
  if (isPaid(order)) return method === 'razorpay' ? 'Paid online (Razorpay)' : 'Paid online'
  return method === 'razorpay' ? 'Online payment — awaiting payment' : 'Payment pending'
}

/** The same fact, for the owner: what is owed and whether it has arrived. */
export function ownerPaymentLabel(order) {
  const method = asText(order?.payment_method).toLowerCase()
  if (method === 'cod') return 'Cash on delivery — not paid yet'
  if (isPaid(order)) return method === 'razorpay' ? 'Paid online (Razorpay)' : 'Paid online'
  return method === 'razorpay' ? 'Online payment — awaiting payment' : 'Payment pending'
}

/**
 * The one line that says what the money is, in a way that is true.
 *
 * A cash-on-delivery order has not been paid — it is paid on arrival — so it
 * must never say "Total paid". An online order is only "paid" once the
 * gateway says so.
 */
function totalLine(order) {
  const o = order || {}
  if (isCashOnDelivery(o)) return `Amount to pay on delivery: ${inr(o.total)}`
  if (isPaid(o)) return `Total paid: ${inr(o.total)}`
  return `Total: ${inr(o.total)}`
}

/**
 * The confirmation email for one order.
 *
 * `order` carries the order facts and `items` the order's lines. Every line
 * shows the product's name, the size, the colour, the Product ID of the exact
 * product that was bought, the quantity and the price — the same facts the
 * order shows in the admin panel and in the spreadsheet.
 */
export function buildConfirmationText(order, items) {
  const o = order || {}
  const lines = []
  const orderItems = Array.isArray(items) ? items : []

  lines.push('Ruhi Womens Clothing')
  lines.push('')
  lines.push(`Hello ${asText(o.full_name) || 'there'},`)
  lines.push('')
  lines.push('Thank you for your order with Ruhi Womens Clothing.')
  lines.push('')
  lines.push(`Order ID: ${asText(o.reference)}`)

  const placed = formatOrderDate(o.created_at)
  if (placed) lines.push(`Order date: ${placed}`)
  lines.push(`Status: ${STATUS_LABEL[asText(o.status)] || asText(o.status) || 'Received'}`)
  lines.push(`Payment: ${paymentLabel(o)}`)

  const address = addressLines(o)
  if (address.length) {
    lines.push('')
    lines.push('Delivering to')
    for (const line of address) lines.push(line)
  }
  if (asText(o.phone)) lines.push(`Phone: ${asText(o.phone)}`)

  lines.push('')
  lines.push('Items')

  for (const item of orderItems) {
    const bits = [
      asText(item?.size) && `Size ${asText(item.size)}`,
      // The colour is not a column of its own on the order line: it is part of
      // the title the order snapshotted ("Denim Shirt - Blue").
      orderItemColour(item?.title),
      asText(item?.sku) && `Product ID ${asText(item.sku)}`,
    ].filter(Boolean).join(', ')
    const qty = money(item?.qty)
    lines.push(
      `- ${asText(item?.title)}${bits ? ` (${bits})` : ''}` +
        ` × ${qty}${item?.unit_price ? ` — ${inr(money(item.unit_price) * qty)}` : ''}`,
    )
  }

  lines.push('')
  if (orderItems.length && money(orderItems[0].qty) * money(orderItems[0].unit_price)) {
    lines.push(`Subtotal: ${inr(o.subtotal)}`)
  }
  if (money(o.discount)) {
    lines.push(`Discount: −${inr(o.discount)}${asText(o.coupon_code) ? ` (${asText(o.coupon_code)})` : ''}`)
  }
  lines.push(`Shipping: ${money(o.shipping) ? inr(o.shipping) : 'Free'}`)
  lines.push(totalLine(o))

  if (isCashOnDelivery(o)) {
    lines.push('')
    lines.push(
      `Please keep ${inr(o.total)} ready for the delivery agent. ` +
        'You can pay in cash when the parcel reaches you.',
    )
  }

  lines.push('')
  lines.push('We will let you know as soon as your order ships.')
  lines.push('')
  lines.push('Any questions? Call or WhatsApp 9046651272, or write to')
  lines.push('ruhicollections2026@gmail.com — we reply within a working day.')
  lines.push('')
  lines.push('— Ruhi Womens Clothing')

  return lines.join('\n')
}

/** The subject line: the brand, the order, and what the mail is. */
export function buildConfirmationSubject(reference) {
  return `Your Ruhi Womens Clothing order ${asText(reference)} — confirmation`
}

// ---------------------------------------------------------------------------
// The owner's notification.
// ---------------------------------------------------------------------------

/**
 * The new-order notification the store owner receives.
 *
 * Everything the owner needs to act on the order without opening the admin
 * panel: who it is, where it goes, what was bought and how much, and whether
 * the money has arrived. The reply address is the customer's own, so answering
 * the mail answers the customer.
 */
export function buildOwnerNotificationText(order, items) {
  const o = order || {}
  const lines = []
  const orderItems = Array.isArray(items) ? items : []

  lines.push('New order — Ruhi Womens Clothing')
  lines.push('')
  lines.push(`Order ID: ${asText(o.reference)}`)

  const placed = formatOrderDate(o.created_at)
  if (placed) lines.push(`Order date: ${placed}`)
  lines.push(`Status: ${STATUS_LABEL[asText(o.status)] || asText(o.status) || 'Received'}`)
  lines.push(`Payment: ${ownerPaymentLabel(o)}`)
  if (asText(o.razorpay_payment_id)) lines.push(`Payment ID: ${asText(o.razorpay_payment_id)}`)

  lines.push('')
  lines.push('Customer')
  lines.push(`Name: ${asText(o.full_name)}`)
  lines.push(`Email: ${asText(o.email)}`)
  lines.push(`Phone: ${asText(o.phone)}`)

  lines.push('')
  lines.push('Delivery address')
  const address = addressLines(o)
  if (address.length) {
    for (const line of address) lines.push(line)
  } else {
    lines.push('(no address on file)')
  }
  if (asText(o.note)) lines.push(`Delivery note: ${asText(o.note)}`)

  lines.push('')
  lines.push(`Items (${orderItems.length} ${orderItems.length === 1 ? 'line' : 'lines'})`)
  for (const item of orderItems) {
    const bits = [
      asText(item?.size) && `Size ${asText(item.size)}`,
      orderItemColour(item?.title),
      asText(item?.sku) && `Product ID ${asText(item.sku)}`,
    ].filter(Boolean).join(', ')
    const qty = money(item?.qty)
    lines.push(
      `- ${asText(item?.title)}${bits ? ` (${bits})` : ''}` +
        ` × ${qty}${item?.unit_price ? ` — ${inr(money(item.unit_price) * qty)}` : ''}`,
    )
  }

  lines.push('')
  if (money(o.subtotal)) lines.push(`Subtotal: ${inr(o.subtotal)}`)
  if (money(o.discount)) {
    lines.push(`Discount: −${inr(o.discount)}${asText(o.coupon_code) ? ` (${asText(o.coupon_code)})` : ''}`)
  }
  lines.push(`Shipping: ${money(o.shipping) ? inr(o.shipping) : 'Free'}`)
  lines.push(`Total: ${inr(o.total)}`)

  lines.push('')
  lines.push('— Ruhi Womens Clothing')

  return lines.join('\n')
}

/**
 * The subject of the owner's notification: the order, how it is paid and what
 * it is worth — so the mailbox can be triaged without opening anything.
 */
export function buildOwnerNotificationSubject(order) {
  const o = order || {}
  const method = isCashOnDelivery(o) ? 'Cash on delivery' : isPaid(o) ? 'Paid online' : 'Online payment'
  return `New order ${asText(o.reference)} — ${method} — ${inr(o.total)}`
}
