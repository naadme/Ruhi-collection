-- Rohi Collection — checkout: orders, order items and the price-safe
-- `create_order()` routine.
--
-- Design notes
--  * The storefront never sends a price. `create_order()` accepts only product
--    ids, sizes and quantities and looks the prices up in `public.products`,
--    so a tampered client cannot change what it is charged.
--  * Subtotal / shipping / total are recomputed in the database by a trigger,
--    so every write path keeps them consistent.
--  * RLS stays enabled. Customers read only their own orders; admins read and
--    update everything. `anon` and `authenticated` get no direct INSERT or
--    UPDATE on `orders` — writes go through `create_order()` only.
--  * Nothing here touches `newsletter_subscribers` or `contact_messages`.

-- ---------------------------------------------------------------------------
-- 1. Orders
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  reference       text not null unique,
  user_id         uuid references auth.users (id) on delete set null,
  status          text not null default 'pending',
  full_name       text not null,
  email           text not null,
  phone           text not null,
  address         text not null,
  city            text not null,
  state           text not null,
  pincode         text not null,
  note            text,
  payment_method  text not null default 'cod',
  subtotal        integer not null default 0 check (subtotal >= 0),
  shipping        integer not null default 0 check (shipping >= 0),
  total           integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint orders_status_chk
    check (status in ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled')),
  -- 'upi' / 'card' are reserved for when an online gateway is connected.
  constraint orders_payment_chk
    check (payment_method in ('cod', 'upi', 'card')),
  constraint orders_reference_chk
    check (reference ~ '^RCH-[A-Z0-9]{8}$'),
  constraint orders_email_chk
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and length(email) <= 200),
  constraint orders_name_chk
    check (char_length(full_name) between 2 and 120),
  constraint orders_phone_chk
    check (char_length(phone) between 8 and 20),
  constraint orders_address_chk
    check (char_length(address) between 5 and 300
           and char_length(city) between 2 and 100
           and char_length(state) between 2 and 100
           and pincode ~ '^[1-9][0-9]{5}$'),
  constraint orders_note_chk     check (note is null or char_length(note) <= 500),
  constraint orders_totals_chk   check (total = subtotal + shipping)
);

create index if not exists orders_user_id_idx  on public.orders (user_id);
create index if not exists orders_created_idx  on public.orders (created_at desc);

drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Order items — a snapshot of what was bought, so editing or removing a
--    product later never rewrites (or breaks) order history.
-- ---------------------------------------------------------------------------
create table if not exists public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  product_id  text not null,
  title       text not null,
  image       text,
  size        text not null,
  qty         integer not null check (qty between 1 and 10),
  unit_price  integer not null check (unit_price >= 0),
  created_at  timestamptz not null default now(),
  constraint order_items_size_chk check (char_length(size) between 1 and 12)
);

create index if not exists order_items_order_idx on public.order_items (order_id);

-- ---------------------------------------------------------------------------
-- 3. Totals — recomputed from the items on every change.
--    Shipping rule (mirrored in src/lib/pricing.js, keep them in sync):
--    free over ₹999, otherwise a flat ₹79.
-- ---------------------------------------------------------------------------
create or replace function public.set_order_totals() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order uuid;
  v_sub   integer;
begin
  v_order := coalesce(new.order_id, old.order_id);
  if v_order is null then
    return coalesce(new, old);
  end if;

  select coalesce(sum(qty * unit_price), 0) into v_sub
  from public.order_items where order_id = v_order;

  update public.orders
  set subtotal   = v_sub,
      shipping   = case when v_sub >= 999 then 0 else 79 end,
      total      = v_sub + case when v_sub >= 999 then 0 else 79 end,
      updated_at = now()
  where id = v_order;

  return coalesce(new, old);
end $$;

drop trigger if exists order_items_set_totals on public.order_items;
create trigger order_items_set_totals
after insert or update or delete on public.order_items
for each row execute function public.set_order_totals();

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "customers read their own orders" on public.orders;
create policy "customers read their own orders"
on public.orders for select
to authenticated
using (user_id = (select auth.uid()) or is_admin());

drop policy if exists "admins update orders" on public.orders;
create policy "admins update orders"
on public.orders for update
to authenticated
using (is_admin())
with check (is_admin());

drop policy if exists "customers read their own order items" on public.order_items;
create policy "customers read their own order items"
on public.order_items for select
to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id and (o.user_id = (select auth.uid()) or is_admin())
  )
);

-- No INSERT / DELETE policy exists, and the grants below remove the privilege
-- outright: orders can only be created by `create_order()`.
revoke all on table public.orders      from anon, authenticated;
revoke all on table public.order_items from anon, authenticated;
grant  select on table public.orders      to authenticated;
grant  select on table public.order_items to authenticated;
grant  update on table public.orders      to authenticated;

-- ---------------------------------------------------------------------------
-- 5. create_order(payload) — atomic, price-authoritative checkout.
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
  v_order    public.orders%rowtype;
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

  -- ---- payment ----------------------------------------------------------
  -- Only cash on delivery is wired up. Online payments need a gateway
  -- account, so they are refused here rather than silently accepted.
  if coalesce(payload ->> 'payment_method', 'cod') <> 'cod' then
    raise exception 'Online payment is not available yet. Please choose cash on delivery.';
  end if;

  -- ---- simple double-submit / abuse guard --------------------------------
  if exists (
    select 1 from public.orders o
    where lower(o.email) = lower(v_email)
      and o.created_at > now() - interval '5 minutes'
  ) then
    raise exception 'We already received a recent order for this email. Please wait a few minutes before placing another.';
  end if;

  insert into public.orders (
    reference, user_id, full_name, email, phone,
    address, city, state, pincode, note, payment_method
  ) values (
    'RCH-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
    (select auth.uid()),
    btrim(v_name), lower(btrim(v_email)), btrim(v_phone),
    btrim(v_address), btrim(v_city), btrim(v_state), btrim(v_pincode), v_note, 'cod'
  ) returning * into v_order;

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
    'id',            v_order.id,
    'reference',     v_order.reference,
    'status',        v_order.status,
    'subtotal',      v_order.subtotal,
    'shipping',      v_order.shipping,
    'total',         v_order.total,
    'payment_method', v_order.payment_method,
    'created_at',    v_order.created_at,
    'items',         v_lines
  );
end $$;

-- Callable by shoppers (signed in or not) and by nobody else.
revoke all on function public.create_order(json) from public, anon, authenticated, service_role;
grant execute on function public.create_order(json) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Live order feed for the admin dashboard (RLS still applies per message).
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.orders;
exception
  when duplicate_object or undefined_object then null;
end $$;
