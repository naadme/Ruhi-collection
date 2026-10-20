-- Ruhi Collection — Google Sheets connection, OAuth state and export ledger.
--
-- The owner connects their own Google account once and approves access; from
-- then on the admin panel can send orders to a spreadsheet in their Drive.
-- Nothing here is ever exposed to a browser: the tokens live in this table,
-- encrypted, and only the Edge Function reads them (row-level security is on
-- with no policy, so the anon and authenticated roles cannot see a row at
-- all — the service role, which never leaves the function, can).
--
-- Three small tables:
--   google_sheets_connections  one row per admin account: the encrypted
--                              tokens, who they belong to, and which
--                              spreadsheet is the destination
--   google_sheets_states       one row per sign-in attempt: the one-time
--                              `state` (stored hashed) and the PKCE verifier
--                              used once, at the code exchange
--   order_sheet_exports        the ledger of what is already in a sheet, so
--                              the same order is never exported twice
--
-- Additive and reversible: dropping these three objects restores the schema
-- exactly as it was. No existing table, column, row or order is touched.

-- ---------------------------------------------------------------------------
-- 1. The connection.
-- ---------------------------------------------------------------------------
create table if not exists public.google_sheets_connections (
  id                  uuid primary key default gen_random_uuid(),
  -- The store owner's Supabase account. It must be an admin: the Edge
  -- Function checks is_admin() before it will read or write a row, and the
  -- foreign key makes sure a row can never exist for somebody who is not.
  owner_id            uuid not null references public.admins (user_id) on delete cascade,
  google_user_id      text,
  google_email        text,
  -- Encrypted with AES-256-GCM; the key lives in the function's secrets and
  -- never in this database, a log, a response body or a browser.
  access_token        text,
  access_expires_at   timestamptz,
  refresh_token       text,
  scope               text,
  -- Where the orders go.
  spreadsheet_id      text,
  spreadsheet_title   text,
  -- The tab inside that spreadsheet the rows are written to. A spreadsheet
  -- this app creates gets its first tab renamed to "Orders" straight away.
  sheet_tab           text,
  -- The lease: one export at a time, so two clicks cannot write the same
  -- orders to the sheet twice at once.
  export_started_at   timestamptz,
  export_by           text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One connection per admin account.
create unique index if not exists google_sheets_connections_owner_key
  on public.google_sheets_connections (owner_id);

create index if not exists google_sheets_connections_sheet_idx
  on public.google_sheets_connections (spreadsheet_id);

-- Row-level security with no policy: the browser cannot read or write a
-- connection, and neither can a signed-in shopkeeper. Only the service role
-- (inside the Edge Function) can.
alter table public.google_sheets_connections enable row level security;

drop trigger if exists set_google_sheets_connections_updated_at on public.google_sheets_connections;
create trigger set_google_sheets_connections_updated_at
  before update on public.google_sheets_connections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. The one-time sign-in state.
--
-- `state_hash` is the SHA-256 of the value that was sent to Google: the raw
-- value is never stored, so a copy of this table is useless to an attacker.
-- `code_verifier` is the PKCE verifier, used exactly once — at the code
-- exchange — and the row is marked used the moment that happens.
-- ---------------------------------------------------------------------------
create table if not exists public.google_sheets_states (
  id            uuid primary key default gen_random_uuid(),
  state_hash    text not null unique,
  owner_id      uuid not null references public.admins (user_id) on delete cascade,
  code_verifier text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz
);

create index if not exists google_sheets_states_owner_idx
  on public.google_sheets_states (owner_id);

alter table public.google_sheets_states enable row level security;

-- ---------------------------------------------------------------------------
-- 3. The export ledger.
--
-- One row per order per sheet: the primary key IS the duplicate guard. An
-- order that has been sent to a sheet is not sent to it again unless the
-- owner asks for it explicitly.
-- ---------------------------------------------------------------------------
create table if not exists public.order_sheet_exports (
  sheet_id    text not null,
  order_id    uuid not null references public.orders (id) on delete cascade,
  batch_id    uuid not null default gen_random_uuid(),
  exported_at timestamptz not null default now(),
  primary key (sheet_id, order_id)
);

create index if not exists order_sheet_exports_order_idx
  on public.order_sheet_exports (order_id);

alter table public.order_sheet_exports enable row level security;

comment on table public.google_sheets_connections is
  'The owner''s own Google account, connected by OAuth. Tokens are encrypted; only the Edge Function can read this table.';
comment on table public.order_sheet_exports is
  'Which orders are already in which spreadsheet — the duplicate guard for the Google Sheets export.';
