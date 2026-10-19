-- Ruhi Collection — one order-confirmation email per order, ever.
--
-- When a Razorpay payment is verified the store now emails the customer their
-- confirmation. Verification can happen TWICE for the same payment — the
-- browser calls `verify-razorpay-payment` and Razorpay's server calls
-- `razorpay-webhook` — and either can be retried. Without a guard the
-- customer would receive the same confirmation two or three times.
--
-- `orders.confirmation_sent_at` is that guard. It is claimed with a single
-- compare-and-set:
--
--     update orders set confirmation_sent_at = now()
--      where id = ... and payment_status = 'paid'
--        and confirmation_sent_at is null
--   returning id;
--
-- Postgres serialises concurrent updates on the same row, so exactly one
-- caller ever gets a row back, and only that caller sends the email. Every
-- later retry (or webhook redelivery) matches no rows and sends nothing.
--
-- The column starts NULL for all 19 existing orders, so nothing that is
-- already on file is touched and no email is retroactively invented for
-- orders placed before this migration.
--
-- It joins the payment fields the browser may never write: an `authenticated`
-- session could otherwise stamp an order as "already confirmed" and quietly
-- suppress a customer's email.

begin;

alter table public.orders
  add column if not exists confirmation_sent_at timestamptz;

-- Same function, one more guarded column. Written with CREATE OR REPLACE, so
-- an already-applied run is a no-op rather than a second definition.
create or replace function public.protect_order_payment_fields()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user in ('anon', 'authenticated') then
    if new.payment_status        is distinct from old.payment_status
       or new.razorpay_order_id  is distinct from old.razorpay_order_id
       or new.razorpay_payment_id is distinct from old.razorpay_payment_id
       or new.paid_at            is distinct from old.paid_at
       or new.payment_method     is distinct from old.payment_method
       or new.confirmation_sent_at is distinct from old.confirmation_sent_at then
      raise exception 'Payment details can only be changed by the payment service.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $function$;

commit;

-- ---------------------------------------------------------------------------
-- To revert:
--
--   begin;
--   create or replace function public.protect_order_payment_fields()
--   returns trigger language plpgsql set search_path to 'public', 'pg_temp'
--   as $$
--   begin
--     if current_user in ('anon', 'authenticated') then
--       if new.payment_status        is distinct from old.payment_status
--          or new.razorpay_order_id  is distinct from old.razorpay_order_id
--          or new.razorpay_payment_id is distinct from old.razorpay_payment_id
--          or new.paid_at            is distinct from old.paid_at
--          or new.payment_method     is distinct from old.payment_method then
--         raise exception 'Payment details can only be changed by the payment service.'
--           using errcode = '42501';
--       end if;
--     end if;
--     return new;
--   end $$;
--   alter table public.orders drop column if exists confirmation_sent_at;
--   commit;
--
-- Email sending stops immediately; no order row is lost.
-- ---------------------------------------------------------------------------
