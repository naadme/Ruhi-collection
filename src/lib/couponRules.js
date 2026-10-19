// The pure (network-free) half of the coupon system: code formatting and the
// discount rule mirrored from
// supabase/migrations/20261019120100_coupons_and_order_discounts.sql.
//
// It lives apart from `coupons.js` so the rule can be unit-tested in plain
// Node without pulling in the Supabase client. Nothing here is authoritative:
// `create_order()` in the database recomputes every discount itself.

import { totalFor } from './pricing.js'

/** A coupon code as the store stores it: trimmed, upper-case. */
export const normalizeCode = (v) => String(v ?? '').trim().toUpperCase()

/** The discount a VALIDATED coupon gives on a subtotal — the same rule the
 *  database applies: percent → floor(subtotal × value / 100), fixed → the
 *  value in rupees, both clamped to [0, subtotal] so a total can never go
 *  negative. Display only; the order is priced by the server. */
export function discountFor(coupon, subtotal) {
  if (!coupon || coupon.valid === false) return 0
  const sub = Math.max(0, Math.round(Number(subtotal) || 0))
  const value = Math.max(0, Number(coupon.value) || 0)
  const raw = coupon.kind === 'percent' ? Math.floor((sub * value) / 100) : value
  return Math.min(Math.max(0, raw), sub)
}

/**
 * Does the money the server priced match the discount the shopper can SEE?
 *
 * The checkout shows a discount the moment `validate_coupon()` approves a
 * code, but the amount is decided later and elsewhere — inside
 * `create_order()`, then handed back by `create-razorpay-order`. Those two
 * can disagree: the shopper's browser validated a code the order did not end
 * up carrying (a function build older than the coupon migration, a code that
 * stopped being eligible between the check and the click, a cart repriced in
 * between). If that ever happened, the page would promise a total the payment
 * window never charges — a customer shown ₹1,000 and asked for ₹1,500.
 *
 * So this answers one narrow question: *is a discount on screen that the
 * server did not price?* It returns `false` only in that case, and Checkout
 * then drops the coupon BEFORE the payment window opens, making the page and
 * the gateway agree on one number.
 *
 * Two rules keep it from ever being wrong in the safe direction:
 *   * With nothing discounted on screen it is always `true`, so a store that
 *     does not use coupons cannot be affected by it at all.
 *   * It only ever removes a discount the shopper was about to be shown — it
 *     can never add one the database did not compute, so it can never make the
 *     displayed total lower than the amount actually charged.
 *
 * `server` is the answer from `create-razorpay-order`. A current build echoes
 * the discount `create_order()` computed, which is compared exactly. An older
 * build never does — but every build has always returned `total`, so the check
 * falls back to comparing totals instead.
 */
export function serverHonoursCoupon(coupon, subtotal, server) {
  const shown = coupon ? discountFor(coupon, subtotal) : 0
  if (shown <= 0) return true

  const priced = Number(server?.discount)
  if (Number.isFinite(priced)) return priced === shown

  const actual = Number(server?.total)
  return Number.isFinite(actual) && actual === totalFor(subtotal, shown)
}
