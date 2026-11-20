-- Sold out (20 Nov 2026): Sold_Out_Proposal_2026-11-20.html, release 1.
--
-- Two states, no counting: each colour row, in each size, is either in stock
-- or sold out. The owner marks a size sold out when its last piece goes
-- (on the site, on Instagram or on WhatsApp) and taps it back when it
-- returns. Everything else follows from the mark:
--
--   * the shop keeps a sold-out page open and sells something else from it;
--   * lists, search and recommendations leave sold-out items out;
--   * the product feed sends "out_of_stock", so Meta and Google stop showing
--     the item in catalog ads;
--   * new orders refuse a sold-out size (this file, section 5);
--   * the admin is alerted when a whole colour sells out, and reminded after
--     24 hours to point any ad at a colour in stock (section 3). Nothing here
--     edits an ad: the owner's decision of 20 Nov 2026.
--
-- "Hidden" (is_active = false) keeps its meaning: we stopped selling it.
--
-- Nothing changes for shoppers until a size is marked. To undo the release,
-- promote the previous deployment; the column below is harmless unused.

begin;

-- ---- 1. The marks ----------------------------------------------------------
-- Per colour row, the sizes that have run out. Always a subset of `sizes`
-- (the trigger below keeps it so). The shop already reads `select *`, so no
-- page makes a new request for it.
alter table public.products
  add column if not exists sold_out_sizes text[] not null default '{}';

-- Only sizes the colour is made in, each once, in the colour's own size
-- order. A size taken off the range takes its mark with it, so a size that
-- comes back to the range comes back in stock.
create or replace function public.products_tidy_sold_out()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.sold_out_sizes := array(
    select s
    from unnest(coalesce(new.sizes, '{}'::text[])) with ordinality as t(s, ord)
    where s = any (coalesce(new.sold_out_sizes, '{}'::text[]))
    group by s
    order by min(ord)
  );
  return new;
end $$;

drop trigger if exists products_tidy_sold_out on public.products;
create trigger products_tidy_sold_out
  before insert or update of sizes, sold_out_sizes on public.products
  for each row execute function public.products_tidy_sold_out();

-- ---- 2. Marking: one atomic change per tap ----------------------------------
-- Adds or removes sizes on ONE row in a single statement, so a product edit
-- left open on another phone can never undo a mark (the editor never sends
-- `sold_out_sizes`). Security invoker: the products update policy decides
-- who may do it, exactly as for every other product edit.
create or replace function public.set_sold_out(p_id text, p_sizes text[], p_sold_out boolean)
returns public.products
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.products%rowtype;
begin
  if not public.can_manage_products() then
    raise exception 'This account is not allowed to change stock. Sign in with the store owner account and retry.'
      using errcode = '42501';
  end if;
  if p_sizes is null or cardinality(p_sizes) = 0 then
    raise exception 'Choose a size to mark.';
  end if;

  update public.products p
     set sold_out_sizes = case
           when p_sold_out then p.sold_out_sizes || p_sizes
           else array(select s from unnest(p.sold_out_sizes) as s where not (s = any (p_sizes)))
         end
   where p.id = p_id
  returning p.* into v_row;

  if not found then
    raise exception 'That product was not found. Refresh the page and try again.';
  end if;
  return v_row;
end $$;

revoke all on function public.set_sold_out(text, text[], boolean) from public, anon;
grant execute on function public.set_sold_out(text, text[], boolean) to authenticated;

-- ---- 3. The admin alert: a whole colour sold out ----------------------------
-- One row per live colour that is sold out in every size, from the moment it
-- became so. The dashboard shows it at once; after 24 hours it becomes a
-- reminder to point any ad at the best colour in stock. The owner closes it
-- when done. A colour back in stock (any size), hidden or deleted loses its
-- row, so a later sell-out starts a fresh alert.
create table if not exists public.sold_out_alerts (
  product_id  text primary key references public.products (id) on delete cascade,
  sold_out_at timestamptz not null default now(),
  closed_at   timestamptz
);

alter table public.sold_out_alerts enable row level security;
revoke all on table public.sold_out_alerts from anon, authenticated;
grant select on table public.sold_out_alerts to authenticated;
grant update (closed_at) on table public.sold_out_alerts to authenticated;
grant all on table public.sold_out_alerts to service_role;

drop policy if exists "catalogue managers can read sold-out alerts" on public.sold_out_alerts;
create policy "catalogue managers can read sold-out alerts"
  on public.sold_out_alerts for select to authenticated
  using (public.can_manage_products());

drop policy if exists "catalogue managers can close sold-out alerts" on public.sold_out_alerts;
create policy "catalogue managers can close sold-out alerts"
  on public.sold_out_alerts for update to authenticated
  using (public.can_manage_products()) with check (public.can_manage_products());

create or replace function public.products_sold_out_alert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_active
     and cardinality(new.sizes) > 0
     and new.sizes <@ new.sold_out_sizes then
    insert into public.sold_out_alerts (product_id) values (new.id)
    on conflict (product_id) do nothing;
  else
    delete from public.sold_out_alerts where product_id = new.id;
  end if;
  return null;
end $$;

drop trigger if exists products_sold_out_alert on public.products;
create trigger products_sold_out_alert
  after insert or update of sizes, sold_out_sizes, is_active on public.products
  for each row execute function public.products_sold_out_alert();

-- ---- 4. The change log: which size was sold out, and when -------------------
-- For measuring (proposal section 13): which pages were sold out and when,
-- so orders that started on a sold-out page can be counted. Written only by
-- the trigger; read by catalogue managers.
create table if not exists public.stock_changes (
  id          bigint generated always as identity primary key,
  product_id  text not null,
  size        text not null,
  sold_out    boolean not null,
  changed_at  timestamptz not null default now(),
  changed_by  uuid
);

create index if not exists stock_changes_product_idx on public.stock_changes (product_id, changed_at);

alter table public.stock_changes enable row level security;
revoke all on table public.stock_changes from anon, authenticated;
grant select on table public.stock_changes to authenticated;
grant all on table public.stock_changes to service_role;

drop policy if exists "catalogue managers can read stock changes" on public.stock_changes;
create policy "catalogue managers can read stock changes"
  on public.stock_changes for select to authenticated
  using (public.can_manage_products());

create or replace function public.products_log_stock_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into public.stock_changes (product_id, size, sold_out, changed_by)
    select new.id, s, true, v_uid from unnest(new.sold_out_sizes) as s;
    return null;
  end if;

  insert into public.stock_changes (product_id, size, sold_out, changed_by)
  select new.id, s, true, v_uid
  from unnest(new.sold_out_sizes) as s
  where not (s = any (old.sold_out_sizes));

  -- A mark that left with its size (taken off the range) is not "back in
  -- stock", so only sizes the colour still offers are logged as back.
  insert into public.stock_changes (product_id, size, sold_out, changed_by)
  select new.id, s, false, v_uid
  from unnest(old.sold_out_sizes) as s
  where not (s = any (new.sold_out_sizes))
    and s = any (new.sizes);
  return null;
end $$;

drop trigger if exists products_log_stock_change on public.products;
create trigger products_log_stock_change
  after insert or update of sold_out_sizes on public.products
  for each row execute function public.products_log_stock_change();

-- ---- 5. Orders refuse a sold-out size ----------------------------------------
-- Every order line is written by create_order(), on the first attempt and on
-- every retry of an unpaid one. Checking here, as the line goes in, covers
-- all of them without restating that function. The message reaches the
-- shopper as it is (create-razorpay-order passes P0001 messages through), and
-- the checkout reloads the catalogue when it sees "sold out", so the line
-- turns into a sold-out line and the rest of the cart can be paid.
-- An order created before the mark is not affected: only new lines are checked.
create or replace function public.order_items_refuse_sold_out()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text;
begin
  select p.title into v_title
  from public.products p
  where p.id = new.product_id
    and new.size = any (p.sold_out_sizes);

  if found then
    raise exception '% in size % has just sold out. Remove it from your cart to order the rest.', v_title, new.size;
  end if;
  return new;
end $$;

drop trigger if exists order_items_refuse_sold_out on public.order_items;
create trigger order_items_refuse_sold_out
  before insert on public.order_items
  for each row execute function public.order_items_refuse_sold_out();

commit;
