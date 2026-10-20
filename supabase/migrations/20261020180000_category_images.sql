-- Ruhi Collection — a photo for each category.
--
-- The homepage's "Shop by Category" row used to take its pictures from a
-- hardcoded map in the source code, so the only way to change them was a code
-- change and a redeployment. This column is that missing piece: the photo the
-- tile shows, stored with the category.
--
--   * NULL means "the default photo" — the storefront keeps showing exactly
--     what it shows today, so nothing changes until the owner chooses;
--   * a path or a URL means "this photo", and the storefront uses it in
--     preference to the default.
--
-- The column is read by the public (the tiles are public) and written only
-- by admins (the existing `categories` RLS already gates every write on
-- is_admin()), so no policy has to change.
--
-- Additive and reversible: `alter table ... drop column` restores the table
-- exactly as it was, and no row is rewritten by this migration.

alter table public.categories
  add column if not exists image text;

comment on column public.categories.image is
  'The photo the homepage "Shop by Category" tile shows. NULL = the default photo.';
