-- Ruhi Collection — order IDs in the shop's own 8-digit format.
--
-- Every order now carries an ID of the form DDMMYYNN:
--
--   DD   the day of the month
--   MM   the month
--   YY   the last two digits of the year
--   NN   the order's number for that day, from 01
--
-- so 01102601 is the first order of the 1st of October 2026, and 01102602 is
-- the second. It is the same idea as the product IDs (CCPPCL): the number says
-- when the order was placed, and it is short enough to read over the phone.
--
-- WHAT CHANGES
--   * `orders.reference` — the customer-facing order ID, and the one in every
--     order URL, on the confirmation page, in the admin panel, in the Excel
--     download and in the Google Sheet — holds the 8-digit number.
--   * `orders.previous_reference` keeps the old "RCH-XXXXXXXX" value for every
--     order that had one, so the previous ID is never lost and the old link
--     still finds its order.
--   * `orders.id` — the internal primary key — is NOT touched, and neither is
--     `order_items.order_id`. Every order, payment reference, order item and
--     customer detail is preserved exactly as it was.
--
-- WHERE THE NUMBER COMES FROM
-- The database, in the shop's own time zone (Asia/Kolkata), from the order's
-- own created_at — so the ID always says the day the order was actually
-- placed. Two orders placed at the same moment can never be given the same
-- number: the day's number is allocated under a lock that is held until the
-- transaction ends, the number is read after the lock is taken, and the
-- unique index on `reference` has the final word.
--
-- AT 99 ORDERS IN A DAY the number is refused with a clear message, rather
-- than a duplicate or a malformed ID.
--
-- Additive and reversible: the old constraint, the old values and the
-- generator can all be put back.

-- ---------------------------------------------------------------------------
-- 1. The old ID, kept.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists previous_reference text;

comment on column public.orders.previous_reference is
  'The order ID this order had before the DDMMYYNN format (RCH-XXXXXXXX), kept so it is never lost.';

-- ---------------------------------------------------------------------------
-- 2. The constraint has to allow the new format before anything is written.
-- ---------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_reference_chk;
alter table public.orders
  add constraint orders_reference_chk check (reference ~ '^([0-9]{8}|RCH-[A-Z0-9]{8})$');

-- ---------------------------------------------------------------------------
-- 3. The number.
--
--    One number per order, per day, in the shop's time zone. The day's
--    numbers are allocated under an advisory lock, so two orders placed in
--    the same moment are given different numbers; the lock is held until the
--    transaction ends and the highest number already used is read after it
--    is taken, so the second order sees the first one.
-- ---------------------------------------------------------------------------
create or replace function public.next_order_reference(p_at timestamptz default null)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_at   timestamptz := coalesce(p_at, now());
  v_day  text;
  v_next integer;
begin
  -- The business day, in the shop's own time zone.
  v_day := to_char(v_at at time zone 'Asia/Kolkata', 'DDMMYY');

  -- One order at a time for that day.
  perform pg_advisory_xact_lock(hashtext('ruhi.collection.order_reference'), hashtext(v_day));

  -- Read AFTER the lock is held, so a concurrent order's number is already
  -- in the table by the time this one is counted.
  select coalesce(max(nullif(substr(reference, 7, 2), '')::integer), 0) + 1
    into v_next
    from public.orders
   where reference ~ ('^' || v_day || '[0-9]{2}$');

  if v_next > 99 then
    raise exception 'We have reached the limit of 99 orders for today. Please call the store so we can take your order.'
      using errcode = 'P0001';
  end if;

  return v_day || lpad(v_next::text, 2, '0');
end;
$$;

-- The number is for the database's own use: a browser has no business asking
-- it what today's next number would be.
revoke all on function public.next_order_reference(timestamptz) from public, anon, authenticated;
grant execute on function public.next_order_reference(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Every order gets its number here, whatever the caller asked for.
--
--    The order's own created_at is the clock, so the ID and the timestamp can
--    never disagree. A caller cannot choose an ID: anything that is not
--    already an 8-digit number is replaced.
-- ---------------------------------------------------------------------------
create or replace function public.assign_order_reference()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if new.reference is null or btrim(new.reference) = '' or new.reference !~ '^[0-9]{8}$' then
    new.reference := public.next_order_reference(new.created_at);
  end if;
  return new;
end;
$$;

revoke all on function public.assign_order_reference() from public, anon, authenticated;

drop trigger if exists orders_assign_reference on public.orders;
create trigger orders_assign_reference
  before insert on public.orders
  for each row execute function public.assign_order_reference();

-- ---------------------------------------------------------------------------
-- 5. The orders that already exist.
--
--    They are given the new format too, oldest first, so the admin panel, the
--    customer's order history and the exports all speak one language. The old
--    ID is kept beside the new one. Every step is collision-checked, and the
--    whole thing is one transaction: if a single order cannot be numbered
--    safely, nothing changes at all.
-- ---------------------------------------------------------------------------
do $$
declare
  r         record;
  v_day     text;
  v_last_day text := '';
  v_seq     integer := 0;
  v_new     text;
begin
  for r in
    select id, reference, created_at
      from public.orders
     order by created_at, id
  loop
    v_day := to_char(r.created_at at time zone 'Asia/Kolkata', 'DDMMYY');
    if v_day = v_last_day then
      v_seq := v_seq + 1;
    else
      v_last_day := v_day;
      v_seq := 1;
    end if;

    v_new := v_day || lpad(v_seq::text, 2, '0');

    -- Never take a number that is already in use.
    while exists (select 1 from public.orders o where o.reference = v_new) loop
      v_seq := v_seq + 1;
      if v_seq > 99 then
        raise exception 'More than 99 orders share the business day % — the new order IDs cannot be assigned safely.', v_day;
      end if;
      v_new := v_day || lpad(v_seq::text, 2, '0');
    end loop;

    update public.orders
       set reference = v_new,
           previous_reference = r.reference
     where id = r.id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Now that every row is a number, the constraint can say so.
-- ---------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_reference_chk;
alter table public.orders
  add constraint orders_reference_chk check (reference ~ '^[0-9]{8}$');

-- ---------------------------------------------------------------------------
-- 7. create_order, with the order ID it writes changed and nothing else.
--
--    The function below is a byte-exact copy of `create_order` from
--    20261020090000_refuse_unpayable_orders.sql, with one line changed: the
--    order ID. The guard that refuses an order that could never be paid is
--    carried over untouched.
-- ---------------------------------------------------------------------------
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
  v_coupon   text  := nullif(upper(btrim(coalesce(payload ->> 'coupon_code', ''))), '');
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
  v_c        public.coupons%rowtype;
  v_sub      integer;
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
          confirmation_sent_at = null,  -- re-arm: this is a new attempt
          coupon_code    = v_coupon,
          updated_at     = now()
      where id = v_reuse.id
      returning * into v_order;

      delete from public.order_items where order_id = v_order.id;
    end if;
  end if;

  -- ---- simple double-submit / abuse guard --------------------------------
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
        address, city, state, pincode, note, payment_method, coupon_code
      ) values (
        public.next_order_reference(),
        v_uid,
        btrim(v_name), lower(btrim(v_email)), btrim(v_phone),
        btrim(v_address), btrim(v_city), btrim(v_state), btrim(v_pincode), v_note, v_pay, v_coupon
      ) returning * into v_order;
    exception when unique_violation then
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
          confirmation_sent_at = null,  -- re-arm: this is a new attempt
          coupon_code    = v_coupon,
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

  -- ---- coupon: validated by the database, never by the browser -----------
  if v_coupon is not null then
    select * into v_c
    from public.coupons c
    where c.code = v_coupon
      and c.is_active
      and (c.starts_at is null or c.starts_at <= now())
      and (c.ends_at   is null or c.ends_at   >  now());

    if not found then
      raise exception 'That coupon code is not valid or has expired.';
    end if;

    select coalesce(sum(qty * unit_price), 0) into v_sub
    from public.order_items where order_id = v_order.id;

    if v_sub < v_c.min_subtotal then
      raise exception 'The coupon % needs a minimum order of ₹%.',
        v_coupon, to_char(v_c.min_subtotal, 'FM999,999,990');
    end if;
  end if;

  -- The coupon is settled and the items are in: price the order one last
  -- time exactly as the totals trigger does.
  perform public.recalc_order_totals(v_order.id);

  select * into v_order from public.orders where id = v_order.id;


  -- ---- an order must be payable -------------------------------------------
  -- This store takes online payment only, and Razorpay refuses to collect
  -- less than ₹1, so a ₹0 order can never be charged. Until now such an
  -- order was still INSERTED: `create-razorpay-order` only looks at the
  -- amount AFTER this function has already returned, so it answered 400/500
  -- and left a permanently "pending" order behind - one more every time the
  -- shopper retried, and none of them chargeable or clearable.
  --
  -- One route reaches it: a FIXED coupon worth at least the cart subtotal.
  -- The percent side is capped at 99 by `coupons_check` (20261019160000),
  -- but a fixed discount is only clamped to the subtotal by
  -- `recalc_order_totals`, so `total = subtotal - discount` lands on exactly
  -- 0. Shipping is always ₹0 (20261006090000), so nothing else holds the
  -- total up.
  --
  -- The other two routes are already closed, and are named here so they are
  -- not re-opened by mistake: `create_order` requires `p.is_active` on every
  -- product (the single ₹0-priced row is inactive), and the admin panel
  -- refuses `price < 1`.
  --
  -- The guard runs AFTER the final re-read and BEFORE the return, so the raise
  -- unwinds the whole function and no row survives. It sits outside both the
  -- `exception when unique_violation` and the `exception when others` block,
  -- and `rpcCreateOrder` passes a P0001 message straight to the shopper, so
  -- the customer reads this sentence rather than a database error. It cannot
  -- disturb any existing order: it only runs while creating a new one.
  if coalesce(v_order.total, 0) < 1 then
    raise exception 'This order comes to ₹0, so there is nothing to pay. Remove the coupon or add another item.';
  end if;

  return json_build_object(
    'id',              v_order.id,
    'reference',       v_order.reference,
    'status',          v_order.status,
    'subtotal',        v_order.subtotal,
    'shipping',        v_order.shipping,
    'discount',        v_order.discount,
    'coupon_code',     v_order.coupon_code,
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

revoke all on function public.create_order(json) from public, anon, authenticated, service_role;
grant execute on function public.create_order(json) to anon, authenticated;
