-- Ruhi Collection — admin dashboard: products table, admin authorisation, storage.
--
-- Nothing here touches newsletter_subscribers or contact_messages: their
-- existing RLS policies are deliberately left untouched.
--
-- Storefront contract, kept in step with
-- 20261001090000_womens_client_catalogue.sql (the current catalogue migration):
--   id, title, gender('women' only), type('tops'|'coord'|'dress'),
--   price, compare, rating, reviews, image, hover, badge, sizes,
--   desc(->description), plus is_active for visibility; gallery text[] is
--   added by the migration named above.
--
-- The store is women-only and no demo catalogue is seeded here: the real
-- products are inserted, from the client's own photos, by the migration
-- named above.

-- ---------------------------------------------------------------------------
-- 1. Products
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id           text primary key,
  title        text not null check (length(trim(title)) > 0),
  gender       text not null default 'women' check (gender = 'women'),
  type         text not null default 'tops' check (type in ('tops', 'coord', 'dress')),
  price        integer not null check (price >= 0),
  compare      integer check (compare is null or compare >= 0),
  rating       numeric(4,1) not null default 0,
  reviews      integer not null default 0,
  image        text,
  hover        text,
  badge        text,
  sizes        text[] not null default '{S,M,L,XL}',
  description  text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Admin allowlist
--    Membership here is the *only* thing that grants product write access.
--    Being signed in is not enough, so a customer who creates an account
--    through Supabase Auth gets no admin capability whatsoever.
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER so policies can read `admins` without recursing into its RLS.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()))
$$;

grant execute on function public.is_admin() to anon, authenticated, service_role;

-- Provisioning helper. EXECUTE is revoked from every API role on purpose:
-- only the postgres owner (Supabase SQL editor / `supabase db query`) may call
-- it, otherwise any signed-in user could promote someone else to admin.
create or replace function public.make_admin(target_email text) returns boolean
language plpgsql security definer set search_path = public, auth
as $$
declare target_id uuid;
begin
  select id into target_id from auth.users where lower(email) = lower(target_email);
  if target_id is null then
    raise exception 'No Supabase Auth user found with email "%". Create the user first.', target_email;
  end if;
  insert into public.admins (user_id, email)
  values (target_id, lower(target_email))
  on conflict (user_id) do update set email = lower(target_email);
  return true;
end $$;

revoke execute on function public.make_admin(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. RLS — products
-- ---------------------------------------------------------------------------
alter table public.products enable row level security;
alter table public.admins   enable row level security;

-- Public storefront: active products only. An admin additionally sees hidden
-- ones, so the dashboard can list and restore them.
drop policy if exists "public can view active products" on public.products;
create policy "public can view active products"
  on public.products for select
  using (is_active = true or public.is_admin());

drop policy if exists "admins can create products" on public.products;
create policy "admins can create products"
  on public.products for insert to authenticated
  with check (public.is_admin());

drop policy if exists "admins can update products" on public.products;
create policy "admins can update products"
  on public.products for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins can delete products" on public.products;
create policy "admins can delete products"
  on public.products for delete to authenticated
  using (public.is_admin());

-- Admins may read their own record (used to show admin-only UI).
-- No INSERT/UPDATE/DELETE policy: only the postgres owner can manage it.
drop policy if exists "admins can read own record" on public.admins;
create policy "admins can read own record"
  on public.admins for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Storage — product images
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "public can view product images" on storage.objects;
create policy "public can view product images"
  on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists "admins can upload product images" on storage.objects;
create policy "admins can upload product images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "admins can update product images" on storage.objects;
create policy "admins can update product images"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "admins can delete product images" on storage.objects;
create policy "admins can delete product images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

-- ---------------------------------------------------------------------------
-- 5. Realtime so storefronts that are already open update immediately
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.products;
exception
  when duplicate_object then null;  -- already a member
  when undefined_object  then null; -- publication absent on this project
  when others            then null; -- non-critical, never fail the migration
end $$;


-- ---------------------------------------------------------------------------
-- 6. Seed
-- ---------------------------------------------------------------------------
-- No demo catalogue is seeded here. This migration used to insert 16 stock
-- demo rows (placeholder stock photos and sample products); that seed block
-- has been removed so no fake product exists anywhere in this repo.
-- The store is women-only and is seeded with the client's real photos by
-- 20261001090000_womens_client_catalogue.sql, which deletes every existing
-- row before inserting, so this file staying seed-free is safe both for a
-- fresh database and for one that has already been migrated.
