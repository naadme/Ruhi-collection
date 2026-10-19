// The pure (network-free) half of the coupon system: code formatting and the
// discount rule mirrored from
// supabase/migrations/20261019120100_coupons_and_order_discounts.sql.
//
// It lives apart from `coupons.js` so the rule can be unit-tested in plain
// Node without pulling in the Supabase client. Nothing here is authoritative:
// `create_order()` in the database recomputes every discount itself.

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
