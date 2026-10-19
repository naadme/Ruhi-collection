-- Ruhi Collection — admin-managed Best Sellers row on the homepage.
--
-- Until now the Best Sellers row was never chosen by anyone: the homepage
-- derived it at render time by round-robining one style per category out of
-- the live catalogue. That always looked tidy, but the owner had no way to
-- put a particular design in the shop window.
--
-- This migration makes the choice explicit, following exactly the pattern
-- `public.banners` and `public.categories` already use:
--
--   * `public.bestsellers` holds one row per promoted product, with the
--     display `position` the admin decides.
--   * The table starts EMPTY. The storefront falls back to the previous
--     category-round-robin whenever the owner has not chosen anything, so the
--     homepage looks exactly as it does today until a pick is saved.
--   * Rows point at EXISTING `public.products` ids — nothing is copied and no
--     product is invented. `on delete cascade` means deleting a product
--     tidies up its own promotion row, so a deleted design can never leave
--     the homepage pointing at a missing product.
--   * Public READ (the homepage is public), admin-only WRITE through RLS —
--     the same shape `public.banners` uses. Product managers cannot promote
--     products; that is a shop-window decision, not a catalogue edit.
--
-- No product, order, price or image is touched by this migration.

begin;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists public.bestsellers (
  -- `public.products.id` is a text slug, so the key is text to match it.
  product_id text primary key
              references public.products (id) on delete cascade,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Permissions — public read, admin-only write
-- ---------------------------------------------------------------------------
alter table public.bestsellers enable row level security;

revoke all on table public.bestsellers from anon;
grant  select on table public.bestsellers to anon;
grant  select, insert, update, delete on table public.bestsellers to authenticated;
grant  all on table public.bestsellers to service_role;

drop policy if exists "public can view bestsellers" on public.bestsellers;
create policy "public can view bestsellers"
  on public.bestsellers for select
  using (true);

drop policy if exists "admins can create bestsellers" on public.bestsellers;
create policy "admins can create bestsellers"
  on public.bestsellers for insert to authenticated
  with check (public.is_admin());

drop policy if exists "admins can update bestsellers" on public.bestsellers;
create policy "admins can update bestsellers"
  on public.bestsellers for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins can delete bestsellers" on public.bestsellers;
create policy "admins can delete bestsellers"
  on public.bestsellers for delete to authenticated
  using (public.is_admin());

commit;

-- ---------------------------------------------------------------------------
-- To revert (products are untouched either way — this migration writes none):
--
--   drop table if exists public.bestsellers;
--
-- The homepage immediately returns to deriving the row from the catalogue.
-- ---------------------------------------------------------------------------
