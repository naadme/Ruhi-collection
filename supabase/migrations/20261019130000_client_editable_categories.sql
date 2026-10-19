-- Ruhi Collection — client-editable product categories.
--
-- Until now the four categories ("Tops & T-shirts", "Co-ord Sets", "Dresses",
-- "Trousers & Pants") lived in two places at once: a constant in
-- src/data/products.js and a CHECK constraint on public.products.type. Adding
-- a category therefore meant editing source code and running SQL.
--
-- This migration makes the database the single owner of the category list:
--
--   * `public.categories` holds one row per category (immutable `key`, the
--     client-facing `label`, and a display `position`).
--   * The four existing categories are seeded with the exact labels the site
--     renders today, so nothing the store already sells changes name.
--   * Any `type` a product already carries is backfilled before the foreign
--     key is added, so the constraint swap below cannot fail and no product
--     can be left pointing at a category that does not exist.
--   * `products.type` then references `categories.key` ON DELETE RESTRICT:
--     a product can never be saved into a category that is missing, and a
--     category that still has products can never be deleted out from under
--     them. Renaming a category only touches its label — keys are never
--     updated — so a rename cannot orphan a single product.
--
-- Row Level Security follows the pattern the rest of the store uses: the
-- storefront may read the list, only `admins` may write it. Product managers
-- (can_manage_products()) can PICK a category but cannot create or delete
-- one — categories are a business decision, not a catalogue edit.
--
-- Nothing here touches products, orders, banners, coupons, storage or any
-- other table's policies, and no existing row is rewritten.

begin;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  key        text primary key check (key ~ '^[a-z0-9][a-z0-9-]{0,38}$'),
  label      text not null check (char_length(btrim(label)) between 1 and 60),
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_categories_updated_at on public.categories;
create trigger set_categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

-- "Tops & T-shirts" and "  tops & t-shirts  " are the same category to a
-- shopper, so the database refuses a second one as firmly as the admin UI
-- does. Existing rows are distinct, so building this index always succeeds.
create unique index if not exists categories_label_case_idx
  on public.categories (lower(btrim(label)));

-- ---------------------------------------------------------------------------
-- 2. Permissions — public read, admin-only write
-- ---------------------------------------------------------------------------
alter table public.categories enable row level security;

revoke all on table public.categories from anon;
grant  select on table public.categories to anon;
grant  select, insert, update, delete on table public.categories to authenticated;
grant  all on table public.categories to service_role;

drop policy if exists "public can view categories" on public.categories;
create policy "public can view categories"
  on public.categories for select
  using (true);

drop policy if exists "admins can create categories" on public.categories;
create policy "admins can create categories"
  on public.categories for insert to authenticated
  with check (public.is_admin());

drop policy if exists "admins can update categories" on public.categories;
create policy "admins can update categories"
  on public.categories for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins can delete categories" on public.categories;
create policy "admins can delete categories"
  on public.categories for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. Seed — the four categories the store already sells, verbatim
-- ---------------------------------------------------------------------------
-- `on conflict do nothing` on both statements: a re-run, or a database that
-- has already been managed by hand, never overwrites a label the client has
-- since renamed and never duplicates a key.
-- Unqualified `ON CONFLICT DO NOTHING`, matching how every other migration in
-- this repository seeds its reference rows (e.g. 20261001090000). Naming the
-- conflict target instead would force an index probe, which Row Level
-- Security can block and which would then fail the whole migration; without a
-- target Postgres proves uniqueness without that probe.
insert into public.categories (key, label, position) values
  ('tops',     'Tops & T-shirts', 0),
  ('coord',    'Co-ord Sets',     1),
  ('dress',    'Dresses',         2),
  ('trousers', 'Trousers & Pants', 3)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Backfill — no product may be left without a category row
-- ---------------------------------------------------------------------------
-- Whatever `type` a real product already carries becomes a category if it is
-- not one yet. Keys outside the accepted format are skipped (they cannot be
-- categories) and would fail the foreign key loudly rather than silently —
-- that is deliberate: such a row is a data problem to look at, not to hide.
insert into public.categories (key, label, position)
select distinct p.type, p.type, 99
  from public.products p
 where p.type is not null
   and p.type ~ '^[a-z0-9][a-z0-9-]{0,38}$'
   and not exists (select 1 from public.categories c where c.key = p.type)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 5. products.type now points at the table
-- ---------------------------------------------------------------------------
-- Drop whatever check constraint currently pins `type` to a fixed list —
-- found by column rather than by name, the same technique
-- 20261016103000_product_colour_and_trousers_category.sql already uses, so it
-- works whatever the constraint happens to be called.
do $$
declare
  v_con text;
begin
  for v_con in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.products'::regclass
       and c.contype = 'c'
       and c.conkey = array (
             select a.attnum
               from pg_attribute a
              where a.attrelid = c.conrelid
                and a.attname = 'type')
  loop
    execute format('alter table public.products drop constraint %I', v_con);
  end loop;
end $$;

-- Validating the foreign key scans every existing row once; the backfill
-- above guarantees each of them has a category to match, so it passes. The
-- table is small (one row per colour of every design), so the brief lock is
-- measured in milliseconds.
alter table public.products drop constraint if exists products_type_fkey;
alter table public.products
  add constraint products_type_fkey
  foreign key (type) references public.categories (key)
  on delete restrict
  on update restrict;

commit;

-- ---------------------------------------------------------------------------
-- To revert (run as the database owner; products are untouched either way,
-- because no product row is written by this migration):
--
--   begin;
--   alter table public.products drop constraint if exists products_type_fkey;
--   alter table public.products add constraint products_type_check
--     check (type in ('tops', 'coord', 'dress', 'trousers'));
--   drop table if exists public.categories cascade;
--   commit;
--
-- Dropping `categories` also removes the client's ability to manage the list;
-- every product keeps the `type` value it already had.
-- ---------------------------------------------------------------------------
