// Pricing helpers shared by the cart, checkout and order confirmation.
//
// Delivery is FREE on every order — there is no threshold and no delivery
// charge. This MUST stay in sync with `public.recalc_order_totals()` in
// supabase/migrations/20261019120100_coupons_and_order_discounts.sql — the
// database is authoritative for what a customer is actually charged; these
// values only drive what the shopper sees before they submit the order.

/** Delivery charge on an order. Free for all products, so always 0. */
export const SHIPPING_FEE = 0

/** Shipping charge — always 0, because delivery is free on every order. */
export const shippingFor = () => SHIPPING_FEE

/** Grand total for a given subtotal, minus an optional coupon discount.
 *  A discount is always between 0 and the subtotal, so the total can never
 *  go below zero — the same clamp the database applies. */
export const totalFor = (subtotal, discount = 0) =>
  Math.max(0, subtotal + shippingFor() - Math.max(0, Number(discount) || 0))

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
