-- Ruhi Collection — free shipping for all products.
--
-- Business requirement: delivery is FREE on every order, with no minimum
-- spend and no flat delivery charge. This replaces only the *shipping* half
-- of the rule in 20260928181500_orders_and_checkout.sql ("free over ₹999,
-- otherwise a flat ₹79"); no existing migration file is edited.
--
-- Design notes
--  * `public.set_order_totals()` is redefined with `create or replace`. The
--    signature is unchanged, so PostgreSQL keeps the function's OID and the
--    existing `order_items_set_totals` trigger keeps pointing at it — the
--    trigger does not have to be recreated.
--  * `orders.shipping` is now always 0 and `orders.total` is always
--    `orders.subtotal`, so the existing `orders_totals_chk`
--    (`total = subtotal + shipping`) still holds, and the column's
--    `shipping >= 0` check still holds.
--  * Nothing here touches product prices, order items, RLS, payment methods
--    or `create_order()`. The amount Razorpay is asked to collect is
--    `orders.total * 100`, derived from this function by
--    `create-razorpay-order`, so the gateway, the storefront and the stored
--    order all agree on the same number.
--  * Existing rows are deliberately left alone: already-paid orders keep the
--    total that was actually charged. An unfinished online checkout is
--    re-priced automatically the next time `create_order()` replaces its
--    line items, because the trigger recomputes from `order_items` and
--    `resolveRazorpayOrder()` mints a fresh gateway order when the amount
--    changes.
--  * Keep in sync with src/lib/pricing.js.

create or replace function public.set_order_totals() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order uuid;
  v_sub   integer;
begin
  v_order := coalesce(new.order_id, old.order_id);
  if v_order is null then
    return coalesce(new, old);
  end if;

  select coalesce(sum(qty * unit_price), 0) into v_sub
  from public.order_items where order_id = v_order;

  -- Free shipping for all products: no threshold, no flat fee.
  update public.orders
  set subtotal   = v_sub,
      shipping   = 0,
      total      = v_sub,
      updated_at = now()
  where id = v_order;

  return coalesce(new, old);
end $$;
