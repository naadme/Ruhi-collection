-- Ruhi Collection — announcing an order: the customer's confirmation, the
-- owner's new-order notification, and the database trigger that starts both.
--
-- Design notes
--
--  * `create_order()` still creates every order and still prices it from
--    `public.products`. Nothing here changes how an order is made, what it
--    costs or who may write it.
--
--  * Two markers, one per recipient. `orders.confirmation_sent_at` already
--    existed; `orders.owner_notified_at` is added here. Each is claimed with
--    a single compare-and-set, so the customer's browser and Razorpay's
--    webhook — which routinely arrive within milliseconds of each other, and
--    either of which can be retried — produce exactly one mail each.
--
--  * The trigger is DEFERRED. `create_order()` inserts the order row first
--    and its line items afterwards, so a trigger that fired on the insert
--    would see an order with no products in it. A constraint trigger that is
--    `deferrable initially deferred` fires at COMMIT, by which time the
--    lines are on file and the totals are final.
--
--  * Only two kinds of order are announced: a cash-on-delivery order the
--    moment it is placed, and an online order the moment the gateway settles
--    it. An abandoned checkout is never announced, because it is not an
--    order yet.
--
--  * The trigger talks to the `order-notifications` Edge Function over
--    `pg_net`, using the URL and the shared secret kept in the database's
--    own vault. Neither is in this file, and neither is a secret this
--    repository knows: the URL is not sensitive, and the secret is set with
--    `supabase secrets set ORDER_NOTIFICATIONS_SECRET=...` and kept in the
--    vault beside it.
--
--  * A mail announcement must never cost the shop an order. Everything the
--    trigger does is wrapped so that a missing vault entry, an unreachable
--    network or a refused request leaves the order exactly as it was.

begin;

-- ---------------------------------------------------------------------------
-- 1. The owner's marker
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists owner_notified_at timestamptz;

-- Same function, one more guarded column. Written with CREATE OR REPLACE, so
-- an already-applied run is a no-op rather than a second definition.
--
-- The marker joins the payment fields the browser may never write: an
-- `authenticated` session could otherwise stamp an order as "already
-- notified" and quietly suppress the owner's mail — and an order that is
-- never announced is an order nobody packs.
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
       or new.owner_notified_at  is distinct from old.owner_notified_at then
      raise exception 'Payment details can only be changed by the payment service.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $function$;

-- ---------------------------------------------------------------------------
-- 2. The HTTP client the trigger uses
-- ---------------------------------------------------------------------------
-- `pg_net` is a Supabase extension and is available on every plan, including
-- the free one. It is what lets the database call the Edge Function that
-- sends the mail; nothing else about the shop's setup changes.
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- 3. The trigger that announces an order
-- ---------------------------------------------------------------------------
-- `security definer`, so the vault can be read whoever changed the row: the
-- order is created by `create_order()` (which runs as its owner), settled by
-- the payment functions (which run as the service role), and edited by the
-- admin panel (which runs as an `authenticated` customer). Only the order
-- that may be announced is ever announced, and only the announcement is ever
-- attempted — the trigger never changes an order.
create or replace function public.announce_order_to_store()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'net', 'extensions', 'pg_temp'
as $function$
declare
  v_url    text;
  v_secret text;
begin
  -- ---- is this order ready to be announced? ------------------------------
  if tg_op = 'INSERT' then
    -- A cash-on-delivery order is real the moment it is placed: the money is
    -- collected on arrival, so there is nothing to wait for. An online order
    -- is not — it is announced when the gateway settles it below.
    if new.payment_method is distinct from 'cod' then
      return null;
    end if;
    if new.payment_status = 'paid' then
      return null;
    end if;
    if new.status = 'cancelled' then
      return null;
    end if;
  else
    -- Only the write that settles the payment counts. Every other update —
    -- the totals trigger, the admin panel changing the fulfilment status —
    -- leaves `payment_status` alone and is not an announcement.
    if new.payment_status is not distinct from old.payment_status then
      return null;
    end if;
    if new.payment_status is distinct from 'paid' then
      return null;
    end if;
  end if;

  -- ---- tell the mail function about it -----------------------------------
  -- Everything from here on is best-effort. A missing vault entry, an
  -- unreachable network or a refused request must leave the order exactly as
  -- it was: an announcement is worth nothing compared to the order itself.
  begin
    select decrypted_secret into v_url
    from vault.decrypted_secrets
    where name = 'order_notifications_url';

    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'order_notifications_secret';

    if v_url is null or v_secret is null then
      raise warning
        'order notifications are not configured: the vault holds no url/secret';
      return null;
    end if;

    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-order-notifications-secret', v_secret
                 ),
      body    := jsonb_build_object(
                   'order_id', new.id::text,
                   'source', 'order-trigger'
                 )
    );
  exception when others then
    raise warning 'could not queue the order notification: %', sqlerrm;
  end;

  return null;
end $function$;

drop trigger if exists orders_announce on public.orders;

-- Deferred, so it fires at COMMIT — after `create_order()` has inserted the
-- order lines and the totals are final. A trigger that fired on the insert
-- would announce an order with no products in it.
create constraint trigger orders_announce
  after insert or update on public.orders
  deferrable initially deferred
  for each row
  execute function public.announce_order_to_store();

commit;

-- ---------------------------------------------------------------------------
-- To revert:
--
--   begin;
--   drop trigger if exists orders_announce on public.orders;
--   drop function if exists public.announce_order_to_store();
--   create or replace function public.protect_order_payment_fields()
--   returns trigger language plpgsql set search_path = 'public', 'pg_temp'
--   as $$
--   begin
--     if current_user in ('anon', 'authenticated') then
--       if new.payment_status        is distinct from old.payment_status
--          or new.razorpay_order_id  is distinct from old.razorpay_order_id
--          or new.razorpay_payment_id is distinct from old.razorpay_payment_id
--          or new.paid_at            is distinct from old.paid_at
--          or new.payment_method     is distinct from old.payment_method
--          or new.confirmation_sent_at is distinct from old.confirmation_sent_at then
--         raise exception 'Payment details can only be changed by the payment service.'
--           using errcode = '42501';
--       end if;
--     end if;
--     return new;
--   end $$;
--   alter table public.orders drop column if exists owner_notified_at;
--   commit;
--
-- The mails stop; no order row is lost and no order is deleted.
-- ---------------------------------------------------------------------------
