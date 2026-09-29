-- Rohi Collection — Razorpay online payments on top of the existing
-- checkout / order architecture.
--
-- Design notes
--  * Nothing about cash on delivery changes. `create_order()` still creates
--    every order, still prices it from `public.products`, and the
--    `order_items_set_totals()` trigger still owns subtotal / shipping /
--    total. This migration only widens what `create_order()` accepts and adds
--    payment bookkeeping to the rows it already writes.
--  * The browser is never authoritative for money. The amount sent to Razorpay
--    is `orders.total * 100`, and `orders.total` is computed by the database
--    from `public.products`.
--  * Nothing on the public internet can mark an order paid: `payment_status`
--    is written only by the Edge Functions (service role) after a Razorpay
--    signature check, or by a signature-verified webhook. A trigger refuses
--    the change for `anon` and `authenticated`, so even an admin cannot flip
--    it through the Data API.
--  * The Razorpay Key Secret lives only in Edge Function secrets
--    (`supabase secrets set`). Nothing in this repository contains it.
--  * Nothing here touches `newsletter_subscribers` or `contact_messages`.

-- ---------------------------------------------------------------------------
-- 1. Payment columns
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists payment_status      text,
  add column if not exists razorpay_order_id   text,
  add column if not exists razorpay_payment_id text,
  add column if not exists paid_at             timestamptz;

update public.orders set payment_status = 'pending' where payment_status is null;

alter table public.orders alter column payment_status set default 'pending';
alter table public.orders alter column payment_status set not null;

-- 'upi' / 'card' were placeholders for a gateway that was never connected.
-- Razorpay is now the single online method, so the column is explicit.
alter table public.orders drop constraint if exists orders_payment_chk;
alter table public.orders add constraint orders_payment_chk
  check (payment_method in ('cod', 'razorpay'));

alter table public.orders drop constraint if exists orders_payment_status_chk;
alter table public.orders add constraint orders_payment_status_chk
  check (payment_status in ('pending', 'paid', 'failed', 'refunded'));

-- A refund keeps paid_at (the money was taken, then returned), so only the
-- transition into 'paid' is gated.
alter table public.orders drop constraint if exists orders_payment_state_chk;
alter table public.orders add constraint orders_payment_state_chk
  check ((payment_status <> 'paid' or paid_at is not null)
         and (razorpay_payment_id is null or razorpay_order_id is not null));

create index if not exists orders_payment_status_idx on public.orders (payment_status);

-- One Razorpay order maps to at most one of our orders, so a webhook or a
-- verification callback can never be applied to the wrong row.
create unique index if not exists orders_razorpay_order_idx
  on public.orders (razorpay_order_id)
  where razorpay_order_id is not null;

-- At most one unfinished online checkout per email. This is what makes two
-- simultaneous "Pay" clicks converge on a single application order instead of
-- creating duplicates; `create_order()` catches the conflict and joins the
-- winning row.
create unique index if not exists orders_open_online_order_idx
  on public.orders (lower(email))
  where payment_method = 'razorpay'
    and payment_status = 'pending'
    and status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. Payment fields may only be written by the payment server
-- ---------------------------------------------------------------------------
-- Deliberately NOT `security definer`: `current_user` must keep reflecting the
-- caller. The service role (Edge Functions / webhooks) passes, `anon` and
-- `authenticated` are refused — including the admin dashboard, which only ever
-- changes the fulfilment `status`. `create_order()` runs as the function owner,
-- so it is unaffected.
create or replace function public.protect_order_payment_fields() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.payment_status      is distinct from old.payment_status
       or new.razorpay_order_id  is distinct from old.razorpay_order_id
       or new.razorpay_payment_id is distinct from old.razorpay_payment_id
       or new.paid_at            is distinct from old.paid_at
       or new.payment_method     is distinct from old.payment_method then
      raise exception 'Payment details can only be changed by the payment service.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists orders_protect_payment_fields on public.orders;
create trigger orders_protect_payment_fields
before update on public.orders
for each row execute function public.protect_order_payment_fields();

-- ---------------------------------------------------------------------------
-- 3. Webhook idempotency ledger (service role only)
-- ---------------------------------------------------------------------------
-- RLS is enabled with no policies on purpose: only the webhook Edge Function
-- (service role) can read or write it, so a replayed Razorpay event is a no-op.
create table if not exists public.razorpay_webhook_events (
  event_id   text primary key,
  event_type text,
  received_at timestamptz not null default now()
);

alter table public.razorpay_webhook_events enable row level security;
revoke all on table public.razorpay_webhook_events from anon, authenticated;
grant  all on table public.razorpay_webhook_events to service_role;

-- ---------------------------------------------------------------------------
-- 4. create_order() — widened for online payment
-- ---------------------------------------------------------------------------
-- Changes vs. the previous version:
--   * `payment_method` may be 'cod' or 'razorpay' (anything else is refused).
--   * An unfinished online checkout for the same email is *reused* instead of
--     duplicated, so retrying a failed payment never piles up orders.
--   * The 5-minute double-submit guard now ignores unfinished online orders,
--     otherwise an abandoned Razorpay attempt would block a legitimate COD
--     order a moment later.
--   * Prices, sizes, quantities, address checks and the totals trigger are
--     untouched.
create or replace function public.create_order(payload json)
returns json
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_items    jsonb := coalesce((payload -> 'items')::jsonb, '[]'::jsonb);
  v_email    text  := coalesce(payload ->> 'email', '');
  v_name     text  := coalesce(payload ->> 'full_name', '');
  v_phone    text  := coalesce(payload ->> 'phone', '');
  v_address  text  := coalesce(payload ->> 'address', '');
  v_city     text  := coalesce(payload ->> 'city', '');
  v_state    text  := coalesce(payload ->> 'state', '');
  v_pincode  text  := coalesce(payload ->> 'pincode', '');
  v_note     text  := nullif(coalesce(payload ->> 'note', ''), '');
  v_pay      text  := coalesce(nullif(payload ->> 'payment_method', ''), 'cod');
  v_uid      uuid  := (select auth.uid());
  v_order    public.orders%rowtype;
  v_reuse    public.orders%rowtype;
  v_reused   boolean := false;
  v_item     jsonb;
  v_product  public.products%rowtype;
  v_pid      text;
  v_size     text;
  v_qty      integer;
  v_lines    jsonb := '[]'::jsonb;
begin
  -- ---- cart -------------------------------------------------------------
  if jsonb_typeof(v_items) is distinct from 'array'
     or jsonb_array_length(v_items) < 1
     or jsonb_array_length(v_items) > 20 then
    raise exception 'Your cart is empty. Add a product before checking out.';
  end if;

  -- ---- delivery details -------------------------------------------------
  if char_length(btrim(v_name)) < 2 then
    raise exception 'Please enter your full name.';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 200 then
    raise exception 'Please enter a valid email address.';
  end if;
  if char_length(btrim(v_phone)) < 8 then
    raise exception 'Please enter your phone number.';
  end if;
  if char_length(btrim(v_address)) < 5 then
    raise exception 'Please enter your street address.';
  end if;
  if char_length(btrim(v_city)) < 2 then
    raise exception 'Please enter your city.';
  end if;
  if char_length(btrim(v_state)) < 2 then
    raise exception 'Please enter your state.';
  end if;
  if v_pincode !~ '^[1-9][0-9]{5}$' then
    raise exception 'Please enter a valid 6-digit PIN code.';
  end if;

  -- ---- payment method ---------------------------------------------------
  if v_pay not in ('cod', 'razorpay') then
    raise exception 'Please choose cash on delivery or online payment.';
  end if;

  -- ---- reuse an unfinished online checkout -------------------------------
  -- A shopper who closes Razorpay (or fails twice) retries within minutes.
  -- Replaying their own open order keeps exactly one row per attempt instead
  -- of one row per click. Paid orders are never eligible.
  if v_pay = 'razorpay' then
    select * into v_reuse
    from public.orders o
    where lower(o.email) = lower(v_email)
      and o.payment_method = 'razorpay'
      and o.payment_status <> 'paid'
      and o.status = 'pending'
      and (o.user_id is null or o.user_id = v_uid)
      and o.created_at > now() - interval '30 minutes'
    order by (o.payment_status = 'failed'), o.created_at desc
    limit 1
    for update;

    if found then
      v_reused := true;
      update public.orders
      set full_name      = btrim(v_name),
          phone          = btrim(v_phone),
          address        = btrim(v_address),
          city           = btrim(v_city),
          state          = btrim(v_state),
          pincode        = btrim(v_pincode),
          note           = v_note,
          user_id        = coalesce(v_uid, user_id),
          payment_status = 'pending',
          paid_at        = null,
          updated_at     = now()
      where id = v_reuse.id
      returning * into v_order;

      delete from public.order_items where order_id = v_order.id;
    end if;
  end if;

  -- ---- simple double-submit / abuse guard --------------------------------
  -- Unfinished online checkouts are excluded: they are not orders yet, and
  -- they must not stop the same shopper from retrying or switching to COD.
  if not v_reused and exists (
    select 1 from public.orders o
    where lower(o.email) = lower(v_email)
      and o.created_at > now() - interval '5 minutes'
      and not (o.payment_method = 'razorpay'
               and o.payment_status <> 'paid'
               and o.status = 'pending')
  ) then
    raise exception 'We already received a recent order for this email. Please wait a few minutes before placing another.';
  end if;

  -- ---- create (or join a just-created) order ------------------------------
  if not v_reused then
    begin
      insert into public.orders (
        reference, user_id, full_name, email, phone,
        address, city, state, pincode, note, payment_method
      ) values (
        'RCH-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
        v_uid,
        btrim(v_name), lower(btrim(v_email)), btrim(v_phone),
        btrim(v_address), btrim(v_city), btrim(v_state), btrim(v_pincode), v_note, v_pay
      ) returning * into v_order;
    exception when unique_violation then
      -- Two "Pay" clicks landed in the same instant: join the order the other
      -- request created rather than writing a second one.
      select * into v_order
      from public.orders o
      where lower(o.email) = lower(v_email)
        and o.payment_method = 'razorpay'
        and o.payment_status <> 'paid'
        and o.status = 'pending'
      order by o.created_at desc
      limit 1
      for update;

      if not found then
        raise exception 'We could not start your order. Please try again.';
      end if;

      update public.orders
      set full_name      = btrim(v_name),
          phone          = btrim(v_phone),
          address        = btrim(v_address),
          city           = btrim(v_city),
          state          = btrim(v_state),
          pincode        = btrim(v_pincode),
          note           = v_note,
          user_id        = coalesce(v_uid, user_id),
          payment_status = 'pending',
          paid_at        = null,
          updated_at     = now()
      where id = v_order.id
      returning * into v_order;

      delete from public.order_items where order_id = v_order.id;
      v_reused := true;
    end;
  end if;

  -- ---- line items: prices come from the catalogue, never the client ------
  for v_item in select value from jsonb_array_elements(v_items) loop
    v_pid  := nullif(btrim(v_item ->> 'product_id'), '');
    v_size := nullif(btrim(v_item ->> 'size'), '');

    if v_pid is null or v_size is null then
      raise exception 'Some items in your cart are incomplete. Refresh the page and try again.';
    end if;

    begin
      v_qty := (v_item ->> 'qty')::integer;
    exception when others then
      raise exception 'Invalid quantity in your cart.';
    end;

    if v_qty is null or v_qty < 1 or v_qty > 10 then
      raise exception 'Quantity must be between 1 and 10 for every item.';
    end if;

    select * into v_product
    from public.products p
    where p.id = v_pid and p.is_active;

    if not found then
      raise exception 'An item in your cart is no longer available and was not ordered.';
    end if;

    if not (v_size = any (v_product.sizes)) then
      raise exception 'Size % is not available for %.', v_size, v_product.title;
    end if;

    insert into public.order_items (order_id, product_id, title, image, size, qty, unit_price)
    values (v_order.id, v_product.id, v_product.title, v_product.image, v_size, v_qty, v_product.price);

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'title',      v_product.title,
      'image',      v_product.image,
      'size',       v_size,
      'qty',        v_qty,
      'unit_price', v_product.price
    ));
  end loop;

  -- The `order_items_set_totals` trigger has already priced the order.
  select * into v_order from public.orders where id = v_order.id;

  return json_build_object(
    'id',              v_order.id,
    'reference',       v_order.reference,
    'status',          v_order.status,
    'subtotal',        v_order.subtotal,
    'shipping',        v_order.shipping,
    'total',           v_order.total,
    'payment_method',  v_order.payment_method,
    'payment_status',  v_order.payment_status,
    'razorpay_order_id', v_order.razorpay_order_id,
    'email',           v_order.email,
    'created_at',      v_order.created_at,
    'reused',          v_reused,
    'items',           v_lines
  );
end $$;

-- Callable by shoppers (signed in or not) and by nobody else — unchanged.
revoke all on function public.create_order(json) from public, anon, authenticated, service_role;
grant execute on function public.create_order(json) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Service-role access for the payment Edge Functions
-- ---------------------------------------------------------------------------
grant update on table public.orders to service_role;
