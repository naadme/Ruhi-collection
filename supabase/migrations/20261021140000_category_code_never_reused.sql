-- A category code is never given to a second category.
--
-- The Product ID of a product is CCPPCL: the category's own code, then the
-- product's number in that category, then the colour's letters. The code is
-- meant to be stable for the life of the category, and the number it shares
-- with its own category's products is what makes it meaningful.
--
-- The counter that hands out the next code took the highest code the
-- `categories` table held and added one to it. That is right while every
-- category ever created is still there — but a category can be deleted once
-- it holds no products, and the moment it is, its code became free again.
-- A category added later would then be given the same code, and its
-- products would carry the same Product IDs as the products of the deleted
-- category — whose order history still shows them.
--
-- The counter now takes the highest code that has EVER been used, not only
-- the highest code still in use: the codes on the category rows, the codes
-- on the products, and the codes in the order lines' own snapshot of the
-- Product ID at the time of the order.
--
-- Nothing existing is renumbered. The six categories in the shop keep the
-- codes they have. Only a category added from now on can be affected, and
-- only by being given a code that collides with an old one — which is
-- exactly what this prevents.

begin;

create or replace function public.next_category_code()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_num integer;
begin
  -- One lock for the whole table: two admins creating categories at the same
  -- moment take turns instead of both reading the same maximum.
  perform pg_advisory_xact_lock(hashtext('ruhi.collection.category_code'));

  -- The highest code ever used, in any of the three places a code can be
  -- seen: the categories themselves, the products, and the Product ID every
  -- order line carries as a snapshot of what it was when the order was
  -- placed.
  select coalesce(max(used), 0) + 1
    into next_num
    from (
      select nullif(btrim(code), '')::integer as used
        from public.categories
       where code ~ '^[0-9]+$'
      union all
      select substr(sku, 1, 2)::integer
        from public.products
       where sku ~ '^[0-9]{2}[0-9]{2}[A-Z]{2}$'
      union all
      select substr(sku, 1, 2)::integer
        from public.order_items
       where sku ~ '^[0-9]{2}[0-9]{2}[A-Z]{2}$'
    ) as codes;

  if next_num > 99 then
    raise exception 'Every two-digit category code is in use, so no more categories can be numbered. Please contact support.'
      using errcode = 'P0001';
  end if;

  return lpad(next_num::text, 2, '0');
end;
$$;

commit;
