// Pricing helpers shared by the cart, checkout and order confirmation.
//
// The shipping rule MUST stay in sync with `public.set_order_totals()` in
// supabase/migrations/20260928181500_orders_and_checkout.sql — the database is
// authoritative for what a customer is actually charged; these values only
// drive what the shopper sees before they submit the order.

export const FREE_SHIPPING_OVER = 999
export const SHIPPING_FEE = 79

/** Shipping charge for a given subtotal (0 when the order qualifies for free shipping). */
export const shippingFor = (subtotal) =>
  subtotal >= FREE_SHIPPING_OVER ? 0 : SHIPPING_FEE

/** Grand total for a given subtotal. */
export const totalFor = (subtotal) => subtotal + shippingFor(subtotal)

/** Indian digit grouping — ₹1,198 / ₹1,20,000. */
export const inr = (value) =>
  `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`

/** How much more a cart needs to spend before shipping becomes free. */
export const amountToFreeShipping = (subtotal) =>
  Math.max(0, FREE_SHIPPING_OVER - subtotal)
