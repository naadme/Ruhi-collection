-- Ruhi Collection — checkout integrity guards
--
-- Two additive, non-destructive corrections found in the final audit. Neither
-- touches product prices, existing orders, order items, RLS or payment flow,
-- and both were verified against live data before this file was written.
--
-- Nothing here is destructive: there is no DROP TABLE, TRUNCATE, DELETE or
-- UPDATE of any row. Constraint validation is instantaneous because
-- `public.coupons` held 0 rows when this was written (verified live).
--
--
-- 1. Close `public.recalc_order_totals(uuid)` to the untrusted roles.
--
--    The function recomputes `subtotal`, `shipping` and `total` for an
--    arbitrary order id. It was executable by `anon` — proven with
--    `has_function_privilege('anon', 'public.recalc_order_totals(uuid)',
--    'EXECUTE')`, which returned true — so an unauthenticated caller could
--    re-price any order. Nothing in `src/` or `supabase/functions/` calls it
--    as an RPC (the only references are a code comment and a test asserting
--    the SQL text), so the grant was pure attack surface with no caller.
--
--    Revoking it cannot break checkout. `create_order(json)` is SECURITY
--    DEFINER, so while it executes the current role is its owner and the
--    owner's own EXECUTE rights are untouched by revoking PUBLIC / anon /
--    authenticated. `service_role` is deliberately left alone: it is a
--    server-only role that is not reachable from a browser, so it is not part
--    of the hole.
--
--
-- 2. Refuse a 100% coupon.
--
--    `20261006090000_free_shipping_for_all_orders.sql` made shipping always 0,
--    so `orders.total = subtotal - discount` (`orders_totals_chk`). A percent
--    coupon of 100 therefore drives the total to ₹0, and
--    `create-razorpay-order` refuses any amount below ₹1 — but only AFTER
--    `create_order()` has already inserted the order row. The result is a
--    permanently "pending" order that can be neither charged nor cleared, and
--    a shopper who is shown a discount and then cannot complete checkout.
--
--    DOCUMENTED DECISION (this is a business-rule change, stated plainly):
--    percent coupons are capped at 99 rather than 100. `public.coupons` held
--    0 rows when this was applied, so no existing coupon is invalidated and
--    no customer is affected. 99% remains a genuine giveaway discount — with
--    the cheapest active product at ₹479 it leaves ₹5 payable, which Razorpay
--    accepts (its floor is ₹1). The same cap is enforced in
--    `src/admin/CouponsPanel.jsx` so the owner gets a readable explanation
--    instead of a database error; this constraint makes it impossible to
--    create such a coupon at any layer — panel, script or direct SQL.
--
--    Raise this cap only alongside real support for a ₹0 checkout (an order
--    that can complete without a gateway charge).


-- ---------------------------------------------------------------------------
-- 1. recalc_order_totals: no browser-facing role may execute it.
-- ---------------------------------------------------------------------------

revoke execute on function public.recalc_order_totals(uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. coupons: percent must be 1..99 (was 1..100), fixed unchanged.
-- ---------------------------------------------------------------------------

alter table public.coupons drop constraint if exists coupons_check;

alter table public.coupons add constraint coupons_check
  check (
    (kind = 'percent' and value between 1 and 99)
    or (kind = 'fixed' and value between 1 and 1000000)
  );
