-- Ruhi Collection — remember what each Google Sheets export actually did.
--
-- The export is append-only and silent: the sheet itself is the record, but
-- the admin panel should be able to say "the last export wrote 25 rows to
-- A1:Z26 at 18:44" without anyone opening the spreadsheet — and so should
-- the person looking after the site.
--
-- Four columns on the connection, written only after Google has accepted the
-- rows: when, how many orders, how many rows, and the range Google says it
-- wrote. Nothing else changes, and every column is nullable, so a connection
-- that has never exported simply has nothing in them.
--
-- Additive and reversible: `alter table ... drop column` restores the table
-- exactly as it was, with the connection and its encrypted tokens untouched.

alter table public.google_sheets_connections
  add column if not exists last_export_at      timestamptz,
  add column if not exists last_export_orders  integer,
  add column if not exists last_export_rows    integer,
  add column if not exists last_export_range   text;

comment on column public.google_sheets_connections.last_export_range is
  'The range Google confirmed it wrote, from the append response.';
