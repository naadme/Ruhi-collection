// Pricing helpers shared by the cart, checkout and order confirmation.
//
// Delivery is FREE on every order — there is no threshold and no delivery
// charge. This MUST stay in sync with `public.set_order_totals()` in
// supabase/migrations/20261006090000_free_shipping_for_all_orders.sql — the
// database is authoritative for what a customer is actually charged; these
// values only drive what the shopper sees before they submit the order.

/** Delivery charge on an order. Free for all products, so always 0. */
export const SHIPPING_FEE = 0

/** Shipping charge — always 0, because delivery is free on every order. */
export const shippingFor = () => SHIPPING_FEE

/** Grand total for a given subtotal. */
export const totalFor = (subtotal) => subtotal + shippingFor()

/** Indian digit grouping — ₹1,198 / ₹1,20,000. */
export const inr = (value) =>
  `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`
