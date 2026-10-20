-- Ruhi Collection — the Product ID on every ordered line.
--
-- WHY
-- ---
-- The client reads a product's six-character ID (CCPPCL) off the product and
-- wants to see the SAME ID on the order line they bought, on the order
-- details in the admin panel, in the Excel download, in the Google Sheet and
-- on the confirmation email.
--
-- `public.order_items` did not carry it: it snapshotted the title, the photo,
-- the size, the quantity and the price, and nothing else. The Product ID
-- therefore had to be looked up from `products` at display time — which is
-- wrong twice over. A product that has since been deleted or renumbered
-- would lose its ID on an order that was placed years ago, and the lookup
-- could show the ID of a *different* product than the one that was bought.
--
-- So the ID is SNAPSHOT, exactly like the title and the price: it is written
-- once, when the order is placed, and it never changes afterwards.
--
-- WHAT CHANGES
--   * `order_items.sku` — a new, nullable column holding the six-character
--     Product ID of the exact product row that was ordered.
--   * `create_order()` — writes that column, and returns it in the order
--     payload it hands back to the browser.
--
-- WHAT DOES NOT CHANGE
--   * `order_items.id`, `order_items.product_id`, the title, the photo, the
--     size, the quantity and the unit price are all untouched.
--   * `orders.total`, `orders.subtotal`, `orders.discount` and `orders.shipping`
--     are untouched — the totals trigger still prices the order from the
--     quantity and the unit price.
--   * `products.id` — the immutable link target — is untouched, so no
--     bookmarked URL, cart line or order item changes.
--   * `products.sku` — the Product ID of the product itself — is untouched.
--
-- HISTORICAL ORDERS
-- -----------------
-- The 19 orders already in the shop are backfilled from the product they
-- name: `order_items.product_id` still points at the exact product row that
-- was bought, so the ID can be recovered exactly. A line whose product no
-- longer exists keeps a NULL — nothing is invented, and the order still
-- shows its title, size, quantity and price exactly as before.
--
-- Additive and reversible: `alter table public.order_items drop column sku`
-- restores the schema, and the column is only ever added to.

-- ---------------------------------------------------------------------------
-- 1. The column.
-- ---------------------------------------------------------------------------
alter table public.order_items
  add column if not exists sku text;

comment on column public.order_items.sku is
  'The six-character Product ID (CCPPCL) of the exact product row that was ordered. Snapshotted when the order was placed; never changes.';

-- ---------------------------------------------------------------------------
-- 2. The orders that already exist.
--
--    `order_items.product_id` still names the exact product row that was
--    bought, so the ID is recovered from it — not from a name match, which
--    could pick the wrong product.
-- ---------------------------------------------------------------------------
update public.order_items oi
   set sku = p.sku
  from public.products p
 where p.id = oi.product_id
   and (oi.sku is null or btrim(oi.sku) = '')
   and p.sku is not null;

-- ---------------------------------------------------------------------------
-- 3. create_order(), with the Product ID written onto each line.
--
--    This is a copy of the live `create_order` with exactly two changes:
--    the line item carries the product's `sku`, and the returned payload
--    carries it too. Nothing else about the order is altered.
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

comment on function public.create_order(json) is
  'Creates (or refreshes) an order. Every line snapshots the product title, price and the six-character Product ID.';
