-- Ruhi Collection — women-only catalogue built from the client's
-- "Product Images" folder (Tops&Shirts / Coord sets / Dresses).
--
-- Replaces whatever demo catalogue exists with the 42 real products (52 photos)
-- and makes the minimum schema changes the real catalogue needs:
--   * type check constraint -> the three client categories
--   * new gallery column     -> every photo of a product, main image first
--   * gender                -> 'women' only, by default and by constraint
--
-- Everything runs in one transaction: either the whole new catalogue lands or
-- nothing changes and the store keeps serving whatever it had before.
--
-- Prices/ratings/reviews/badges/descriptions are 0/empty on purpose: the client
-- folder has photos and names only. Fill them in through /admin later.

begin;

-- 1. Structural changes, safe with any rows already in the table.
alter table public.products add column if not exists gallery text[];
alter table public.products alter column gender set default 'women';

-- 2. Clear the old catalogue. This has to happen before the two check
--    constraints below: PostgreSQL validates existing rows when a check
--    constraint is added, and the demo rows use the old category names.
delete from public.products;

-- 3 + 4. The store's own constraints: the three client categories, and
--    women-only. The old check constraints are found by column rather than by
--    name (pg_constraint), so this works whatever they happen to be called.
--    Both are added while the table is empty, so nothing can fail validation.
do $$
declare
  v_col  text;
  v_con  text;
  v_drop text[] := array[]::text[];
begin
  -- First collect the constraint names (reading the catalog only) ...
  foreach v_col in array array['type', 'gender'] loop
    for v_con in
      select c.conname
        from pg_constraint c
       where c.conrelid = 'public.products'::regclass
         and c.contype = 'c'
         and c.conkey = array (
               select a.attnum
                 from pg_attribute a
                where a.attrelid = c.conrelid
                  and a.attname = v_col)
    loop
      v_drop := v_drop || v_con;
    end loop;
  end loop;

  -- ... then drop them, one statement at a time.
  foreach v_con in array v_drop loop
    execute format('alter table public.products drop constraint %I', v_con);
  end loop;
end $$;

alter table public.products add constraint products_type_check
  check (type in ('tops', 'coord', 'dress'));

alter table public.products add constraint products_gender_check
  check (gender = 'women');

-- 5. The real catalogue: 42 products from 52 client photos.
insert into public.products
  (id, title, gender, type, price, compare, rating, reviews,
   image, hover, gallery, badge, sizes, description, is_active)
values
  ('denim-shirt-black', 'Denim Shirt - Black', 'women', 'tops', 0, null, 0, 0,
   '/images/products/denim-shirt-black.jpg', '/images/products/denim-shirts.jpg', '{"/images/products/denim-shirt-black.jpg","/images/products/denim-shirts.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('denim-shirt-blue', 'Denim Shirt - Blue', 'women', 'tops', 0, null, 0, 0,
   '/images/products/denim-shirt-blue.jpg', '/images/products/denim-shirt-blue.jpg', '{"/images/products/denim-shirt-blue.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('panda-tshirt-black', 'Panda Tshirt - Black', 'women', 'tops', 0, null, 0, 0,
   '/images/products/panda-tshirt-black.jpg', '/images/products/panda-tshirts.jpg', '{"/images/products/panda-tshirt-black.jpg","/images/products/panda-tshirts.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('panda-tshirt-white', 'Panda Tshirt - White', 'women', 'tops', 0, null, 0, 0,
   '/images/products/panda-tshirt-white.jpg', '/images/products/panda-tshirt-white.jpg', '{"/images/products/panda-tshirt-white.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('acid-wash-coord-set-beige', 'Acid wash coord set - Beige', 'women', 'coord', 0, null, 0, 0,
   '/images/products/acid-wash-coord-set-beige.jpg', '/images/products/acid-wash-coord-set-beige.jpg', '{"/images/products/acid-wash-coord-set-beige.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('acid-wash-coord-set-brown', 'Acid wash coord set - Brown', 'women', 'coord', 0, null, 0, 0,
   '/images/products/acid-wash-coord-set-brown.jpg', '/images/products/acid-wash-coord-set-brown.jpg', '{"/images/products/acid-wash-coord-set-brown.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('acid-wash-coord-set-grey', 'Acid wash coord set - Grey', 'women', 'coord', 0, null, 0, 0,
   '/images/products/acid-wash-coord-set-grey.jpg', '/images/products/acid-wash-coord-set-grey.jpg', '{"/images/products/acid-wash-coord-set-grey.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('acid-wash-coord-set-maroon', 'Acid wash coord set - Maroon', 'women', 'coord', 0, null, 0, 0,
   '/images/products/acid-wash-coord-set-maroon.jpg', '/images/products/acid-wash-coord-set-maroon.jpg', '{"/images/products/acid-wash-coord-set-maroon.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('acid-wash-coord-set-olive-green', 'Acid wash coord set - Olive Green', 'women', 'coord', 0, null, 0, 0,
   '/images/products/acid-wash-coord-set-olive-green.jpg', '/images/products/acid-wash-coord-set-olive-green.jpg', '{"/images/products/acid-wash-coord-set-olive-green.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('denim-pant-coord-set-black', 'Denim pant coord set - Black', 'women', 'coord', 0, null, 0, 0,
   '/images/products/denim-pant-coord-set-black.jpg', '/images/products/denim-pant-coord-set-black.jpg', '{"/images/products/denim-pant-coord-set-black.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('denim-pant-coord-set-brown', 'Denim pant coord set - Brown', 'women', 'coord', 0, null, 0, 0,
   '/images/products/denim-pant-coord-set-brown.jpg', '/images/products/denim-pant-coord-set-brown.jpg', '{"/images/products/denim-pant-coord-set-brown.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('denim-pant-coord-set-orange', 'Denim pant coord set - Orange', 'women', 'coord', 0, null, 0, 0,
   '/images/products/denim-pant-coord-set-orange.jpg', '/images/products/denim-pant-coord-set-orange.jpg', '{"/images/products/denim-pant-coord-set-orange.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('denim-pant-coord-set-pink', 'Denim pant coord set - Pink', 'women', 'coord', 0, null, 0, 0,
   '/images/products/denim-pant-coord-set-pink.jpg', '/images/products/denim-pant-coord-set-pink.jpg', '{"/images/products/denim-pant-coord-set-pink.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('denim-pant-coord-set-purple', 'Denim pant coord set - Purple', 'women', 'coord', 0, null, 0, 0,
   '/images/products/denim-pant-coord-set-purple.jpg', '/images/products/denim-pant-coord-set-purple.jpg', '{"/images/products/denim-pant-coord-set-purple.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('denim-pant-coord-set-yellow', 'Denim pant coord set - Yellow', 'women', 'coord', 0, null, 0, 0,
   '/images/products/denim-pant-coord-set-yellow.jpg', '/images/products/denim-pant-coord-set-yellow.jpg', '{"/images/products/denim-pant-coord-set-yellow.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('embroidery-coord-set-beige', 'Embroidery coord set - Beige', 'women', 'coord', 0, null, 0, 0,
   '/images/products/embroidery-coord-set-beige.jpg', '/images/products/embroidery-coord-set-beige2.jpg', '{"/images/products/embroidery-coord-set-beige.jpg","/images/products/embroidery-coord-set-beige2.jpg","/images/products/embroidery-coord-set-beige3.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('embroidery-coord-set-black', 'Embroidery coord set - Black', 'women', 'coord', 0, null, 0, 0,
   '/images/products/embroidery-coord-set-black.jpg', '/images/products/embroidery-coord-set-black2.jpg', '{"/images/products/embroidery-coord-set-black.jpg","/images/products/embroidery-coord-set-black2.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('embroidery-coord-set-blue', 'Embroidery coord set - Blue', 'women', 'coord', 0, null, 0, 0,
   '/images/products/embroidery-coord-set-blue.jpg', '/images/products/embroidery-coord-set-blue2.jpg', '{"/images/products/embroidery-coord-set-blue.jpg","/images/products/embroidery-coord-set-blue2.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('embroidery-coord-set-orange', 'Embroidery coord set - Orange', 'women', 'coord', 0, null, 0, 0,
   '/images/products/embroidery-coord-set-orange.jpg', '/images/products/embroidery-coord-set-orange2.jpg', '{"/images/products/embroidery-coord-set-orange.jpg","/images/products/embroidery-coord-set-orange2.jpg","/images/products/embroidery-coord-set-orange3.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('pulkadot-coord-set-pink', 'Pulkadot coord set - Pink', 'women', 'coord', 0, null, 0, 0,
   '/images/products/pulkadot-coord-set-pink.jpg', '/images/products/pulkadot-coord-set-pink.jpg', '{"/images/products/pulkadot-coord-set-pink.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('pulkadot-coord-set-purple', 'Pulkadot coord set - Purple', 'women', 'coord', 0, null, 0, 0,
   '/images/products/pulkadot-coord-set-purple.jpg', '/images/products/pulkadot-coord-set-purple.jpg', '{"/images/products/pulkadot-coord-set-purple.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('shirt-pant-coord-set-black', 'Shirt pant coord set - Black', 'women', 'coord', 0, null, 0, 0,
   '/images/products/shirt-pant-coord-set-black.jpg', '/images/products/shirt-pant-coord-set-black2.jpg', '{"/images/products/shirt-pant-coord-set-black.jpg","/images/products/shirt-pant-coord-set-black2.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('shirt-pant-coord-set-brown', 'Shirt pant coord set - Brown', 'women', 'coord', 0, null, 0, 0,
   '/images/products/shirt-pant-coord-set-brown.jpg', '/images/products/shirt-pant-coord-set-brown2.jpg', '{"/images/products/shirt-pant-coord-set-brown.jpg","/images/products/shirt-pant-coord-set-brown2.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('shirt-pant-coord-set-neon-green', 'Shirt pant coord set - Neon Green', 'women', 'coord', 0, null, 0, 0,
   '/images/products/shirt-pant-coord-set-neon-green.jpg', '/images/products/shirt-pant-coord-set-neon-green.jpg', '{"/images/products/shirt-pant-coord-set-neon-green.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('shirt-pant-coord-set-purple', 'Shirt pant coord set - Purple', 'women', 'coord', 0, null, 0, 0,
   '/images/products/shirt-pant-coord-set-purple.jpg', '/images/products/shirt-pant-coord-set-purple.jpg', '{"/images/products/shirt-pant-coord-set-purple.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('shirt-pant-coord-set-red', 'Shirt pant coord set - Red', 'women', 'coord', 0, null, 0, 0,
   '/images/products/shirt-pant-coord-set-red.jpg', '/images/products/shirt-pant-coord-set-red.jpg', '{"/images/products/shirt-pant-coord-set-red.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('shirt-pant-coord-set-sky-blue', 'Shirt pant coord set - Sky Blue', 'women', 'coord', 0, null, 0, 0,
   '/images/products/shirt-pant-coord-set-sky-blue.jpg', '/images/products/shirt-pant-coord-set-sky-blue.jpg', '{"/images/products/shirt-pant-coord-set-sky-blue.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('shirt-pant-coord-set-yellow', 'Shirt pant coord set - Yellow', 'women', 'coord', 0, null, 0, 0,
   '/images/products/shirt-pant-coord-set-yellow.jpg', '/images/products/shirt-pant-coord-set-yellow.jpg', '{"/images/products/shirt-pant-coord-set-yellow.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('shorts-and-shirt-babypink', 'Shorts and Shirt - Babypink', 'women', 'coord', 0, null, 0, 0,
   '/images/products/shorts-and-shirt-babypink.jpg', '/images/products/shorts-and-shirt-babypink.jpg', '{"/images/products/shorts-and-shirt-babypink.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('shorts-and-shirt-blue', 'Shorts and Shirt - Blue', 'women', 'coord', 0, null, 0, 0,
   '/images/products/shorts-and-shirt-blue.jpg', '/images/products/shorts-and-shirt-blue.jpg', '{"/images/products/shorts-and-shirt-blue.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('shorts-and-shirt-maroon', 'Shorts and Shirt - Maroon', 'women', 'coord', 0, null, 0, 0,
   '/images/products/shorts-and-shirt-maroon.jpg', '/images/products/shorts-and-shirt-maroon.jpg', '{"/images/products/shorts-and-shirt-maroon.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('shorts-and-shirt-olive-green', 'Shorts and Shirt - Olive Green', 'women', 'coord', 0, null, 0, 0,
   '/images/products/shorts-and-shirt-olive-green.jpg', '/images/products/shorts-and-shirt-olive-green.jpg', '{"/images/products/shorts-and-shirt-olive-green.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('shorts-and-shirt-orange', 'Shorts and Shirt - Orange', 'women', 'coord', 0, null, 0, 0,
   '/images/products/shorts-and-shirt-orange.jpg', '/images/products/shorts-and-shirt-orange.jpg', '{"/images/products/shorts-and-shirt-orange.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('shorts-and-shirt-royalblue', 'Shorts and Shirt - Royalblue', 'women', 'coord', 0, null, 0, 0,
   '/images/products/shorts-and-shirt-royalblue.jpg', '/images/products/shorts-and-shirt-royalblue.jpg', '{"/images/products/shorts-and-shirt-royalblue.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('solid-coord-set-red', 'Solid Coord set - Red', 'women', 'coord', 0, null, 0, 0,
   '/images/products/solid-coord-set-red.jpg', '/images/products/solid-coord-set-red.jpg', '{"/images/products/solid-coord-set-red.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('solid-shirtpant-set-orange', 'Solid Shirtpant set - Orange', 'women', 'coord', 0, null, 0, 0,
   '/images/products/solid-shirtpant-set-orange.jpg', '/images/products/solid-shirtpant-set-orange.jpg', '{"/images/products/solid-shirtpant-set-orange.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('solid-shirtpant-set-royalblue', 'Solid Shirtpant set - Royalblue', 'women', 'coord', 0, null, 0, 0,
   '/images/products/solid-shirtpant-set-royalblue.jpg', '/images/products/solid-shirtpant-set-royalblue.jpg', '{"/images/products/solid-shirtpant-set-royalblue.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('denim-dress', 'Denim Dress', 'women', 'dress', 0, null, 0, 0,
   '/images/products/denim-dress1.jpg', '/images/products/denim-dress1.jpg', '{"/images/products/denim-dress1.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('stripes-dress-blue', 'Stripes Dress - Blue', 'women', 'dress', 0, null, 0, 0,
   '/images/products/stripes-dress-blue.jpg', '/images/products/stripes-dress-blue.jpg', '{"/images/products/stripes-dress-blue.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('stripes-dress-brown', 'Stripes Dress - Brown', 'women', 'dress', 0, null, 0, 0,
   '/images/products/stripes-dress-brown.jpg', '/images/products/stripes-dress-brown.jpg', '{"/images/products/stripes-dress-brown.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('stripes-dress-pink', 'Stripes Dress - Pink', 'women', 'dress', 0, null, 0, 0,
   '/images/products/stripes-dress-pink.jpg', '/images/products/stripes-dress-pink.jpg', '{"/images/products/stripes-dress-pink.jpg"}',
   null, '{S,M,L,XL}', '', true),
  ('stripes-dress-yellow', 'Stripes Dress - Yellow', 'women', 'dress', 0, null, 0, 0,
   '/images/products/stripes-dress-yellow.jpg', '/images/products/stripes-dress-yellow.jpg', '{"/images/products/stripes-dress-yellow.jpg"}',
   null, '{S,M,L,XL}', '', true)
on conflict (id) do nothing;

commit;
