-- Ruhi Collections: the owner's "Daily numbers" dashboard (20 Nov 2026).
--
-- The owner asked for one daily view of the whole path to a sale, from the ad
-- to the money in the bank, with filters, built into the admin. The numbers
-- come from four places:
--
--   * Meta ads    spend, impressions, clicks, video, Meta-counted events
--   * GA4         visitors and each step of the shop's funnel
--   * Razorpay    payment attempts (and why they failed), fees, refunds,
--                 settlements to the bank
--   * this database  orders (the only complete record of real sales) and
--                 unpaid checkouts, read straight from their own tables
--
-- The `dashboard-sync` Edge Function copies the first three into the dash_*
-- tables below: every hour (pg_cron, at minute 7) and when the owner taps
-- "Refresh now". Each run re-reads the last 7 days, because Meta and GA4 keep
-- revising recent days. The admin page only ever reads these tables, so its
-- filters answer at once and the history is kept.
--
-- Owner's decisions (20 Nov 2026):
--   * Meta spend is shown WITHOUT the 18% GST.
--   * Profit is estimated with one margin, 30% of order value, editable here
--     (`dash_settings`), not a cost price per product.
--   * Other costs can be entered by hand (`dash_expenses`): marketing costs
--     count as ad spend, other costs only reduce profit.
--   * Only the owner (`public.is_admin()`) can see or change any of it.
--
-- No personal data is copied: no names, phones, emails, UPI IDs, card numbers
-- or addresses. Razorpay rows keep amounts, method, status and failure reason.
--
-- The hourly job needs two vault entries that are NOT in this file:
-- `dashboard_sync_url` and `dashboard_sync_secret` (the same value as the
-- function's DASHBOARD_SYNC_SECRET). Until they exist the job does nothing
-- and says so in a warning; "Refresh now" works without them.
--
-- Nothing existing is changed.

begin;

-- ---------------------------------------------------------------------------
-- 1. Meta: one row per ad per day, and per placement / age group per day
-- ---------------------------------------------------------------------------
create table if not exists public.dash_meta_daily (
  day                date not null,
  ad_id              text not null,
  ad_name            text not null default '',
  adset_id           text not null default '',
  adset_name         text not null default '',
  campaign_id        text not null default '',
  campaign_name      text not null default '',
  spend              numeric(12,2) not null default 0,   -- rupees, without GST
  impressions        integer not null default 0,
  reach              integer not null default 0,
  link_clicks        integer not null default 0,
  landing_page_views integer not null default 0,
  video_3s           integer not null default 0,         -- 3-second plays
  video_p25          integer not null default 0,         -- watched a quarter
  add_to_cart        integer not null default 0,         -- as Meta counts them
  checkouts          integer not null default 0,
  payment_info       integer not null default 0,
  purchases          integer not null default 0,
  purchase_value     numeric(12,2) not null default 0,
  primary key (day, ad_id)
);

create table if not exists public.dash_meta_slices (
  day            date not null,
  kind           text not null check (kind in ('placement', 'age')),
  slice          text not null,
  spend          numeric(12,2) not null default 0,
  impressions    integer not null default 0,
  link_clicks    integer not null default 0,
  add_to_cart    integer not null default 0,
  purchases      integer not null default 0,
  purchase_value numeric(12,2) not null default 0,
  primary key (day, kind, slice)
);

-- ---------------------------------------------------------------------------
-- 2. GA4: people per funnel step per day, split the ways the filters need
-- ---------------------------------------------------------------------------
-- channel  meta_ads | google_ads | social | search | direct | other | test
-- device   android | iphone | computer | other
-- browser  in_app (Instagram / Facebook's own browser) | chrome | safari | other
-- visitor  new | returning | unknown
-- `users` is GA4's people count for that day and split, so a sum over several
-- days counts a person once per day.
create table if not exists public.dash_ga4_daily (
  day           date not null,
  event_name    text not null,
  source_medium text not null default '',
  channel       text not null,
  ad_content    text not null default '',
  device        text not null,
  browser       text not null,
  visitor       text not null,
  country       text not null default '',
  users         integer not null default 0,
  events        integer not null default 0
);
create index if not exists dash_ga4_daily_day_idx on public.dash_ga4_daily (day);

create table if not exists public.dash_ga4_items (
  day         date not null,
  item_name   text not null,
  viewed      integer not null default 0,
  added       integer not null default 0,
  checked_out integer not null default 0,
  purchased   integer not null default 0,
  revenue     numeric(12,2) not null default 0,
  primary key (day, item_name)
);

-- The A/B versions each visitor saw (GA4 custom dimension `ab_tests`, for
-- example "aa_check:b"), per funnel step per day.
create table if not exists public.dash_ga4_ab (
  day        date not null,
  event_name text not null,
  ab_tests   text not null,
  users      integer not null default 0,
  events     integer not null default 0
);
create index if not exists dash_ga4_ab_day_idx on public.dash_ga4_ab (day);

-- ---------------------------------------------------------------------------
-- 3. Razorpay: payment attempts, refunds and settlements (live account only)
-- ---------------------------------------------------------------------------
create table if not exists public.dash_rzp_payments (
  id                text primary key,              -- pay_…
  rzp_order_id      text,                          -- order_… = orders.razorpay_order_id
  created_at        timestamptz not null,
  day               date not null,                 -- India date of the attempt
  status            text not null,                 -- created | authorized | captured | refunded | failed
  method            text,                          -- upi | card | netbanking | wallet | emi | …
  amount            numeric(12,2) not null default 0,
  fee               numeric(12,2) not null default 0,  -- Razorpay's fee, its GST included
  tax               numeric(12,2) not null default 0,  -- the GST part of the fee
  amount_refunded   numeric(12,2) not null default 0,
  captured          boolean not null default false,
  error_code        text,
  error_reason      text,
  error_source      text,
  error_step        text,
  error_description text,
  upi_flow          text,                          -- intent | collect | …
  settlement_id     text,
  settled_at        timestamptz,
  updated_at        timestamptz not null default now()
);
create index if not exists dash_rzp_payments_day_idx on public.dash_rzp_payments (day);
create index if not exists dash_rzp_payments_order_idx on public.dash_rzp_payments (rzp_order_id);

create table if not exists public.dash_rzp_refunds (
  id         text primary key,                     -- rfnd_…
  payment_id text,
  created_at timestamptz not null,
  day        date not null,
  amount     numeric(12,2) not null default 0,
  status     text
);

create table if not exists public.dash_rzp_settlements (
  id         text primary key,                     -- setl_…
  created_at timestamptz not null,
  day        date not null,
  amount     numeric(12,2) not null default 0,     -- paid into the bank
  fees       numeric(12,2) not null default 0,
  tax        numeric(12,2) not null default 0,
  status     text,
  utr        text                                  -- the bank's reference
);

-- ---------------------------------------------------------------------------
-- 4. Costs entered by hand, and the profit margin
-- ---------------------------------------------------------------------------
-- An amount covers every day from starts_on to ends_on and is spread evenly
-- over them (₹3,000 for 1–30 Nov counts ₹100 a day). 'marketing' counts as ad
-- spend (influencers, Google Ads, a shoot for ads); 'other' only reduces
-- profit (packaging, software). Amounts are without GST, like Meta's spend.
create table if not exists public.dash_expenses (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('marketing', 'other')),
  label      text not null check (length(btrim(label)) between 1 and 80),
  amount     numeric(12,2) not null check (amount > 0 and amount < 10000000),
  starts_on  date not null,
  ends_on    date not null,
  note       text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dash_expenses_dates_chk check (ends_on >= starts_on and ends_on - starts_on <= 366)
);

create table if not exists public.dash_settings (
  id         boolean primary key default true check (id),   -- exactly one row
  margin_pct numeric(5,2) not null default 30 check (margin_pct > 0 and margin_pct < 100),
  updated_at timestamptz not null default now()
);
insert into public.dash_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Each sync run: when, what it read, what failed, Meta's prepaid balance
-- ---------------------------------------------------------------------------
create table if not exists public.dash_sync_runs (
  id          bigint generated always as identity primary key,
  trigger     text not null check (trigger in ('schedule', 'owner')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  range_from  date,
  range_to    date,
  ok          boolean,
  sources     jsonb not null default '{}'::jsonb,   -- { meta: {ok, rows, error}, ga4: …, razorpay: … }
  info        jsonb not null default '{}'::jsonb    -- { meta_account: {currency, spend_cap, amount_spent} }
);
create index if not exists dash_sync_runs_started_idx on public.dash_sync_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- 6. Who may see and change what
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'dash_meta_daily', 'dash_meta_slices', 'dash_ga4_daily', 'dash_ga4_items', 'dash_ga4_ab',
    'dash_rzp_payments', 'dash_rzp_refunds', 'dash_rzp_settlements',
    'dash_expenses', 'dash_settings', 'dash_sync_runs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('drop policy if exists "owner can read" on public.%I', t);
    execute format('create policy "owner can read" on public.%I for select to authenticated using (public.is_admin())', t);
  end loop;
end $$;

grant insert (kind, label, amount, starts_on, ends_on, note),
      update (kind, label, amount, starts_on, ends_on, note),
      delete
  on table public.dash_expenses to authenticated;

drop policy if exists "owner can add costs" on public.dash_expenses;
create policy "owner can add costs" on public.dash_expenses
  for insert to authenticated with check (public.is_admin());
drop policy if exists "owner can change costs" on public.dash_expenses;
create policy "owner can change costs" on public.dash_expenses
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "owner can delete costs" on public.dash_expenses;
create policy "owner can delete costs" on public.dash_expenses
  for delete to authenticated using (public.is_admin());

grant update (margin_pct) on table public.dash_settings to authenticated;
drop policy if exists "owner can change settings" on public.dash_settings;
create policy "owner can change settings" on public.dash_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop trigger if exists set_dash_expenses_updated_at on public.dash_expenses;
create trigger set_dash_expenses_updated_at
before update on public.dash_expenses
for each row execute function public.set_updated_at();

drop trigger if exists set_dash_settings_updated_at on public.dash_settings;
create trigger set_dash_settings_updated_at
before update on public.dash_settings
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. The sync's write path: replace a range of days in one table, atomically
-- ---------------------------------------------------------------------------
-- Meta and GA4 rows have no stable identity of their own (GA4 revises a day's
-- numbers and splits), so a run deletes the days it re-read and inserts what
-- the API returned, in one transaction: the owner never sees a half-written
-- day. Only the sync (service role) may call it, and only for these tables.
create or replace function public.dash_replace_days(p_table text, p_from date, p_to date, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare
  n integer;
begin
  if p_table not in ('dash_meta_daily', 'dash_meta_slices', 'dash_ga4_daily', 'dash_ga4_items', 'dash_ga4_ab') then
    raise exception 'dash_replace_days: % is not a dashboard table', p_table;
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'dash_replace_days: bad range % – %', p_from, p_to;
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'dash_replace_days: rows must be an array';
  end if;
  execute format('delete from public.%I where day between $1 and $2', p_table) using p_from, p_to;
  execute format(
    'insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1) r where r.day between $2 and $3',
    p_table, p_table
  ) using p_rows, p_from, p_to;
  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function public.dash_replace_days(text, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.dash_replace_days(text, date, date, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 8. The admin page's GA4 reads: filtered and summed in the database
-- ---------------------------------------------------------------------------
-- p_filters: { channel, ads: [ad names], device, browser, visitor }, each
-- optional. Test visits (Tag Assistant, Ads Manager previews) and visits from
-- outside India are always left out, as in every analysis since 14 Nov
-- (insights log #19), and counted separately as 'left_out'.
-- part = 'day'      one row per day and step
--        'ad'       one row per ad name (key) and step, for the whole range
--        'channel'  one row per channel (key) and step
--        'source'   one row per source / medium (key) and step
--        'left_out' visits left out, key 'test' or 'abroad'
create or replace function public.dash_ga4_rollup(p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns table (part text, day date, event_name text, key text, users bigint, events bigint)
language sql stable security invoker set search_path = public, pg_temp
as $function$
  with f as (
    select g.*
    from public.dash_ga4_daily g
    where g.day between p_from and p_to
      and (coalesce(p_filters->>'channel', '') = '' or g.channel = p_filters->>'channel')
      and (jsonb_typeof(p_filters->'ads') is distinct from 'array'
           or g.ad_content in (select jsonb_array_elements_text(p_filters->'ads')))
      and (coalesce(p_filters->>'device', '') = '' or g.device = p_filters->>'device')
      and (coalesce(p_filters->>'browser', '') = '' or g.browser = p_filters->>'browser')
      and (coalesce(p_filters->>'visitor', '') = '' or g.visitor = p_filters->>'visitor')
  ),
  kept as (
    select * from f where f.channel <> 'test' and f.country = 'India'
  )
  select 'day', k.day, k.event_name, null::text, sum(k.users)::bigint, sum(k.events)::bigint
    from kept k group by k.day, k.event_name
  union all
  select 'ad', null::date, k.event_name, k.ad_content, sum(k.users)::bigint, sum(k.events)::bigint
    from kept k group by k.event_name, k.ad_content
  union all
  select 'channel', null::date, k.event_name, k.channel, sum(k.users)::bigint, sum(k.events)::bigint
    from kept k group by k.event_name, k.channel
  union all
  select 'source', null::date, k.event_name, k.source_medium, sum(k.users)::bigint, sum(k.events)::bigint
    from kept k where k.event_name = 'session_start' group by k.event_name, k.source_medium
  union all
  select 'left_out', null::date, f.event_name,
         case when f.channel = 'test' then 'test' else 'abroad' end,
         sum(f.users)::bigint, sum(f.events)::bigint
    from f where not (f.channel <> 'test' and f.country = 'India')
    group by f.event_name, case when f.channel = 'test' then 'test' else 'abroad' end
$function$;

-- One A/B version ("aa_check" / "b"): people per step per day.
create or replace function public.dash_ga4_ab_rollup(p_from date, p_to date, p_test text, p_variant text)
returns table (day date, event_name text, users bigint, events bigint)
language sql stable security invoker set search_path = public, pg_temp
as $function$
  select a.day, a.event_name, sum(a.users)::bigint, sum(a.events)::bigint
  from public.dash_ga4_ab a
  where a.day between p_from and p_to
    and position(',' || p_test || ':' || p_variant || ',' in ',' || a.ab_tests || ',') > 0
  group by a.day, a.event_name
$function$;

-- The A/B versions GA4 has seen, for the filter list.
create or replace function public.dash_ab_versions()
returns table (version text)
language sql stable security invoker set search_path = public, pg_temp
as $function$
  select distinct btrim(v)
  from public.dash_ga4_ab a, unnest(string_to_array(a.ab_tests, ',')) v
  where btrim(v) ~ '^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
  order by 1
$function$;

-- Products: totals per product for the range; with p_item, that product per day.
create or replace function public.dash_ga4_items_rollup(p_from date, p_to date, p_item text default null)
returns table (day date, item_name text, viewed bigint, added bigint, checked_out bigint, purchased bigint, revenue numeric)
language sql stable security invoker set search_path = public, pg_temp
as $function$
  select null::date, i.item_name, sum(i.viewed)::bigint, sum(i.added)::bigint, sum(i.checked_out)::bigint,
         sum(i.purchased)::bigint, sum(i.revenue)
    from public.dash_ga4_items i
   where i.day between p_from and p_to
   group by i.item_name
  union all
  select i.day, i.item_name, sum(i.viewed)::bigint, sum(i.added)::bigint, sum(i.checked_out)::bigint,
         sum(i.purchased)::bigint, sum(i.revenue)
    from public.dash_ga4_items i
   where p_item is not null and i.day between p_from and p_to and i.item_name = p_item
   group by i.day, i.item_name
$function$;

revoke all on function public.dash_ga4_rollup(date, date, jsonb) from public, anon;
revoke all on function public.dash_ga4_ab_rollup(date, date, text, text) from public, anon;
revoke all on function public.dash_ab_versions() from public, anon;
revoke all on function public.dash_ga4_items_rollup(date, date, text) from public, anon;
grant execute on function public.dash_ga4_rollup(date, date, jsonb) to authenticated, service_role;
grant execute on function public.dash_ga4_ab_rollup(date, date, text, text) to authenticated, service_role;
grant execute on function public.dash_ab_versions() to authenticated, service_role;
grant execute on function public.dash_ga4_items_rollup(date, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Every hour: ask the sync function to run
-- ---------------------------------------------------------------------------
-- Same pattern as the order emails (20261021160000): the URL and the shared
-- secret live in the vault, never in this file. A missing entry or a refused
-- request only raises a warning.
create or replace function public.dash_request_sync()
returns void
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'dashboard_sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'dashboard_sync_secret';
  if v_url is null or v_secret is null then
    raise warning 'dashboard sync is not configured: the vault holds no url/secret';
    return;
  end if;
  perform net.http_post(
    url                  := v_url,
    headers              := jsonb_build_object('Content-Type', 'application/json', 'x-dashboard-sync-secret', v_secret),
    body                 := jsonb_build_object('trigger', 'schedule'),
    timeout_milliseconds := 120000
  );
exception when others then
  raise warning 'could not request the dashboard sync: %', sqlerrm;
end $function$;

revoke all on function public.dash_request_sync() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

select cron.schedule('dashboard-sync-hourly', '7 * * * *', 'select public.dash_request_sync()');

commit;
