-- Ruhi Collection — what the tracking brief needs every order to remember.
--
-- The website's tracking (GTM, GA4, Google Ads, Meta) already reads the
-- shopper's journey in the browser. Four things only the order itself can
-- hold, so they are added here:
--
--   1. Where the shopper came from (brief Section 4, step 4). The latest ad
--      visit's UTM tags, each ad network's click ID and the landing page, as
--      the browser kept them in its 90-day `ruhi_ad` cookie. They are written
--      by `create-razorpay-order` as the order is created, before the shopper
--      leaves for the payment window, so the owner can later report real,
--      delivered sales back to Google and Meta. Every value is stored exactly
--      as received; a missing value stays NULL, never "undefined".
--
--   2. How the order was paid (`payment_type`). Razorpay's own name for the
--      method — upi, card, netbanking, wallet, emi, paylater … — asked of
--      Razorpay by `verify-razorpay-payment` and `razorpay-webhook` once the
--      payment is proven. The purchase event passes it on only when it is one
--      of the brief's values.
--
--   3. Whether this is the customer's first order (`new_customer`), decided
--      by the database the moment the order becomes real — paid online, or
--      placed as cash on delivery — against every earlier real order with the
--      same email address or the same phone number. Test orders never count.
--
--   4. Test orders (`is_test`, rule 10). An admin can pay with Razorpay's
--      test keys: no money moves, and the order is marked so reports can
--      leave it out. Admins may also mark or unmark an order by hand.
--
-- And one status (Section 4: "keep the order status up to date — delivered,
-- cancelled, returned"): `returned`, next to the five the shop already had.
--
-- Payment-side fields stay where the payment server alone can write them:
-- browsers — admin sessions included — are refused by
-- `protect_order_payment_fields()`, exactly as for `payment_status`.
--
-- Nothing existing is changed or rewritten: every new column is NULL (or
-- false) for the orders already on file, and the website keeps working with
-- or without the functions that fill them.

begin;

-- ---------------------------------------------------------------------------
-- 1–4. The columns
-- ---------------------------------------------------------------------------
-- Plain `text`: long Meta and Google click IDs are kept whole. The functions
-- that write them refuse anything over 500 characters (2,000 for the landing
-- page), the brief's own sizes.
alter table public.orders
  add column if not exists utm_source   text,
  add column if not exists utm_medium   text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content  text,
  add column if not exists utm_term     text,
  add column if not exists gclid        text,
  add column if not exists gbraid       text,
  add column if not exists wbraid       text,
  add column if not exists fbc          text,
  add column if not exists fbp          text,
  add column if not exists landing_page text,
  add column if not exists landing_time timestamptz,
  add column if not exists payment_type text,
  add column if not exists new_customer boolean,
  add column if not exists is_test      boolean not null default false;

-- ---------------------------------------------------------------------------
-- 5. `returned`
-- ---------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_status_chk;
alter table public.orders
  add constraint orders_status_chk
  check (status in ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'returned'));

-- ---------------------------------------------------------------------------
-- 6. Only the payment server writes the payment side of an order
-- ---------------------------------------------------------------------------
-- The function as 20261021160000_order_notifications.sql left it, plus the
-- new columns. `is_test` is deliberately NOT here: admins may correct it.
create or replace function public.protect_order_payment_fields()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $function$
begin
  if current_user in ('anon', 'authenticated') then
    if new.payment_status        is distinct from old.payment_status
       or new.razorpay_order_id  is distinct from old.razorpay_order_id
       or new.razorpay_payment_id is distinct from old.razorpay_payment_id
       or new.paid_at            is distinct from old.paid_at
       or new.payment_method     is distinct from old.payment_method
       or new.confirmation_sent_at is distinct from old.confirmation_sent_at
       or new.owner_notified_at  is distinct from old.owner_notified_at
       or new.payment_type       is distinct from old.payment_type
       or new.new_customer       is distinct from old.new_customer
       or new.utm_source         is distinct from old.utm_source
       or new.utm_medium         is distinct from old.utm_medium
       or new.utm_campaign       is distinct from old.utm_campaign
       or new.utm_content        is distinct from old.utm_content
       or new.utm_term           is distinct from old.utm_term
       or new.gclid              is distinct from old.gclid
       or new.gbraid             is distinct from old.gbraid
       or new.wbraid             is distinct from old.wbraid
       or new.fbc                is distinct from old.fbc
       or new.fbp                is distinct from old.fbp
       or new.landing_page       is distinct from old.landing_page
       or new.landing_time       is distinct from old.landing_time then
      raise exception 'Payment details can only be changed by the payment service.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $function$;

-- ---------------------------------------------------------------------------
-- 7. First order or not
-- ---------------------------------------------------------------------------
-- Decided once, when the order becomes real, and never again — a later
-- refund or cancellation does not change who the customer was that day.
-- Phone numbers are compared on their last ten digits, so "98765 43210" and
-- "+91 98765 43210" are the same person; emails ignore case.
create or replace function public.mark_new_customer()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_email text := lower(btrim(coalesce(new.email, '')));
  v_phone text := right(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), 10);
begin
  if new.new_customer is not null then
    return new;
  end if;
  if new.payment_status is distinct from 'paid' and new.payment_method is distinct from 'cod' then
    return new;
  end if;

  new.new_customer := not exists (
    select 1
      from public.orders o
     where o.id <> new.id
       and o.created_at < new.created_at
       and (o.payment_status = 'paid' or o.payment_method = 'cod')
       and not o.is_test
       and (
         (v_email <> '' and lower(btrim(o.email)) = v_email)
         or (length(v_phone) = 10
             and right(regexp_replace(coalesce(o.phone, ''), '\D', '', 'g'), 10) = v_phone)
       )
  );
  return new;
end $function$;

drop trigger if exists orders_mark_new_customer on public.orders;
create trigger orders_mark_new_customer
before insert or update of payment_status on public.orders
for each row execute function public.mark_new_customer();

commit;

-- ---------------------------------------------------------------------------
-- To revert:
--
--   begin;
--   drop trigger if exists orders_mark_new_customer on public.orders;
--   drop function if exists public.mark_new_customer();
--   -- then re-run section 1 of 20261021160000_order_notifications.sql to put
--   -- protect_order_payment_fields() back as it was;
--   alter table public.orders drop constraint if exists orders_status_chk;
--   alter table public.orders add constraint orders_status_chk
--     check (status in ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled'));
--   -- (only once no order is marked returned)
--   alter table public.orders
--     drop column if exists utm_source,   drop column if exists utm_medium,
--     drop column if exists utm_campaign, drop column if exists utm_content,
--     drop column if exists utm_term,     drop column if exists gclid,
--     drop column if exists gbraid,       drop column if exists wbraid,
--     drop column if exists fbc,          drop column if exists fbp,
--     drop column if exists landing_page, drop column if exists landing_time,
--     drop column if exists payment_type, drop column if exists new_customer,
--     drop column if exists is_test;
--   commit;
