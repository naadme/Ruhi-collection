// Pricing helpers shared by the cart, checkout and order confirmation.
//
// Standard delivery is FREE on every order — no threshold, no charge. Express
// delivery by air (19 Nov 2026) is optional and costs ₹149 for every item,
// and a coupon never discounts it. This MUST stay in sync with
// `public.recalc_order_totals()` in
// supabase/migrations/20261119120000_express_delivery.sql — the database is
// authoritative for what a customer is actually charged; these values only
// drive what the shopper sees before they submit the order.

/** Standard delivery charge on an order: free for all products. */
export const SHIPPING_FEE = 0

/** Express delivery by air: ₹149 per item (2 items: ₹298). */
export const EXPRESS_FEE_PER_ITEM = 149

/** Express by air arrives within this many days of the order, every day
 *  counted (the owner's rule, 19 Nov 2026). */
export const EXPRESS_DAYS = 4

/** "Mon 23 Nov": the day an Express order placed at `createdAt` arrives by,
 *  counted in India, written as checkout and the emails write it. Uses the
 *  browser's own date formatting, so pages in the main script carry no date
 *  code (checkout has src/lib/delivery.js). */
export const expressByDate = (createdAt) => {
  const t = new Date(createdAt).getTime()
  if (!Number.isFinite(t)) return ''
  const day = new Date(t + EXPRESS_DAYS * 24 * 60 * 60 * 1000)
  const part = (o) => day.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', ...o })
  return `${part({ weekday: 'short' })} ${part({ day: 'numeric' })} ${part({ month: 'short' })}`
}

/** The two delivery options an order can have (orders.delivery_speed). */
export const STANDARD = 'standard'
export const EXPRESS = 'express'

/** Shipping charge for an order: 0 for standard delivery, ₹149 × the number
 *  of items for Express. Called with no arguments it is standard: 0. */
export const shippingFor = (speed = STANDARD, pieces = 0) =>
  speed === EXPRESS ? EXPRESS_FEE_PER_ITEM * Math.max(0, Math.floor(Number(pieces) || 0)) : SHIPPING_FEE

/** Grand total: the subtotal minus an optional coupon discount, plus shipping.
 *  A discount is always between 0 and the subtotal, so the products can never
 *  cost less than nothing — the same clamp the database applies — and the
 *  shipping is added after it, because no coupon discounts delivery. */
export const totalFor = (subtotal, discount = 0, shipping = 0) =>
  Math.max(0, subtotal - Math.max(0, Number(discount) || 0)) + Math.max(0, Number(shipping) || 0)

/** Indian digit grouping — ₹1,198 / ₹1,20,000. */
export const inr = (value) =>
  `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`

/**
 * True when the total this page is showing is exactly the amount the payment
 * window will collect.
 *
 * `started.amount` is what `create-razorpay-order` handed to Razorpay, in
 * paise, derived from the database's own `orders.total` via `toPaise()`. So
 * this compares the promise on screen with the charge itself, in one unit —
 * the page must never show ₹1,500 while the gateway takes ₹1,400, in either
 * direction. `serverHonoursCoupon()` checks the *discount* specifically; this
 * is the unconditional check on the *total*, and it also catches a stale
 * catalogue price when no coupon is involved at all.
 *
 * Fails OPEN only when the response carries no usable amount: there is nothing
 * to compare against then, and refusing would strand every shopper on a field
 * this checkout cannot read. Any real numeric disagreement returns false.
 */
export const displayedTotalMatchesCharge = (shownTotal, started) => {
  const paise = Number(started?.amount)
  if (!Number.isFinite(paise)) return true
  return Math.round(Number(shownTotal) * 100) === paise
}
