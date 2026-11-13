-- Ruhi Collection — the A/B tests each order was placed in (13 Nov 2026).
--
-- The shop splits visitors between versions of a change in the browser
-- (src/lib/experiments.js). GA4 counts what each version's visitors did on the
-- way (size picks, add-to-carts, checkouts); the order itself keeps which
-- versions its shopper saw, so paid orders and revenue per version come from
-- this database, the only complete record of real sales.
--
--   experiments  { "<test id>": "<version>" }, for example {"aa_check": "b"}.
--                Written once by `create-razorpay-order` as the order is
--                created, from what checkout sends, after checking its shape
--                (supabase/functions/_shared/experiments.mjs). NULL when the
--                shopper was in no test, and for every order before today.
--
-- Like the ad details, only the payment server writes it: a browser (an admin
-- session included) that tries to change it is refused, so a result can't be
-- edited by hand after the fact. Browsers cannot insert orders at all.
--
-- The guard is a trigger of its own rather than one more line in
-- protect_order_payment_fields(): another change in progress (order alerts,
-- 20261112100000) rewrites that function too, and whichever of two rewrites
-- ran last would quietly drop the other's lines. Separate, the two can land
-- in either order.
--
-- Nothing existing is changed or rewritten.

begin;

alter table public.orders
  add column if not exists experiments jsonb;

-- An object of at most four short entries (four tests can run at once).
alter table public.orders drop constraint if exists orders_experiments_chk;
alter table public.orders
  add constraint orders_experiments_chk
  check (experiments is null or (jsonb_typeof(experiments) = 'object' and octet_length(experiments::text) <= 200));

create or replace function public.protect_order_experiments()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $function$
begin
  if current_user in ('anon', 'authenticated')
     and new.experiments is distinct from old.experiments then
    raise exception 'A/B test details can only be written by the payment service.'
      using errcode = '42501';
  end if;
  return new;
end $function$;

drop trigger if exists orders_protect_experiments on public.orders;
create trigger orders_protect_experiments
before update of experiments on public.orders
for each row execute function public.protect_order_experiments();

commit;
