-- Ruhi Collection — Night Wear and Kurta Sets.
--
-- The two categories the client asked for by name, alongside the four the
-- store already had.
--
-- `categories` is the client's own list: the header dropdown, the footer's
-- shop links, the shop's Type filter, the admin panel's category picker and
-- the homepage's "Shop by Category" row all read it, so a category added here
-- appears everywhere at once and can never disagree between screens.
--
-- The keys are exactly what the admin panel's own key derivation produces for
-- these labels ("Night Wear" → "night-wear"), so a category created there
-- later and one created here are the same category, not two.
--
-- The products table points at this table with a foreign key
-- (`products_type_fkey`), so products may now be filed under either of them
-- with no further change.
--
-- Additive and reversible: `delete from public.categories where key in
-- ('night-wear', 'kurta-sets')` undoes it, and no product is touched either
-- way (no product uses these two keys yet).

insert into public.categories (key, label, position)
values ('night-wear', 'Night Wear', 4),
       ('kurta-sets', 'Kurta Sets', 5)
on conflict (key) do update
  set label = excluded.label,
      position = excluded.position;
