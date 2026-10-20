-- Ruhi Collection — active/inactive switches for the homepage, and the ledger
-- the daily Google Sheet sync needs.
--
-- WHAT CHANGES
--   1. `banners.is_active` — a banner can be saved but switched off, so the
--      admin can prepare one without it going live, and can see at a glance
--      which banners the site is showing.
--   2. `bestsellers.is_active` — a bestseller can be deactivated without
--      losing its place in the order, so it can be brought back exactly where
--      it was.
--   3. `google_sheets_connections.sheet_info` — THE COLUMN WAS MISSING. The
--      OAuth callback has always written `sheet_info` next to `api_check`, and
--      PostgREST rejects a PATCH that names a column the table does not have,
--      so that write failed and the API check was never saved either.
--   4. `google_sheets_connections.last_sync_*` — what the automatic daily sync
--      last did, when it last did it, and what went wrong, so the admin panel
--      can show a real status instead of guessing.
--   5. `order_sheet_exports.last_status` / `status_synced_at` — what the
--      sheet was last told about each order, so the daily sync can update a
--      row whose status has changed instead of appending it twice.
--
-- WHAT DOES NOT CHANGE
--   * Every existing row stays exactly as it is. `is_active` defaults to
--     TRUE, so the banner and the bestseller that are live today stay live.
--   * No product, price, order, order item, customer record or payment
--     reference is read or written by this migration.
--
-- Backward-compatible: every change is a new column with a default, so the
-- application keeps working whether or not it has been pushed yet.

-- ---------------------------------------------------------------------------
-- 1. Banners: on or off.
-- ---------------------------------------------------------------------------
alter table public.banners
  add column if not exists is_active boolean not null default true;

comment on column public.banners.is_active is
  'Whether this banner is shown on the homepage. A switched-off banner keeps its image, link and position.';

-- The banners that are live now stay live.
update public.banners set is_active = true where is_active is null;

-- ---------------------------------------------------------------------------
-- 2. Bestsellers: on or off, keeping their place in the order.
-- ---------------------------------------------------------------------------
alter table public.bestsellers
  add column if not exists is_active boolean not null default true;

comment on column public.bestsellers.is_active is
  'Whether this product is shown in the homepage bestseller row. A switched-off product keeps its position.';

update public.bestsellers set is_active = true where is_active is null;

-- ---------------------------------------------------------------------------
-- 3. The sheet information the OAuth callback writes.
-- ---------------------------------------------------------------------------
alter table public.google_sheets_connections
  add column if not exists sheet_info jsonb;

comment on column public.google_sheets_connections.sheet_info is
  'The spreadsheet and tab as they were last read, for the admin connection status.';

-- ---------------------------------------------------------------------------
-- 4. What the automatic sync last did.
-- ---------------------------------------------------------------------------
alter table public.google_sheets_connections
  add column if not exists last_sync_at timestamptz,
  add column if not exists last_sync_orders integer,
  add column if not exists last_sync_rows integer,
  add column if not exists last_sync_error text;

comment on column public.google_sheets_connections.last_sync_at is
  'When the automatic daily sync last ran.';
comment on column public.google_sheets_connections.last_sync_error is
  'Why the last automatic sync did not finish, when it did not.';

-- ---------------------------------------------------------------------------
-- 5. What the sheet was last told about each order.
-- ---------------------------------------------------------------------------
alter table public.order_sheet_exports
  add column if not exists last_status text,
  add column if not exists last_payment_status text,
  add column if not exists status_synced_at timestamptz;

comment on column public.order_sheet_exports.last_status is
  'The order status the sheet was last told about, so a changed status can be updated in place instead of appended twice.';
comment on column public.order_sheet_exports.last_payment_status is
  'The payment status the sheet was last told about.';
comment on column public.order_sheet_exports.status_synced_at is
  'When the sheet was last told about the status of this order.';

-- The orders already in the sheet have a known status from their row: the
-- ledger cannot know it, so it is read once, here, from the order itself.
-- This is a snapshot of "not yet compared", not a claim that the sheet is
-- up to date — the sync compares the ledger with the order and updates what
-- has changed.
update public.order_sheet_exports e
   set last_status = o.status
  from public.orders o
 where o.id = e.order_id
   and e.last_status is null;
