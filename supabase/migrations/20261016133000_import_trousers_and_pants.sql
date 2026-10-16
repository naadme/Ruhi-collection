-- Ruhi Collection — import the client's "Trousers & Pants" product folder.
--
-- Three designs from the client's own photographs, following the catalogue's
-- existing shape exactly: one row per colour, the colour named in the title's
-- " - Colour" suffix and repeated in the `colour` column the storefront's
-- grouping reads first (that is what lets "Green", "Rust Orange" and "Peach"
-- group even though those words predate the catalogue's own colour list).
--
--   Korean Pants ............ 5 colours (Beige already exists — adopted below)
--   Mulmul cotton Trousers .. 5 colours + the two "all colours" flat-lays
--   Thick Linen Pants ....... 1 product (one photo showing every colour)
--
-- Everything here is additive and guarded:
--   * every INSERT is `on conflict (id) do nothing` — an id that already
--     exists is left byte-for-byte untouched, so the import can never
--     overwrite a product the owner has since created or edited;
--   * the single UPDATE touches only `type`, `title` and `colour` of the one
--     row this folder already contributed ("Korean Pants- Biege"), and only
--     while its title is still the one being adopted — id, price, compare-at,
--     photos, badge, sizes, rating, review count, description and visibility
--     are never written;
--   * no row is deleted or repriced, and no policy, grant, constraint,
--     function, trigger or bucket is changed.
--
-- `created_at` is written on purpose: all rows of one INSERT would otherwise
-- share now() and the storefront's "oldest row first" order would be a tie.
-- The offsets keep each design's folder order, so the card a shopper sees is
-- photographed by the colour the client lists first.
--
-- PRICES: every colour of Korean Pants keeps the ₹400 / ₹999 the catalogue
-- already sells that design at; Mulmul cotton Trousers and Thick Linen Pants
-- take the store-wide ₹900 (supabase/migrations/20261007090000_all_products_
-- price_900.sql). Change any of them from the admin panel if the client quotes
-- different figures — nothing here is hard-coded anywhere else.

begin;

insert into public.products
  (id, title, gender, type, price, compare, rating, reviews,
   image, hover, badge, sizes, description, is_active, gallery, colour, created_at)
values
  -- Korean Pants — matches the existing "Korean Pants- Biege" row's price.
  ('korean-pants-black', 'Korean Pants - Black', 'women', 'trousers', 400, 999, 0, 0,
   '/images/products/korean-pants-black.jpg', '/images/products/korean-pants-black.jpg', null,
   array['S','M','L','XL'], '', true,
   array['/images/products/korean-pants-black.jpg'], 'Black', now() - interval '10 seconds'),
  ('korean-pants-maroon', 'Korean Pants - Maroon', 'women', 'trousers', 400, 999, 0, 0,
   '/images/products/korean-pants-maroon.jpg', '/images/products/korean-pants-maroon.jpg', null,
   array['S','M','L','XL'], '', true,
   array['/images/products/korean-pants-maroon.jpg'], 'Maroon', now() - interval '9 seconds'),
  ('korean-pants-olive-green', 'Korean Pants - Olive Green', 'women', 'trousers', 400, 999, 0, 0,
   '/images/products/korean-pants-olive-green.jpg', '/images/products/korean-pants-olive-green.jpg', null,
   array['S','M','L','XL'], '', true,
   array['/images/products/korean-pants-olive-green.jpg'], 'Olive Green', now() - interval '8 seconds'),
  ('korean-pants-brown', 'Korean Pants - Brown', 'women', 'trousers', 400, 999, 0, 0,
   '/images/products/korean-pants-brown.jpg', '/images/products/korean-pants-brown.jpg', null,
   array['S','M','L','XL'], '', true,
   array['/images/products/korean-pants-brown.jpg'], 'Brown', now() - interval '7 seconds'),

  -- Mulmul cotton Trousers — the two flat-lay "all colours" photographs ride
  -- in the lead colour's gallery, where the denim shirts' all-colours photo
  -- has always lived.
  ('mulmul-cotton-trousers-blue', 'Mulmul cotton Trousers - Blue', 'women', 'trousers', 900, null, 0, 0,
   '/images/products/mulmul-cotton-trousers-blue.jpg', '/images/products/mulmul-cotton-trousers-blue.jpg', null,
   array['S','M','L','XL'], '', true,
   array['/images/products/mulmul-cotton-trousers-blue.jpg',
         '/images/products/mulmul-cotton-trousers-all-colours1.jpg',
         '/images/products/mulmul-cotton-trousers-all-colours2.jpg'],
   'Blue', now() - interval '6 seconds'),
  ('mulmul-cotton-trousers-white', 'Mulmul cotton Trousers - White', 'women', 'trousers', 900, null, 0, 0,
   '/images/products/mulmul-cotton-trousers-white.jpg', '/images/products/mulmul-cotton-trousers-white.jpg', null,
   array['S','M','L','XL'], '', true,
   array['/images/products/mulmul-cotton-trousers-white.jpg'], 'White', now() - interval '5 seconds'),
  ('mulmul-cotton-trousers-green', 'Mulmul cotton Trousers - Green', 'women', 'trousers', 900, null, 0, 0,
   '/images/products/mulmul-cotton-trousers-green.jpg', '/images/products/mulmul-cotton-trousers-green.jpg', null,
   array['S','M','L','XL'], '', true,
   array['/images/products/mulmul-cotton-trousers-green.jpg'], 'Green', now() - interval '4 seconds'),
  ('mulmul-cotton-trousers-rust-orange', 'Mulmul cotton Trousers - Rust Orange', 'women', 'trousers', 900, null, 0, 0,
   '/images/products/mulmul-cotton-trousers-rust-orange.jpg', '/images/products/mulmul-cotton-trousers-rust-orange.jpg', null,
   array['S','M','L','XL'], '', true,
   array['/images/products/mulmul-cotton-trousers-rust-orange.jpg'], 'Rust Orange', now() - interval '3 seconds'),
  ('mulmul-cotton-trousers-peach', 'Mulmul cotton Trousers - Peach', 'women', 'trousers', 900, null, 0, 0,
   '/images/products/mulmul-cotton-trousers-peach.jpg', '/images/products/mulmul-cotton-trousers-peach.jpg', null,
   array['S','M','L','XL'], '', true,
   array['/images/products/mulmul-cotton-trousers-peach.jpg'], 'Peach', now() - interval '2 seconds'),

  -- Thick Linen Pants — one photograph of every colour together, so it stays a
  -- single product (colour left NULL, the way "Denim Dress" is stored).
  ('thick-linen-pants', 'Thick Linen Pants', 'women', 'trousers', 900, null, 0, 0,
   '/images/products/thick-linen-pants.jpg', '/images/products/thick-linen-pants.jpg', null,
   array['S','M','L','XL'], '', true,
   array['/images/products/thick-linen-pants.jpg'], null, now() - interval '1 second')
on conflict (id) do nothing;

-- Adopt the folder's existing Korean Pants row into its design. Guarded on the
-- exact title being adopted, so a second run — or a row the owner has since
-- renamed — is a no-op.
update public.products
   set type    = 'trousers',
       title   = 'Korean Pants - Beige',
       colour  = 'Beige'
 where id    = 'korean-pants-biege-jpg'
   and title = 'Korean Pants- Biege';

commit;

-- ---------------------------------------------------------------------------
-- To revert (run as the database owner):
--
--   begin;
--   delete from public.products
--    where id in ('korean-pants-black','korean-pants-maroon','korean-pants-olive-green',
--                 'korean-pants-brown','mulmul-cotton-trousers-blue','mulmul-cotton-trousers-white',
--                 'mulmul-cotton-trousers-green','mulmul-cotton-trousers-rust-orange',
--                 'mulmul-cotton-trousers-peach','thick-linen-pants');
--   update public.products
--      set type = 'tops', title = 'Korean Pants- Biege', colour = null
--    where id = 'korean-pants-biege-jpg';
--   commit;
--
-- The delete removes only rows this file created (every one is guarded by
-- `on conflict do nothing`, so an id that was created by hand instead is NOT
-- deleted here... check the list above before running). The photos in
-- public/images/products/ are ordinary build assets; removing the rows leaves
-- them harmlessly unused.
-- ---------------------------------------------------------------------------
