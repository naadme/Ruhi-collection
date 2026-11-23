-- "Recommended" order on category pages (23 Nov 2026).
--
-- A category page (/shop?type=…) opens on Recommended:
--   1. designs whose Badge says "Bestseller",
--   2. then designs first added in the last 14 days, newest first,
--   3. then everything else,
-- with groups 1 and 3 ordered by the position in this table: most orders
-- received first, then most viewed. Groups and dates are worked out in the
-- browser from the catalogue it already has (src/lib/recommendedOrder.js);
-- only this position needs the server, because orders are private.
--
-- The table holds a POSITION per design and nothing else: no order count, no
-- view count, no money. Anyone may read it; nobody but this function writes
-- it. Shoppers read it only on category pages (src/lib/productRank.js).
--
--   orders  paid, non-test orders in the last 30 days that hold the design
--           (an order with two colours of one design counts once)
--   views   GA4 product views (view_item) in the last 30 days, from the
--           dashboard's hourly copy (dash_ga4_items). GA4 names an item by
--           the design's name (src/lib/trackingItems.js viewedItem), so views
--           are matched by name; views from before a design was renamed are
--           not counted for it.
--   ties    the design added most recently first
--
-- Refreshed every hour at minute 20, after the dashboard sync (minute 7) has
-- copied GA4's numbers in. A design added between runs simply has no position
-- yet and sorts after the ranked ones, newest first.
--
-- Nothing changes for shoppers until the site's code reads this table. To
-- undo, promote the previous deployment; the table is harmless unused.

begin;

create table if not exists public.product_rank (
  design_id  text primary key,
  position   integer not null,
  updated_at timestamptz not null default now()
);

alter table public.product_rank enable row level security;

revoke all on public.product_rank from anon, authenticated;
grant select on public.product_rank to anon, authenticated;

drop policy if exists "anyone can read the ranking" on public.product_rank;
create policy "anyone can read the ranking" on public.product_rank
  for select to anon, authenticated using (true);

create or replace function public.refresh_product_rank()
returns void
language plpgsql security definer set search_path = public, pg_temp
as $function$
begin
  with
  -- One design per design_id (a row without one is a design of its own).
  designs as (
    select coalesce(nullif(p.design_id, ''), p.id) as design_id,
           min(p.created_at) as first_added
    from public.products p
    group by 1
  ),
  -- The design's name as GA4 receives it: the title without its " - Colour".
  names as (
    select distinct
      coalesce(nullif(p.design_id, ''), p.id) as design_id,
      case
        when coalesce(p.colour, '') <> '' and right(p.title, length(p.colour) + 3) = ' - ' || p.colour
          then left(p.title, length(p.title) - length(p.colour) - 3)
        else regexp_replace(p.title, '\s+-\s+[^-]+$', '')
      end as name
    from public.products p
  ),
  views as (
    select n.design_id, sum(g.viewed) as views
    from names n
    join public.dash_ga4_items g on g.item_name = n.name
    where g.day >= current_date - 30
    group by 1
  ),
  orders as (
    select coalesce(nullif(p.design_id, ''), p.id) as design_id,
           count(distinct oi.order_id) as orders
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.products p on p.id = oi.product_id
    where o.payment_status = 'paid'
      and coalesce(o.is_test, false) = false
      and o.created_at >= now() - interval '30 days'
    group by 1
  ),
  ranked as (
    select d.design_id,
           row_number() over (
             order by coalesce(o.orders, 0) desc, coalesce(v.views, 0) desc, d.first_added desc, d.design_id
           ) as position
    from designs d
    left join orders o using (design_id)
    left join views v using (design_id)
  )
  insert into public.product_rank (design_id, position, updated_at)
  select design_id, position, now() from ranked
  on conflict (design_id) do update
    set position = excluded.position, updated_at = excluded.updated_at;

  -- A design that no longer exists leaves the table.
  delete from public.product_rank r
  where not exists (
    select 1 from public.products p
    where coalesce(nullif(p.design_id, ''), p.id) = r.design_id
  );
end $function$;

revoke all on function public.refresh_product_rank() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

select cron.schedule('product-rank-hourly', '20 * * * *', 'select public.refresh_product_rank()');

-- The first positions now, so the table is never empty.
select public.refresh_product_rank();

commit;
