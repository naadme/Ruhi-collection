-- Record the migrations that have already been applied to this project.
--
-- The migrations were applied through the Management API rather than with the
-- Supabase CLI, so the platform's own ledger stopped at 20261016133000. Every
-- migration after that one has been applied to the database — the objects are
-- all there — but the ledger did not know it.
--
-- That matters because `supabase db push` decides what to run from this
-- ledger. Left as it was, a future push would replay ten migrations that have
-- already run, including the ones that move data: the order-ID backfill
-- would rewrite every order's `previous_reference` (the old "RCH-…" number
-- it is supposed to preserve) and the catalogue import would touch products
-- again. Recording them keeps the ledger honest and makes the next push a
-- no-op.
--
-- `statements` is left empty: it is only used by `supabase db diff` to
-- reconstruct a migration, and an empty array is valid there.
insert into supabase_migrations.schema_migrations (version, name, statements)
values
  ('20261019120000', 'home_hero_banners', '{}'),
  ('20261019120100', 'coupons_and_order_discounts', '{}'),
  ('20261019130000', 'client_editable_categories', '{}'),
  ('20261019150000', 'admin_bestsellers', '{}'),
  ('20261019150100', 'order_confirmation_tracking', '{}'),
  ('20261019160000', 'checkout_integrity_guards', '{}'),
  ('20261020090000', 'refuse_unpayable_orders', '{}'),
  ('20261020120000', 'product_skus', '{}'),
  ('20261020140000', 'google_sheets_oauth', '{}'),
  ('20261020160000', 'google_sheets_export_receipt', '{}'),
  ('20261020170000', 'google_api_check', '{}'),
  ('20261020180000', 'category_images', '{}'),
  ('20261020190000', 'order_ids', '{}'),
  ('20261020200000', 'night_wear_and_kurta_sets', '{}')
on conflict (version) do nothing;
