-- Record the category-code migration in the platform's own ledger.
--
-- Like the migrations before it, this one was applied to the database through
-- the Management API rather than with the Supabase CLI, so the ledger does not
-- know it ran. Without this row a future `supabase db push` would replay it
-- — harmless in itself, but the ledger should describe what the database
-- actually holds.
--
-- `statements` is left empty: it is only used by `supabase db diff` to
-- reconstruct a migration, and an empty array is valid there.
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261021140000', 'category_code_never_reused', '{}')
on conflict (version) do nothing;
