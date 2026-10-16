-- Ruhi Collection — explicit product colours + the "Trousers & Pants" category.
--
-- The admin panel now manages a design as one parent product with colour
-- variants, where each variant is one `products` row — the same flat data model
-- the storefront has always grouped. This migration gives that workflow the two
-- things the schema was missing:
--
--   1. `colour` — the colour text the client types. The title keeps its
--      " - Colour" suffix (the format the storefront grouping reads), so no
--      title, id, URL, image path, price or order reference changes.
--   2. `type` gains 'trousers' for the new "Trousers & Pants" category.
--
-- Nothing existing is rewritten. The colour column is backfilled ONLY where a
-- title already ends in a colour word the storefront itself recognises; every
-- other row keeps colour = NULL and is grouped by its title exactly as before.
-- Row Level Security, admin/product-manager permissions, storage policies,
-- orders and customer data are untouched.
--
-- Safe and reversible: the whole file runs in one transaction, the column add
-- and the constraint swap are idempotent, and the revert is at the bottom.

begin;

-- 1. One explicit colour per row. NULL simply means "no colour stored" — the
--    title suffix (the previous and still fully supported source) keeps
--    working, which is what lets the storefront group old and new rows alike.
alter table public.products add column if not exists colour text;

-- 2. Backfill from titles that already end in a known colour word — the same
--    list src/lib/productGrouping.js uses, kept deliberately in step with it.
--    No guessing: a suffix outside that list stays NULL, so this migration can
--    never group two rows the storefront did not already group.
do $$
declare
  w text;
begin
  foreach w in array array[
    'Babypink', 'Beige', 'Black', 'Blue', 'Brown', 'Grey', 'Maroon',
    'Neon Green', 'Olive Green', 'Orange', 'Pink', 'Purple', 'Red',
    'Royalblue', 'Sky Blue', 'White', 'Yellow'
  ] loop
    update public.products
       set colour = w
     where colour is null
       and right(title, length(' - ' || w)) = ' - ' || w;
  end loop;
end $$;

-- 3. The fourth category. The check constraint on `type` is found by column
--    (the technique 20261001090000_womens_client_catalogue.sql already uses),
--    so this works whatever the constraint happens to be called. Adding the
--    replacement validates every existing row — all of which are
--    'tops' | 'coord' | 'dress' — so it always passes on today's catalogue.
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

alter table public.products
  add constraint products_type_check
  check (type in ('tops', 'coord', 'dress', 'trousers'));

commit;

-- ---------------------------------------------------------------------------
-- To revert (run as the database owner, after moving any 'trousers' rows):
--
--   begin;
--   alter table public.products drop constraint if exists products_type_check;
--   alter table public.products add constraint products_type_check
--     check (type in ('tops', 'coord', 'dress'));
--   alter table public.products drop column if exists colour;
--   commit;
--
-- Dropping the column loses only the explicit colour text; every title still
-- carries its " - Colour" suffix, so the store groups exactly as before.
-- ---------------------------------------------------------------------------
