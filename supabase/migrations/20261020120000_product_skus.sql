-- Ruhi Collection — automatic six-character product IDs (SKU).
--
-- Why a NEW column and not `products.id`
-- --------------------------------------
-- `products.id` is the public, immutable product id: it is the primary key,
-- it is the slug in every `/product/...` URL a shopper has bookmarked, it is
-- what a cart line in localStorage points at, it is what the editor locks
-- ("existing links must keep working") and it is the value `order_items`
-- carries as `product_id` for every order ever placed. Replacing it would
-- break all four at once, so the six-character ID is added as a separate,
-- unique `products.sku` — exactly the option the brief allows when an id
-- change would break carts, order history or URLs. Nothing that exists is
-- renamed, and no row is deleted.
--
-- The format: CCPPCL
--   CC   the category code, 01, 02, 03 … stable for the life of the category
--   PP   the product's own number inside that category, 01 … 99
--   CL   a two-letter colour code, e.g. BU for Blue
--
--   0102BU = category 01 (Tops & T-shirts), second product, blue.
--
-- Everything is decided HERE, in the database, not in a browser: a product is
-- given its ID by a BEFORE trigger, so two admins saving at the same moment
-- cannot mint the same number, and an ID is never typed by hand.
--
-- Nothing existing is renumbered. Category codes are assigned once, in the
-- order the categories are already displayed, and are never touched again —
-- renaming a category changes only its label, and adding a category only ever
-- takes the next free code. Colour codes live in their own table so the same
-- colour always gets the same letters, forever.
--
-- Additive and reversible: dropping the three objects below (in the order
-- they are created) restores the schema exactly as it was, with every product,
-- price, image, order and order item intact.

-- ---------------------------------------------------------------------------
-- 1. Colour codes — a stable two-letter code per colour name.
--
-- The key is the colour with every non-letter removed and lower-cased, so the
-- spellings the catalogue already uses ("Royalblue", "Royal Blue", "royal
-- blue") are ONE colour and can never drift apart. RLS is on with no policy:
-- only this migration's SECURITY DEFINER functions and the table's owner can
-- read or write it, so a browser can never invent a code.
-- ---------------------------------------------------------------------------
create table if not exists public.colour_codes (
  colour text primary key,
  label  text not null,
  code   text not null unique,
  created_at timestamptz not null default now(),
  constraint colour_codes_code_format check (code ~ '^[A-Z]{2}$')
);

alter table public.colour_codes enable row level security;

-- The colours this catalogue already ships, in src/lib/productGrouping.js's
-- own list. `blue` is the one deliberate letter-pair override: its first two
-- letters would be BL, which `black` had already taken — the brief fixes Blue
-- as BU, so Black keeps BL.
insert into public.colour_codes (colour, label, code) values
  ('babypink',   'Babypink',   'BA'),
  ('beige',      'Beige',      'BE'),
  ('black',      'Black',      'BL'),
  ('blue',       'Blue',       'BU'),
  ('brown',      'Brown',      'BR'),
  ('grey',       'Grey',       'GR'),
  ('maroon',     'Maroon',     'MA'),
  ('neongreen',  'Neon Green', 'NE'),
  ('olivegreen', 'Olive Green','OL'),
  ('orange',     'Orange',     'OR'),
  ('pink',       'Pink',       'PI'),
  ('purple',     'Purple',     'PU'),
  ('red',        'Red',        'RE'),
  ('royalblue',  'Royalblue',  'RO'),
  ('skyblue',    'Sky Blue',   'SK'),
  ('white',      'White',      'WH'),
  ('yellow',     'Yellow',     'YE')
on conflict (colour) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Category codes.
-- ---------------------------------------------------------------------------
alter table public.categories
  add column if not exists code text;

create unique index if not exists categories_code_key
  on public.categories (code)
  where code is not null;

create or replace function public.next_category_code()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  next_num integer;
begin
  -- One lock for the whole table: two admins creating categories at the same
  -- moment take turns instead of both reading the same maximum.
  perform pg_advisory_xact_lock(hashtext('ruhi.collection.category_code'));

  select coalesce(max(nullif(btrim(code), '')::integer), 0) + 1
    into next_num
    from public.categories
   where code ~ '^[0-9]+$';

  if next_num > 99 then
    raise exception 'Every two-digit category code is in use, so no more categories can be numbered. Please contact support.'
      using errcode = 'P0001';
  end if;

  return lpad(next_num::text, 2, '0');
end;
$$;

create or replace function public.assign_category_code()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  -- A code is only ever APPLIED, never rewritten: an UPDATE that supplies one
  -- keeps it, and an UPDATE that supplies none keeps the old one. Adding or
  -- renaming a category can therefore never renumber anything.
  if new.code is null or btrim(new.code) = '' then
    new.code := public.next_category_code();
  end if;
  return new;
end;
$$;

drop trigger if exists categories_assign_code on public.categories;
create trigger categories_assign_code
  before insert on public.categories
  for each row execute function public.assign_category_code();

-- The four categories the store launched with, numbered in the order they are
-- already displayed — Tops & T-shirts = 01, Co-ord Sets = 02, Dresses = 03,
-- Trousers & Pants = 04. Only rows with no code yet are touched, so this
-- statement can never renumber a category it has already numbered.
do $$
declare
  row record;
  next_num integer := 1;
begin
  for row in
    select key from public.categories where code is null order by position, key
  loop
    update public.categories set code = lpad(next_num::text, 2, '0') where key = row.key;
    next_num := next_num + 1;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The colour code itself.
--
-- A colour already on file keeps its code forever. A colour the store has
-- never seen is given the first pair of its letters that nobody holds — so
-- "Bright Pink" gets BI and, when "Bright Red" arrives and BI is gone, BG —
-- and the answer is written down immediately, which is what stops a code from
-- ever moving.
-- ---------------------------------------------------------------------------
create or replace function public.sku_colour_code(p_colour text, p_title text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  key    text;
  label  text;
  letters text;
  i      integer;
  j      integer;
  cand   text;
begin
  -- No colour column: fall back to the " - Colour" suffix the catalogue has
  -- always carried in its titles.
  label := nullif(btrim(coalesce(p_colour, '')), '');
  if label is null then
    label := nullif(btrim(substring(coalesce(p_title, '') from '.* - (.*)$')), '');
  end if;

  -- Explicitly and safely "no colour recorded". It is a documented placeholder
  -- (XX), not a guess at what the product might be.
  if label is null then
    return 'XX';
  end if;

  key := lower(regexp_replace(label, '[^A-Za-z]', '', 'g'));
  if key = '' then
    return 'XX';
  end if;

  -- One row per colour, however it was spelled the first time.
  perform pg_advisory_xact_lock(hashtext('ruhi.collection.colour_code'));

  select c.code into cand from public.colour_codes c where c.colour = key;
  if cand is not null then
    return cand;
  end if;

  letters := upper(regexp_replace(label, '[^A-Za-z]', '', 'g'));
  if length(letters) < 2 then
    letters := rpad(letters, 2, 'X');
  end if;

  for i in 1 .. length(letters) - 1 loop
    for j in i + 1 .. length(letters) loop
      cand := substr(letters, i, 1) || substr(letters, j, 1);
      if not exists (select 1 from public.colour_codes c where c.code = cand) then
        insert into public.colour_codes (colour, label, code)
        values (key, label, cand)
        on conflict (colour) do nothing;
        return cand;
      end if;
    end loop;
  end loop;

  raise exception 'The colour “%” cannot be given a two-letter code — every pair of its letters is already used. Please rename the colour.', label
    using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The product number inside a category, 01 … 99.
-- ---------------------------------------------------------------------------
create or replace function public.next_product_number(p_code text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  next_num integer;
begin
  -- Locked per category, so two products added at the same instant in the same
  -- category take different numbers.
  perform pg_advisory_xact_lock(hashtext('ruhi.collection.product_sku'), hashtext(p_code));

  select coalesce(max(substr(sku, 3, 2)::integer), 0) + 1
    into next_num
    from public.products
   where sku ~ ('^' || p_code || '[0-9]{2}[A-Z]{2}$');

  -- Two digits are all the format has. Failing loudly beats quietly writing
  -- an ID that no longer means what the format says it means.
  if next_num > 99 then
    raise exception 'This category already holds 99 products, which is the most a six-character product ID can hold. Remove an unused product or add a new category before adding another.'
      using errcode = 'P0001';
  end if;

  return lpad(next_num::text, 2, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. products.sku, and the trigger that owns it.
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists sku text;

create unique index if not exists products_sku_key
  on public.products (sku)
  where sku is not null;

create or replace function public.assign_product_sku()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cat_code  text;
  colour_cl text;
  num       text;
  wanted    text;
begin
  select coalesce(c.code, '00') into cat_code
    from public.categories c
   where c.key = coalesce(btrim(coalesce(new.type, '')), '');

  -- '00' says "this product's category has no code" — never invented as a
  -- real category, because real codes start at 01.
  if cat_code is null or cat_code = '' then
    cat_code := '00';
  end if;

  colour_cl := public.sku_colour_code(new.colour, new.title);

  if new.sku is null or btrim(new.sku) = '' then
    -- A brand-new product: the next number in its category, once and for all.
    new.sku := cat_code || public.next_product_number(cat_code) || colour_cl;
    return new;
  end if;

  -- An existing product: the number it was given is kept, and only the parts
  -- that describe what it IS now are refreshed — so changing a colour updates
  -- its colour letters, and moving it to another category updates its category
  -- letters, without the product ever losing its place in the sequence.
  num := substr(new.sku, 3, 2);
  if num !~ '^[0-9]{2}$' then
    num := public.next_product_number(cat_code);
  end if;

  wanted := cat_code || num || colour_cl;

  -- Never take an ID somebody else already holds: if the refreshed value
  -- collides, the product moves to the next free number instead.
  if wanted <> new.sku
    and exists (select 1 from public.products p where p.sku = wanted and p.id <> new.id) then
    num := public.next_product_number(cat_code);
    wanted := cat_code || num || colour_cl;
  end if;

  new.sku := wanted;
  return new;
end;
$$;

drop trigger if exists products_assign_sku on public.products;
create trigger products_assign_sku
  before insert or update of type, colour, title, sku on public.products
  for each row execute function public.assign_product_sku();

-- ---------------------------------------------------------------------------
-- 6. Backfill.
--
-- Every existing product is numbered once, oldest first, in its own category.
-- Nothing else about a row is written: id, title, price, images, description,
-- visibility and every order that names the product are untouched.
-- ---------------------------------------------------------------------------
do $$
declare
  row      record;
  cat_code text;
  next_num integer;
begin
  for row in
    select p.id, p.type, p.colour, p.title
      from public.products p
     where p.sku is null
     order by p.created_at, p.id
  loop
    select coalesce(c.code, '00') into cat_code
      from public.categories c
     where c.key = coalesce(btrim(coalesce(row.type, '')), '');
    if cat_code is null or cat_code = '' then
      cat_code := '00';
    end if;

    select coalesce(max(substr(sku, 3, 2)::integer), 0) + 1
      into next_num
      from public.products
     where sku ~ ('^' || cat_code || '[0-9]{2}[A-Z]{2}$');

    if next_num > 99 then
      raise exception 'Category % would need a product number above 99.', cat_code
        using errcode = 'P0001';
    end if;

    update public.products p
       set sku = cat_code || lpad(next_num::text, 2, '0') || public.sku_colour_code(row.colour, row.title)
     where p.id = row.id;
  end loop;
end;
$$;

-- Every row now carries an ID, so the column can be made compulsory: a future
-- write that somehow skipped the trigger fails loudly instead of quietly
-- leaving a product without an ID.
alter table public.products alter column sku set not null;

comment on column public.products.sku is
  'Six-character display ID (CC category, PP product number in that category, CL colour). Assigned by the database, never typed, never reused.';
