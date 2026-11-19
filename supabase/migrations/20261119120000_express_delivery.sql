-- Ruhi Collections: Express delivery by air (19 Nov 2026).
--
-- The owner's rules (19 Nov 2026):
--   * Standard delivery stays free on every order (20261006090000).
--   * Express delivery is optional: the parcel is sent by air and arrives in
--     4 days, all days counted. It costs ₹149 per item (2 items: ₹298), every
--     PIN code can have it, and a coupon never discounts it.
--   * The dashboard has a switch to pause Express (a festival rush, courier
--     trouble). While it is paused, `create_order()` refuses Express.
--
-- What changes:
--   1. `public.shop_settings`: one row of switches the shop shows to every
--      visitor. Anyone may read it; only an admin may change it, and only the
--      `express_delivery` switch.
--   2. `orders.delivery_speed`: 'standard' (the default for every existing
--      order) or 'express'. Set when the order is placed; a browser-facing role
--      can never change it afterwards (`orders_protect_delivery_speed`).
--   3. `recalc_order_totals()`: shipping is ₹149 × the number of items for an
--      Express order and ₹0 otherwise; total = subtotal − discount + shipping,
--      which `orders_totals_chk` already requires. Its grants are untouched.
--   4. `create_order()`: reads an optional `delivery_speed` from the payload,
--      refuses anything but 'standard' or 'express', refuses Express while it
--      is paused, stores the choice (also on a reused checkout) and returns it.
--      The rest is a copy of the live function (20261106090000); the grants
--      are restated as they were.
--
-- No existing order, price, coupon or payment is changed: every existing order
-- becomes 'standard', which is what it was.

begin;

-- ---------------------------------------------------------------------------
-- 1. The shop's switches
-- ---------------------------------------------------------------------------
create table if not exists public.shop_settings (
  id               boolean primary key default true check (id),  -- exactly one row
  express_delivery boolean not null default true,
  updated_at       timestamptz not null default now()
);

insert into public.shop_settings (id) values (true) on conflict (id) do nothing;

alter table public.shop_settings enable row level security;

drop policy if exists "anyone can read shop settings" on public.shop_settings;
create policy "anyone can read shop settings"
  on public.shop_settings for select to anon, authenticated
  using (true);

drop policy if exists "admins can update shop settings" on public.shop_settings;
create policy "admins can update shop settings"
  on public.shop_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on table public.shop_settings from public, anon, authenticated;
grant select on table public.shop_settings to anon, authenticated;
grant update (express_delivery) on table public.shop_settings to authenticated;

drop trigger if exists set_shop_settings_updated_at on public.shop_settings;
create trigger set_shop_settings_updated_at
before update on public.shop_settings
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Each order's delivery option
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists delivery_speed text not null default 'standard';

alter table public.orders drop constraint if exists orders_delivery_speed_chk;
alter table public.orders
  add constraint orders_delivery_speed_chk check (delivery_speed in ('standard', 'express'));

-- Like the payment fields (protect_order_payment_fields) and the A/B tests
-- (protect_order_experiments): the shopper's own session and the dashboard can
-- never switch an order between standard and Express after it is placed.
-- `create_order()` runs as its owner, so it is not stopped by this.
create or replace function public.protect_order_delivery_speed()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated')
     and new.delivery_speed is distinct from old.delivery_speed then
    raise exception 'The delivery option is set when the order is placed and cannot be changed.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists orders_protect_delivery_speed on public.orders;
create trigger orders_protect_delivery_speed
before update on public.orders
for each row execute function public.protect_order_delivery_speed();

-- ---------------------------------------------------------------------------
-- 3. Totals: Express adds ₹149 per item
-- ---------------------------------------------------------------------------
-- The same function as 20261019120100 with the shipping line changed. The
-- browser's copy of the fee is EXPRESS_FEE_PER_ITEM in src/lib/pricing.js; a
-- test keeps the two equal.
create or replace function public.recalc_order_totals(p_order uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_sub    integer;
  v_pieces integer;
  v_disc   integer := 0;
  v_ship   integer := 0;
  v_code   text;
  v_speed  text;
  v_coupon public.coupons%rowtype;
begin
  if p_order is null then
    return;
  end if;

  select coalesce(sum(qty * unit_price), 0), coalesce(sum(qty), 0) into v_sub, v_pieces
  from public.order_items where order_id = p_order;

  select o.coupon_code, o.delivery_speed into v_code, v_speed
  from public.orders o where o.id = p_order;

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

  -- Standard delivery is free. Express by air is ₹149 for every item, and no
  -- coupon discounts it.
  if v_speed = 'express' then
    v_ship := 149 * coalesce(v_pieces, 0);
  end if;

  update public.orders
  set subtotal   = v_sub,
      discount   = v_disc,
      shipping   = v_ship,
      total      = v_sub - v_disc + v_ship,
      updated_at = now()
  where id = p_order;
end $$;

-- ---------------------------------------------------------------------------
-- 4. create_order(): the shopper's delivery choice
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
  v_speed    text  := coalesce(nullif(lower(btrim(coalesce(payload ->> 'delivery_speed', ''))), ''), 'standard');
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
  -- Online payment only. Before 6 Nov 2026 anyone holding the site's public
  -- key could call this function with 'cod' (or no method at all) and get an
  -- order announced by email without paying. Turning COD back on is a
  -- decision for a later migration, with its own checks.
  if v_pay <> 'razorpay' then
    raise exception 'Cash on delivery is not available. Please pay online to place your order.';
  end if;

  -- ---- delivery: free standard, or Express by air -------------------------
  -- The browser only ASKS for Express. Its price (₹149 per item) is set by
  -- recalc_order_totals(), never by the browser, and the dashboard's switch
  -- (public.shop_settings.express_delivery) can pause it at any time.
  if v_speed not in ('standard', 'express') then
    raise exception 'Please choose a delivery option.';
  end if;
  if v_speed = 'express' and not coalesce((select s.express_delivery from public.shop_settings s where s.id), false) then
    raise exception 'Express delivery is paused right now. Please choose free standard delivery and try again.';
  end if;

  -- ---- reuse an unfinished online checkout -------------------------------
  if v_pay = 'razorpay' then
    select * into v_reuse
    from public.orders o
    where lower(o.email) = lower(v_email)
      and o.payment_method = 'razorpay'
      and o.payment_status in ('pending', 'failed')  -- never a refunded order
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
          delivery_speed = v_speed,
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
        address, city, state, pincode, note, payment_method, coupon_code, delivery_speed
      ) values (
        public.next_order_reference(),
        v_uid,
        btrim(v_name), lower(btrim(v_email)), btrim(v_phone),
        btrim(v_address), btrim(v_city), btrim(v_state), btrim(v_pincode), v_note, v_pay, v_coupon, v_speed
      ) returning * into v_order;
    exception when unique_violation then
      -- The open order that collided: exactly the rows the unique index
      -- holds, so a refunded or failed order is never picked up here.
      select * into v_order
      from public.orders o
      where lower(o.email) = lower(v_email)
        and o.payment_method = 'razorpay'
        and o.payment_status = 'pending'
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
          delivery_speed = v_speed,
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

    -- The Product ID of THIS row — the exact product that was bought, not a
    -- similarly named one — is snapshotted onto the line, exactly like the
    -- title and the price. It can never change afterwards.
    insert into public.order_items (order_id, product_id, title, image, size, qty, unit_price, sku)
    values (v_order.id, v_product.id, v_product.title, v_product.image, v_size, v_qty, v_product.price, v_product.sku);

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'sku',        v_product.sku,
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
  -- 0. Standard shipping is ₹0 (20261006090000), so nothing else holds the
  -- total up; Express (19 Nov 2026) adds ₹149 per item, which a coupon never
  -- discounts.
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
    'delivery_speed',  v_order.delivery_speed,
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

commit;
