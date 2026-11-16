-- Ruhi Collections — remember whether the order sheet was shared with the
-- client's Google account.
--
-- The spreadsheet belongs to the owner's own Google Drive. It is shared with
-- ruhicollections2026@gmail.com as a writer so the client can open it from her
-- own account. These three columns record what Google was asked and what it
-- answered, so the admin panel can show the truth instead of assuming.
--
-- Additive only: no existing row, order or connection is changed.

alter table public.google_sheets_connections
  add column if not exists shared_with_email text,
  add column if not exists shared_at timestamptz,
  add column if not exists share_error text;

comment on column public.google_sheets_connections.shared_with_email is
  'The client Google account the order spreadsheet was shared with.';
comment on column public.google_sheets_connections.shared_at is
  'When Google confirmed the share.';
comment on column public.google_sheets_connections.share_error is
  'Why the last share attempt failed, if it did.';

-- Existing connections have not been shared by this version yet. Leaving
-- shared_at null lets the panel offer the one click that does it.
