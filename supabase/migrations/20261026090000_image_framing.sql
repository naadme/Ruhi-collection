-- Ruhi Collection — a per-photograph framing for product and category images.
--
-- Product cards, the product gallery, the colour variants and the "Shop by
-- Category" tiles all draw their photograph with `object-fit: cover`, which
-- fills the frame and throws away whatever falls outside it. A portrait
-- photograph in a card therefore loses its head and its hem, and a photograph
-- framed around a model's face can end up showing nothing but fabric. There
-- was no way for the owner to say which part of her own photograph she wanted
-- kept — unlike a homepage banner, which already has its three columns
-- (20261024120000_banner_positioning.sql).
--
-- This adds ONE column to each of two tables:
--
--   * `products.image_framing`
--   * `categories.image_framing`
--
-- Both are jsonb holding a small OBJECT keyed by the photograph's own URL, so
-- a product's main image, its hover image and every photo in its gallery can
-- each be framed in its own way, and each colour row can frame its own
-- photographs independently:
--
--     { "/images/products/foo.jpg": { "x": 50, "y": 20, "z": 1.2 }, ... }
--
--   * `x` — how far across the crop starts, 0 (left edge) to 100 (right).
--   * `y` — the same, 0 (top) to 100 (bottom).
--   * `z` — how much the photograph is enlarged, 1 (not at all) to 2.
--
-- Keyed by URL rather than by index because that is the only key the
-- storefront has: it draws a photograph by its address, and an entry that no
-- longer matches an address simply does not apply, which is the right
-- behaviour when a photograph has been replaced.
--
-- The column is NULLABLE and has no default. A NULL means "this row has never
-- been framed", and every reader treats that as the centre, un-enlarged
-- framing the site has always used — so this migration changes nothing on the
-- page. Existing rows are untouched: no product, price, category, image,
-- hover, gallery, colour, order or status column is written by this file.
--
-- It is jsonb rather than three numeric columns because the unit of framing
-- here is a PHOTOGRAPH, not a row: a row has many photographs, and three
-- columns could only ever describe one of them.
--
-- The table's own row-level security is unchanged: the storefront still reads
-- both tables, and only an admin may write them. There are no column-level
-- grants or revokes on either table, so the new column is covered by the same
-- policies as the columns beside it.
--
-- The check only says "an object or nothing": the browser applies its own
-- bounds when it reads a value, so a row can never be made un-renderable by
-- what is stored here.

begin;

alter table public.products
  add column if not exists image_framing jsonb;

alter table public.categories
  add column if not exists image_framing jsonb;

alter table public.products
  drop constraint if exists products_image_framing_is_object;
alter table public.products
  add constraint products_image_framing_is_object
  check (image_framing is null or jsonb_typeof(image_framing) = 'object');

alter table public.categories
  drop constraint if exists categories_image_framing_is_object;
alter table public.categories
  add constraint categories_image_framing_is_object
  check (image_framing is null or jsonb_typeof(image_framing) = 'object');

commit;
