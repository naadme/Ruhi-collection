// Coupon codes at checkout — the browser half of
// supabase/migrations/20261019120100_coupons_and_order_discounts.sql.
//
// Nothing here is authoritative. `validateCoupon()` asks the DATABASE to
// check one code against one subtotal (the SECURITY DEFINER RPC
// `public.validate_coupon`, granted to shoppers), and `discountFor()` only
// mirrors the database rule so the shopper sees the discount instantly. When
// the order is placed, `public.create_order()` re-validates the code and
// recomputes the discount itself — a tampered browser cannot change what is
// charged.

import { supabase } from './supabase.js'
import { normalizeCode, discountFor } from './couponRules.js'

// Pure helpers live in `couponRules.js` (so tests can import them without the
// Supabase client) and are re-exported here for every existing caller.
export { normalizeCode, discountFor }

/**
 * Ask the database whether a coupon is valid for this subtotal.
 *
 * Resolves to the RPC's own answer — `{ valid, code, kind, value, discount,
 * message }` — or throws a message safe to show the shopper when the check
 * itself failed (network, endpoint). The discount in the answer comes from
 * the database, not from this file.
 */
export async function validateCoupon(code, subtotal) {
  const normalized = normalizeCode(code)
  if (!normalized) return { valid: false, message: 'Please enter a coupon code.' }
  const { data, error } = await supabase.rpc('validate_coupon', {
    p_code: normalized,
    p_subtotal: Math.max(0, Math.round(Number(subtotal) || 0)),
  })
  if (error) throw new Error('We could not check that coupon code. Please try again.')
  return { ...data, code: normalized }
}
