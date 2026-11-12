-- Unpaid checkouts (12 Nov 2026, checkout change 4).
--
-- When a shopper at checkout, with something in the cart, has typed a valid
-- Indian mobile number, the number and the cart are recorded. The owner can
-- then see who left without paying and offer help on WhatsApp. Checkout tells
-- the shopper the number is "For order updates only. No spam, promise.", so
-- messages must be about that order.
--
-- One row per mobile number: a later visit refreshes the cart and the time.
-- Rows are kept until an admin deletes one (the owner chose no expiry; delete
-- answers an erasure request). Shoppers can only add or refresh a row through
-- public.save_checkout_lead(), which stores product IDs, sizes and quantities
-- (never typed text), the ad source, and nothing else. Only admins can read
-- or delete rows.

create table if not exists public.checkout_leads (
  phone             text primary key check (phone ~ '^[6-9][0-9]{9}$'),
  items             jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  utm_source        text check (utm_source is null or length(utm_source) <= 100),
  utm_medium        text check (utm_medium is null or length(utm_medium) <= 100),
  utm_campaign      text check (utm_campaign is null or length(utm_campaign) <= 100),
  utm_content       text check (utm_content is null or length(utm_content) <= 100),
  has_meta_click    boolean not null default false,
  has_google_click  boolean not null default false,
  visits            integer not null default 1 check (visits >= 1),
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now()
);

create index if not exists checkout_leads_last_seen_idx on public.checkout_leads (last_seen_at desc);

alter table public.checkout_leads enable row level security;

revoke all on table public.checkout_leads from anon, authenticated;
grant select, delete on table public.checkout_leads to authenticated;
grant all on table public.checkout_leads to service_role;

drop policy if exists "admins can read checkout leads" on public.checkout_leads;
create policy "admins can read checkout leads"
  on public.checkout_leads for select to authenticated
  using (public.is_admin());

drop policy if exists "admins can delete checkout leads" on public.checkout_leads;
create policy "admins can delete checkout leads"
  on public.checkout_leads for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Checkout's side: record or refresh one number. A malformed number, or a
-- cart with no real product, is simply ignored. Checkout sends this in the
-- background and ignores any error, so it can't get in a shopper's way.
-- ---------------------------------------------------------------------------
create or replace function public.save_checkout_lead(p_phone text, p_items jsonb, p_source jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_phone text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_src   jsonb := case when jsonb_typeof(p_source) = 'object' then p_source else '{}'::jsonb end;
  v_items jsonb;
  v_text  text;
begin
  if v_phone !~ '^[6-9][0-9]{9}$' then
    return;
  end if;

  -- Only products that exist, at most 20 lines, quantities 1–10.
  select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'size', i.size, 'qty', i.qty) order by i.n), '[]'::jsonb)
    into v_items
  from (
    select e.n,
           e.x->>'product_id' as product_id,
           left(coalesce(e.x->>'size', ''), 12) as size,
           case when coalesce(e.x->>'qty', '') ~ '^[0-9]{1,2}$' then least(greatest((e.x->>'qty')::integer, 1), 10) else 1 end as qty
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end)
         with ordinality as e(x, n)
    where e.n <= 20 and jsonb_typeof(e.x) = 'object'
  ) i
  join public.products p on p.id = i.product_id;

  if v_items = '[]'::jsonb then
    return;
  end if;

  -- A guard against flooding: at most 2,000 new numbers a day.
  if not exists (select 1 from public.checkout_leads where phone = v_phone)
     and (select count(*) from public.checkout_leads where first_seen_at > now() - interval '1 day') >= 2000 then
    return;
  end if;

  insert into public.checkout_leads as l
    (phone, items, utm_source, utm_medium, utm_campaign, utm_content, has_meta_click, has_google_click)
  values (
    v_phone,
    v_items,
    nullif(left(btrim(coalesce(v_src->>'utm_source', '')), 100), ''),
    nullif(left(btrim(coalesce(v_src->>'utm_medium', '')), 100), ''),
    nullif(left(btrim(coalesce(v_src->>'utm_campaign', '')), 100), ''),
    nullif(left(btrim(coalesce(v_src->>'utm_content', '')), 100), ''),
    coalesce(v_src->>'has_meta_click', '') = 'true',
    coalesce(v_src->>'has_google_click', '') = 'true'
  )
  on conflict (phone) do update set
    items            = excluded.items,
    utm_source       = coalesce(excluded.utm_source, l.utm_source),
    utm_medium       = coalesce(excluded.utm_medium, l.utm_medium),
    utm_campaign     = coalesce(excluded.utm_campaign, l.utm_campaign),
    utm_content      = coalesce(excluded.utm_content, l.utm_content),
    has_meta_click   = l.has_meta_click or excluded.has_meta_click,
    has_google_click = l.has_google_click or excluded.has_google_click,
    -- A return after half an hour or more counts as another visit.
    visits           = l.visits + case when l.last_seen_at < now() - interval '30 minutes' then 1 else 0 end,
    last_seen_at     = now();
end $$;

revoke all on function public.save_checkout_lead(text, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_checkout_lead(text, jsonb, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The admin's "Unpaid checkouts" list: each number with its cart as the shop
-- prices it today, and the first paid order from that number since its last
-- visit to checkout (excluding admin test orders). No such order means the
-- shopper didn't pay.
-- ---------------------------------------------------------------------------
create or replace function public.admin_checkout_leads(p_limit integer default 300)
returns table (
  phone text, items jsonb, total integer,
  utm_source text, utm_medium text, utm_campaign text, utm_content text,
  has_meta_click boolean, has_google_click boolean,
  visits integer, first_seen_at timestamptz, last_seen_at timestamptz,
  paid_reference text, paid_at timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can see unpaid checkouts.' using errcode = '42501';
  end if;
  return query
  select l.phone,
         cart.items,
         cart.total,
         l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content,
         l.has_meta_click, l.has_google_click,
         l.visits, l.first_seen_at, l.last_seen_at,
         paid.reference, paid.created_at
  from public.checkout_leads l
  cross join lateral (
    select coalesce(jsonb_agg(jsonb_build_object(
             'product_id', p.id, 'title', p.title, 'colour', p.colour,
             'size', e.x->>'size', 'qty', (e.x->>'qty')::integer, 'price', p.price) order by e.n), '[]'::jsonb) as items,
           coalesce(sum(p.price * (e.x->>'qty')::integer), 0)::integer as total
    from jsonb_array_elements(l.items) with ordinality as e(x, n)
    join public.products p on p.id = e.x->>'product_id'
  ) cart
  left join lateral (
    select o.reference, o.created_at
    from public.orders o
    where right(regexp_replace(o.phone, '\D', '', 'g'), 10) = l.phone
      and o.payment_status = 'paid'
      and not o.is_test
      and o.created_at >= l.last_seen_at - interval '10 minutes'
    order by o.created_at
    limit 1
  ) paid on true
  order by l.last_seen_at desc
  limit greatest(1, least(coalesce(p_limit, 300), 1000));
end $$;

revoke all on function public.admin_checkout_leads(integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_checkout_leads(integer) to authenticated;
