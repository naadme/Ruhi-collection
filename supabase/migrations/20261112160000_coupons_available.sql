-- Checkout shows "Have a coupon?" only while at least one coupon is live, so
-- shoppers aren't sent off hunting for codes that don't exist (owner's
-- decision, 12 Nov 2026).
--
-- Shoppers cannot read public.coupons (admins only). This answers yes or no
-- and nothing else: no code, value, count or date leaves the table. "Live"
-- uses the same tests as public.validate_coupon(): switched on and inside its
-- start and end dates. The minimum order is left out on purpose, since a
-- shopper may still add to the cart.

create or replace function public.coupons_available()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.coupons c
    where c.is_active
      and (c.starts_at is null or c.starts_at <= now())
      and (c.ends_at   is null or c.ends_at   >  now())
  );
$$;

revoke all on function public.coupons_available() from public, anon, authenticated, service_role;
grant execute on function public.coupons_available() to anon, authenticated;
