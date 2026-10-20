-- Ruhi Collection — remember what Google's APIs answered when we last checked.
--
-- The Google Sheets and Drive APIs have to be ENABLED on the Google Cloud
-- project before any export can work, and Google's own refusal
-- (403 SERVICE_DISABLED) is the only place that fact shows up. The admin
-- panel used to answer with a generic "Google could not create the
-- spreadsheet", which told the owner nothing.
--
-- One JSON column on the connection holds the last check: which API is
-- available, which is not, and the link that turns the missing one on. It is
-- written by the Edge Function after a read-only probe and is never read by
-- a browser.
--
-- Additive and reversible: `alter table ... drop column` restores the table
-- exactly as it was.

alter table public.google_sheets_connections
  add column if not exists api_check jsonb;

comment on column public.google_sheets_connections.api_check is
  'The last read-only check of the Google Sheets and Drive APIs for this connection.';
