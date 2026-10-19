-- Ruhi Collection — coupon codes at checkout.
--
-- The smallest secure coupon system that fits the existing architecture:
--
--  * `public.coupons` holds the codes an admin creates (percent or fixed
--    rupees off, optional minimum subtotal and validity window, on/off
--    switch). Nobody browses the table: shoppers only ever validate ONE code
--    through the `public.validate_coupon()` RPC, which returns nothing about
--    any other code.
--  * `public.orders` gains `coupon_code` and `discount`. The browser is never
--    authoritative for money: `create_order()` re-validates the code and the
--    `order_items_set_totals()` trigger (via the new
--    `public.recalc_order_totals()`) recomputes subtotal, discount, shipping
--    and total from the items actually stored — so the amount Razorpay is
--    asked to collect always equals what the database decided, whatever the
--    browser claims. The discount can never exceed the subtotal, so a total
--    can never go below zero.
--  * The existing totals constraint is widened from
--    `total = subtotal + shipping` to `total = subtotal - discount + shipping`.
--    Every existing row has `discount = 0`, so the constraint still holds for
--    all production data — no row is rewritten.
--  * Nothing else changes: prices still come from `public.products`, payment
--    fields are still protected, and `create_order()` remains the only write
--    path for orders. Keep the discount rule in sync with
--    src/lib/coupons.js (display only) and src/lib/pricing.js.
--
-- Nothing here touches products, banners, storage, RLS on other tables, or
-- the Razorpay Edge Functions beyond passing the code through to
-- `create_order()`.

-- ---------------------------------------------------------------------------
-- 1. Coupons
-- ---------------------------------------------------------------------------
create table if not exists public.coupons (
  code         text primary key check (code ~ '^[A-Z0-9_-]{2,32}$'),
  kind         text not null check (kind in ('percent', 'fixed')),
  value        integer not null check (
    (kind = 'percent' and value between 1 and 100)
    or (kind = 'fixed' and value between 1 and 1000000)
  ),
  min_subtotal integer not null default 0 check (min_subtotal >= 0),
  starts_at    timestamptz,
  ends_at      timestamptz,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint coupons_window_chk
    check (starts_at is null or ends_at is null or starts_at < ends_at)
);

drop trigger if exists set_coupons_updated_at on public.coupons;
create trigger set_coupons_updated_at
before update on public.coupons
for each row execute function public.set_updated_at();

alter table public.coupons enable row level security;

-- Shoppers never touch this table directly: `public.validate_coupon()` is
-- SECURITY DEFINER and answers for one code only. Only admins manage codes.
revoke all on table public.coupons from anon;
grant  select, insert, update, delete on table public.coupons to authenticated;
grant  all on table public.coupons to service_role;

drop policy if exists "admins can read coupons" on public.coupons;
create policy "admins can read coupons"
  on public.coupons for select to authenticated
  using (public.is_admin());

drop policy if exists "admins can create coupons" on public.coupons;
create policy "admins can create coupons"
  on public.coupons for insert to authenticated
  with check (public.is_admin());

drop policy if exists "admins can update coupons" on public.coupons;
create policy "admins can update coupons"
  on public.coupons for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins can delete coupons" on public.coupons;
create policy "admins can delete coupons"
  on public.coupons for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. Order columns + widened totals constraint
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists coupon_code text,
  add column if not exists discount    integer not null default 0;

alter table public.orders drop constraint if exists orders_discount_chk;
alter table public.orders add constraint orders_discount_chk
  check (discount >= 0);

-- Every existing row has discount = 0, so `total = subtotal - 0 + shipping`
-- still describes exactly the data production already holds.
alter table public.orders drop constraint if exists orders_totals_chk;
alter table public.orders add constraint orders_totals_chk
  check (total = subtotal - discount + shipping);

-- ---------------------------------------------------------------------------
-- 3. Totals: one function owns the rule, the trigger calls it
-- ---------------------------------------------------------------------------
-- Subtotal from the stored items, discount from the coupon stored on the
-- order (only if it is active, in its window and past its minimum), free
-- shipping (20261006090000), total never below zero. SECURITY DEFINER so it
-- can read `coupons` regardless of the caller's RLS.
create or replace function public.recalc_order_totals(p_order uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_sub    integer;
  v_disc   integer := 0;
  v_code   text;
  v_coupon public.coupons%rowtype;
begin
  if p_order is null then
    return;
  end if;

  select coalesce(sum(qty * unit_price), 0) into v_sub
  from public.order_items where order_id = p_order;

  select o.coupon_code into v_code from public.orders o where o.id = p_order;

  if v_code is not null then
    select * into v_coupon
    from public.coupons c
    where c.code = v_code
      and c.is_active
      and (c.starts_at is null or c.starts_at <= now())
      and (c.ends_at   is null or c.ends_at   >  now())
      and v_sub >= c.min_subtotal;

    if found then
      if v_coupon.kind = 'percent' then
        v_disc := floor(v_sub * v_coupon.value / 100.0)::integer;
      else
        v_disc := least(v_coupon.value, v_sub);
      end if;
    end if;
  end if;

  -- A discount is always between 0 and the subtotal: the payable total can
  -- never go negative, and a fixed coupon can never refund money.
  v_disc := least(greatest(coalesce(v_disc, 0), 0), coalesce(v_sub, 0));

  update public.orders
  set subtotal   = v_sub,
      discount   = v_disc,
      shipping   = 0,
      total      = v_sub - v_disc,
      updated_at = now()
  where id = p_order;
end $$;

-- Same function name and signature as before, so the existing
-- `order_items_set_totals` trigger keeps pointing at it.
create or replace function public.set_order_totals() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.recalc_order_totals(coalesce(new.order_id, old.order_id));
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
-- 4. create_order() — now accepts and re-validates a coupon code
-- ---------------------------------------------------------------------------
-- Only the delta vs 20260928213000_razorpay_online_payments.sql: an optional
-- `coupon_code` in the payload, validated HERE (never trusted from the
-- browser) and priced by `recalc_order_totals()`. Everything else — address
-- checks, size membership, qty limits, price lookup from `public.products`,
-- the reuse/double-submit logic — is unchanged.
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
        'RCH-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
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

-- ---------------------------------------------------------------------------
-- 5. validate_coupon() — the only coupon read a shopper ever gets
-- ---------------------------------------------------------------------------
-- Answers for ONE code against ONE subtotal and reveals nothing about any
-- other code. The checkout uses it to show the discount; `create_order()`
-- re-validates everything before any money is charged.
create or replace function public.validate_coupon(p_code text, p_subtotal integer)
returns json
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_code   text := nullif(upper(btrim(coalesce(p_code, ''))), '');
  v_sub    integer := greatest(coalesce(p_subtotal, 0), 0);
  v_coupon public.coupons%rowtype;
  v_disc   integer := 0;
begin
  if v_code is null then
    return json_build_object('valid', false, 'message', 'Please enter a coupon code.');
  end if;

  select * into v_coupon from public.coupons c where c.code = v_code;

  if not found then
    return json_build_object('valid', false, 'code', v_code, 'message', 'That coupon code is not valid.');
  end if;
  if not v_coupon.is_active then
    return json_build_object('valid', false, 'code', v_code, 'message', 'That coupon is no longer active.');
  end if;
  if v_coupon.starts_at is not null and v_coupon.starts_at > now() then
    return json_build_object('valid', false, 'code', v_code, 'message', 'That coupon is not active yet.');
  end if;
  if v_coupon.ends_at is not null and v_coupon.ends_at <= now() then
    return json_build_object('valid', false, 'code', v_code, 'message', 'That coupon has expired.');
  end if;
  if v_sub < v_coupon.min_subtotal then
    return json_build_object('valid', false, 'code', v_code, 'message',
      format('That coupon needs a minimum order of ₹%s.',
             to_char(v_coupon.min_subtotal, 'FM999,999,990')));
  end if;

  if v_coupon.kind = 'percent' then
    v_disc := floor(v_sub * v_coupon.value / 100.0)::integer;
  else
    v_disc := least(v_coupon.value, v_sub);
  end if;
  v_disc := least(greatest(v_disc, 0), v_sub);

  return json_build_object(
    'valid',    true,
    'code',     v_code,
    'kind',     v_coupon.kind,
    'value',    v_coupon.value,
    'discount', v_disc,
    'message',  'Coupon applied.'
  );
end $$;

revoke all on function public.validate_coupon(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.validate_coupon(text, integer) to anon, authenticated;
