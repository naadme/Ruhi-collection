-- Ruhi Collection — one fixed ID per design, shared by all of its colours.
--
-- The shop keeps one row per colour ("Cotton Dress - Pink", "Cotton Dress -
-- Blue"), each with its own Product ID (0306PI, 0309BU), and the storefront
-- groups the colours into one product page by their category and design name
-- (src/lib/productGrouping.js). Nothing stored said "these rows are one
-- design", and Google Merchant Center, Meta's catalogue and GA4 all need
-- exactly that: an `item_group_id` shared by every colour and size of a
-- design (tracking brief, Section 3). An ID worked out from the name would
-- change whenever the owner renamed a design, so the ID is STORED instead:
--
--   products.design_id    e.g. 03-CD-01
--
--   * 03  the category's code, the same two digits the Product IDs start with
--   * CD  the initials of the design name (Cotton Dress), up to four letters,
--         skipping "and", "with", "of", "the", "a", "an"
--   * 01  a running number, so two designs with the same initials in one
--         category never share an ID (Solid Shirt and Pant Combo is
--         02-SSPC-01, Stripe shirt and pant combo 02-SSPC-02)
--
-- The database assigns it, the first time a design is saved, and never
-- changes it again: not when the design is renamed, recoloured or moved to
-- another category, and not when an edit sends a different value. A new
-- colour of a design already on file — same category, same design name, the
-- storefront's own rule — receives that design's ID. Every ID ever issued is
-- recorded in `design_ids`, so a number is never reused, even after its
-- design is deleted.
--
-- The ID is a label, not a description: "Cotton Dress" renamed "Linen Dress"
-- stays 03-CD-01. Merging or splitting designs is a developer's job, done with
-- the trigger switched off for that one statement:
--
--   alter table public.products disable trigger products_assign_design_id;
--   update public.products set design_id = '…' where id in (…);
--   alter table public.products enable trigger products_assign_design_id;

begin;

alter table public.products
  add column if not exists design_id text;

create table if not exists public.design_ids (
  design_id  text primary key,
  created_at timestamptz not null default now()
);
alter table public.design_ids enable row level security;
revoke all on table public.design_ids from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The storefront's rule for a row's design name, in SQL
-- ---------------------------------------------------------------------------
-- Mirrors `partsOf()` in src/lib/productGrouping.js exactly: the colour is the
-- row's `colour` column, else a " - Colour" title suffix that is one of the
-- colour words this catalogue uses; the design name is the title without that
-- suffix. NULL means the row names no colour and is a design of its own.
create or replace function public.design_name(p_title text, p_colour text)
returns text
language plpgsql
immutable
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_title  text := coalesce(p_title, '');
  v_colour text := btrim(coalesce(p_colour, ''));
  v_suffix text;
  v_name   text;
begin
  if v_colour = '' then
    v_suffix := btrim(substring(v_title from '^.* - (.*)$'));
    if v_suffix in ('Babypink', 'Beige', 'Black', 'Blue', 'Brown', 'Grey', 'Maroon',
                    'Neon Green', 'Olive Green', 'Orange', 'Pink', 'Purple', 'Red',
                    'Royalblue', 'Sky Blue', 'White', 'Yellow') then
      v_colour := v_suffix;
    end if;
  end if;
  if v_colour = '' then
    return null;
  end if;

  v_suffix := ' - ' || v_colour;
  if right(v_title, length(v_suffix)) = v_suffix then
    v_name := btrim(left(v_title, length(v_title) - length(v_suffix)));
  else
    v_name := btrim(v_title);
  end if;
  return coalesce(nullif(v_name, ''), nullif(btrim(v_title), ''), v_colour);
end $function$;

create or replace function public.design_initials(p_name text)
returns text
language sql
immutable
set search_path = 'public', 'pg_temp'
as $function$
  select coalesce(nullif(left(string_agg(upper(left(w, 1)), '' order by n), 4), ''), 'X')
    from regexp_split_to_table(coalesce(p_name, ''), '[^A-Za-z0-9]+') with ordinality as t(w, n)
   where w <> '' and lower(w) not in ('and', 'with', 'of', 'the', 'a', 'an')
$function$;

-- The next unused ID for a category and a name. Callers hold the lock below.
create or replace function public.next_design_id(p_type text, p_name text)
returns text
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_prefix text;
  v_next   integer;
begin
  select c.code into v_prefix
    from public.categories c
   where c.key = btrim(coalesce(p_type, ''));
  v_prefix := coalesce(nullif(v_prefix, ''), '00') || '-' || public.design_initials(p_name);

  select coalesce(max(substring(d.design_id from '([0-9]+)$')::integer), 0) + 1
    into v_next
    from public.design_ids d
   where d.design_id ~ ('^' || v_prefix || '-[0-9]+$');

  insert into public.design_ids (design_id) values (v_prefix || '-' || lpad(v_next::text, 2, '0'));
  return v_prefix || '-' || lpad(v_next::text, 2, '0');
end $function$;

-- ---------------------------------------------------------------------------
-- Today's designs, oldest first
-- ---------------------------------------------------------------------------
-- Giving a product its ID is not an edit, so `updated_at` is left alone.
alter table public.products disable trigger set_products_updated_at;

do $backfill$
declare
  g    record;
  v_id text;
begin
  perform pg_advisory_xact_lock(hashtext('ruhi.collection.design_id'));
  for g in
    select p.type,
           public.design_name(p.title, p.colour) as name,
           min(p.title) as title,
           array_agg(p.id) as ids
      from public.products p
     where p.design_id is null
     group by p.type,
              public.design_name(p.title, p.colour),
              case when public.design_name(p.title, p.colour) is null then p.id end
     order by min(p.created_at), min(p.id)
  loop
    -- Issued once per design, then given to every one of its colours: called
    -- inside the UPDATE it would issue a fresh number for each row.
    v_id := public.next_design_id(g.type, coalesce(g.name, g.title));
    update public.products set design_id = v_id where id = any (g.ids);
  end loop;
end
$backfill$;

alter table public.products enable trigger set_products_updated_at;

-- ---------------------------------------------------------------------------
-- Every save from now on
-- ---------------------------------------------------------------------------
create or replace function public.assign_design_id()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_name text;
  v_id   text;
begin
  -- Once given, never rewritten.
  if tg_op = 'UPDATE' and old.design_id is not null then
    new.design_id := old.design_id;
    return new;
  end if;

  v_name := public.design_name(new.title, new.colour);
  perform pg_advisory_xact_lock(hashtext('ruhi.collection.design_id'));

  -- A new colour of a design already on file joins that design.
  if v_name is not null then
    select p.design_id into v_id
      from public.products p
     where p.design_id is not null
       and p.id is distinct from new.id
       and p.type is not distinct from new.type
       and public.design_name(p.title, p.colour) = v_name
     order by p.created_at
     limit 1;
  end if;

  new.design_id := coalesce(v_id, public.next_design_id(new.type, coalesce(v_name, new.title)));
  return new;
end $function$;

drop trigger if exists products_assign_design_id on public.products;
create trigger products_assign_design_id
before insert or update on public.products
for each row execute function public.assign_design_id();

commit;

-- ---------------------------------------------------------------------------
-- To revert:
--
--   begin;
--   drop trigger if exists products_assign_design_id on public.products;
--   drop function if exists public.assign_design_id();
--   drop function if exists public.next_design_id(text, text);
--   drop function if exists public.design_initials(text);
--   drop function if exists public.design_name(text, text);
--   drop table if exists public.design_ids;
--   alter table public.products drop column if exists design_id;
--   commit;
