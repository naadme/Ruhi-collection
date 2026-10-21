-- Record the migrations the platform's ledger is still missing.
--
-- These four were applied to this project through the Management API rather
-- than with the Supabase CLI, so the objects are all there but the ledger
-- does not know it.
--
-- That matters because `supabase db push` decides what to run from the ledger.
-- Left as it was, a future push would replay them — and two of them move
-- data: the order-item Product ID backfill would rewrite the snapshot every
-- order line carries, and the daily-sync ledger backfill would rewrite the
-- record of which orders the spreadsheet has already been told about.
-- Recording them keeps the ledger honest and makes the next push a no-op.
--
-- `statements` is left empty: it is only used by `supabase db diff` to
-- reconstruct a migration, and an empty array is valid there.
insert into supabase_migrations.schema_migrations (version, name, statements)
values
  ('20261021090000', 'order_item_skus', '{}'),
  ('20261021100000', 'active_switches_and_sync_ledger', '{}'),
  ('20261021110000', 'record_applied_migrations', '{}'),
  ('20261021120000', 'category_image_active', '{}')
on conflict (version) do nothing;
