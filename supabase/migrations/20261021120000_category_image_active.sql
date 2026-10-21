-- Ruhi Collection — a category's photograph can be switched off.
--
-- The category photos panel already lets the owner choose which picture a
-- category shows. What it could not do was turn that picture off: the only
-- way to stop a photograph being used was to clear it, and clearing it threw
-- the choice away — there was no way to switch it back on without choosing it
-- again.
--
-- This adds one column:
--
--   * `categories.image_active` — true when the category's own photograph is
--     the one the site shows, false when it is switched off. A category whose
--     photograph is off keeps its products, its name, its place in the
--     navigation and its Product ID code; the site simply falls back to the
--     photograph that ships with the shop (or the first product photo in that
--     category), exactly as it does for a category that has no photograph of
--     its own.
--
-- The column defaults to true, so every category behaves exactly as it did
-- before this migration: the six categories in the shop today all keep their
-- current photographs, and a photograph that is switched off can be switched
-- on again without being chosen again.
--
-- Nothing is deleted, nothing is renamed, and no order, product, order line
-- or stored image file is touched. The table's own row-level security is
-- unchanged — the storefront still reads the categories, and only an admin
-- may write them.

begin;

alter table public.categories
  add column if not exists image_active boolean not null default true;

commit;
