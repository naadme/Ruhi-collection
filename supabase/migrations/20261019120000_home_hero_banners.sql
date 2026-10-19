-- Ruhi Collection — homepage hero banners, managed from the admin panel.
--
-- The hero's right half has always been a photo slider. Until now its photos
-- were hard-coded category images in src/data/images.js; this table lets the
-- authorised admin upload, replace, reorder and remove them without editing
-- source code. The storefront keeps its exact layout, styling, arrows and
-- fade animation — only the source of the photos changes.
--
-- Design notes
--  * Backward compatible: the table starts EMPTY, and the homepage falls back
--    to the original category-photo slider whenever no banner rows are saved,
--    so the live site looks and behaves exactly as before until the client
--    actually saves a banner.
--  * Banner images are uploaded to the EXISTING public `product-images`
--    bucket with the EXISTING storage policies, so no bucket and no storage
--    policy change is required.
--  * Public READ (the homepage is public), admin-only WRITE through RLS —
--    the exact pattern `public.products` already uses. Product managers
--    cannot touch banners; only `admins` members can.

create table if not exists public.banners (
  id         uuid primary key default gen_random_uuid(),
  slot       text not null default 'home_hero' check (slot = 'home_hero'),
  image      text not null check (char_length(btrim(image)) between 1 and 2000),
  link       text check (link is null or char_length(btrim(link)) between 1 and 300),
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_banners_updated_at on public.banners;
create trigger set_banners_updated_at
before update on public.banners
for each row execute function public.set_updated_at();

alter table public.banners enable row level security;

-- Everyone may read the banner list (the homepage is public). No browser role
-- gets blanket write access — the policies below gate every write to admins.
revoke all on table public.banners from anon;
grant  select on table public.banners to anon;
grant  select, insert, update, delete on table public.banners to authenticated;
grant  all on table public.banners to service_role;

drop policy if exists "public can view banners" on public.banners;
create policy "public can view banners"
  on public.banners for select
  using (true);

drop policy if exists "admins can create banners" on public.banners;
create policy "admins can create banners"
  on public.banners for insert to authenticated
  with check (public.is_admin());

drop policy if exists "admins can update banners" on public.banners;
create policy "admins can update banners"
  on public.banners for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins can delete banners" on public.banners;
create policy "admins can delete banners"
  on public.banners for delete to authenticated
  using (public.is_admin());
