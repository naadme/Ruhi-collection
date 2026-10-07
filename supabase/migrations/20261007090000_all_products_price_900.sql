-- Ruhi Collection — every catalogue product is priced at ₹900.
--
-- `public.products.price` is the only price this store trusts: the storefront
-- renders it and `create_order()` re-reads it server-side, so no client can
-- send its own amount. This one statement therefore reprices all 42 rows at
-- once, and nothing else — no other column, constraint, policy, trigger or
-- function is touched, and no existing migration is edited.

update public.products
 set price = 900
 where price is distinct from 900;
