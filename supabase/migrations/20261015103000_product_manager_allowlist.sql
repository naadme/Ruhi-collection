-- Give a collaborator the smallest admin-panel role: catalogue management.
--
-- This is intentionally separate from public.admins. Existing admins retain
-- their order-management access, while product managers can only manage
-- products and product images. A caller must already exist in auth.users;
-- the provisioning function resolves the id by email so no UUID is embedded
-- in this repository or migration.

create table if not exists public.product_managers (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);

alter table public.product_managers enable row level security;

-- The collaborator needs only enough table privilege to read their own
-- allowlist row. RLS below supplies the row-level restriction; no browser role
-- receives a write grant.
revoke all on table public.product_managers from anon, authenticated;
grant select on table public.product_managers to authenticated;
grant all on table public.product_managers to service_role;

drop policy if exists "product managers can read own record" on public.product_managers;
create policy "product managers can read own record"
  on public.product_managers for select to authenticated
  using (user_id = (select auth.uid()));

-- This predicate is used only by catalogue and product-image policies.
-- `admins` remain catalogue managers, preserving the owner's current access.
create or replace function public.can_manage_products() returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin()
      or exists (
        select 1
        from public.product_managers pm
        where pm.user_id = (select auth.uid())
      )
$$;

grant execute on function public.can_manage_products() to anon, authenticated, service_role;

-- Deliberately unavailable to every browser/API role. Run it only as the
-- database owner in Supabase SQL Editor after the person has signed in once.
create or replace function public.make_product_manager(target_email text) returns boolean
language plpgsql security definer set search_path = public, auth
as $$
declare target_id uuid;
begin
  select id into target_id
  from auth.users
  where lower(email) = lower(trim(target_email));

  if target_id is null then
    raise exception 'No Supabase Auth user found with email "%". Have that account sign in with Google first.', target_email;
  end if;

  insert into public.product_managers (user_id, email)
  values (target_id, lower(trim(target_email)))
  on conflict (user_id) do update set email = excluded.email;
  return true;
end $$;

revoke execute on function public.make_product_manager(text)
  from public, anon, authenticated, service_role;

-- Replace only catalogue policies. Order policies remain based on is_admin(),
-- so a product manager cannot read or update customers' orders.
drop policy if exists "admins can create products" on public.products;
create policy "catalogue managers can create products"
  on public.products for insert to authenticated
  with check (public.can_manage_products());

drop policy if exists "admins can update products" on public.products;
create policy "catalogue managers can update products"
  on public.products for update to authenticated
  using (public.can_manage_products()) with check (public.can_manage_products());

drop policy if exists "admins can delete products" on public.products;
create policy "catalogue managers can delete products"
  on public.products for delete to authenticated
  using (public.can_manage_products());

drop policy if exists "public can view active products" on public.products;
create policy "catalogue managers can view products"
  on public.products for select
  using (is_active = true or public.can_manage_products());

drop policy if exists "admins can upload product images" on storage.objects;
create policy "catalogue managers can upload product images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.can_manage_products());

drop policy if exists "admins can update product images" on storage.objects;
create policy "catalogue managers can update product images"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.can_manage_products())
  with check (bucket_id = 'product-images' and public.can_manage_products());

drop policy if exists "admins can delete product images" on storage.objects;
create policy "catalogue managers can delete product images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.can_manage_products());
