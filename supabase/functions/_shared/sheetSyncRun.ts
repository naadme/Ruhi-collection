// The work the automatic sync does.
//
// It lives apart from the HTTP entry point on purpose: the payment functions
// call it directly, and importing an Edge Function's entry point would start
// a SECOND HTTP server inside another function, which Deno refuses to do.
//
// Nothing here decides whether an order is paid — that is the payment
// server's job alone — and nothing here writes to an order.

import { env } from './env.ts'
import { type Json } from './http.ts'
import { ensureToken, loadAnyConnection, patchConnection } from './googleConnection.ts'
import { appendRows, ensureSheetHeader, readRange } from './googleSheets.mjs'
import { buildSheetValues, SHEET_COLUMNS } from './sheetRows.mjs'
import {
  loadLedger,
  loadSyncOrders,
  mapOrderRows,
  recordExports,
  recordStatusUpdates,
  selectNewOrders,
  selectStatusChanges,
} from './sheetSync.mjs'

const baseUrl = () => env('SUPABASE_URL') ?? ''

/** Remember what the sync did, so the admin panel can show it. */
async function recordOutcome(connId: string, patch: Json): Promise<void> {
  try {
    await patchConnection(connId, patch)
  } catch {
    /* the outcome is a convenience; the sync itself already happened */
  }
}

/**
 * Send the new orders to the sheet, and update the rows whose status changed.
 *
 * Returns a plain description of what happened — no tokens, no customer
 * details — which is what the admin panel shows and what the scheduler logs.
 *
 * This lives in its own module because the payment functions call it
 * directly. Importing an Edge Function's entry point would start a SECOND
 * HTTP server in the middle of another function, which Deno refuses to do —
 * so the work is here and the entry point only serves it.
 */
export async function runSync(): Promise<Json> {
  const conn = await loadAnyConnection()
  if (!conn) {
    return { ok: false, reason: 'not-connected', message: 'Google Sheets is not connected yet.' }
  }
  const connId = String(conn.id ?? '')
  const sheetId = String(conn.spreadsheet_id ?? '')
  if (!sheetId) {
    await recordOutcome(connId, { last_sync_at: new Date().toISOString(), last_sync_error: 'No spreadsheet has been chosen yet.' })
    return { ok: false, reason: 'no-spreadsheet', message: 'No spreadsheet has been chosen yet.' }
  }

  const token = await ensureToken(conn)
  if (!token) {
    await recordOutcome(connId, {
      last_sync_at: new Date().toISOString(),
      last_sync_error: 'The Google connection has expired. Please connect Google Sheets again.',
    })
    return { ok: false, reason: 'not-authorized', message: 'The Google connection has expired.' }
  }

  // The tab the owner chose; if it has gone, the first tab is used.
  const tab = String(conn.sheet_tab || 'Orders')

  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const ledger = await loadLedger(baseUrl(), serviceKey, sheetId)
  const exportedIds = ledger.map((r) => String(r.order_id))
  const orders = await loadSyncOrders(baseUrl(), serviceKey)

  const { fresh } = selectNewOrders(orders, exportedIds)

  // The headings of any column added since the sheet was created are written
  // into its first row — whether or not there is anything new to send, so the
  // sheet is always correctly labelled.
  const heading = await ensureSheetHeader(token, sheetId, tab, SHEET_COLUMNS)

  let written = 0
  let rows = 0
  if (fresh.length) {
    const values = buildSheetValues(fresh, {}, { includeHeaders: false })
    const res = await appendRows(token, sheetId, tab, values)
    if (!res.ok) {
      await recordOutcome(connId, {
        last_sync_at: new Date().toISOString(),
        last_sync_error: `Google refused the rows (HTTP ${res.status}).`,
      })
      return { ok: false, reason: 'google-refused', status: res.status, message: 'Google refused the rows.' }
    }
    written = fresh.length
    rows = values.length
    // The ledger is written AFTER Google accepted the rows: a crash in
    // between sends the order again, which is safe, because the sheet is
    // append-only and the ledger is what decides what is new.
    await recordExports(baseUrl(), serviceKey, sheetId, fresh)
  }

  // The rows whose status changed are updated where they already are.
  let updated = 0
  const changes = selectStatusChanges(orders, ledger)
  if (changes.length) {
    const referenceRows = await readRange(token, sheetId, tab, 'A1:A2000')
    const where = mapOrderRows(referenceRows)
    for (const change of changes) {
      const row = where.get(String(change.order.reference ?? ''))
      if (!row) continue
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`
          + `/values/${encodeURIComponent(`${tab}!C${row}:D${row}`)}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[change.now, change.nowPayment]] }),
        },
      )
      if (!res.ok) continue
      updated += 1
    }
    if (updated) await recordStatusUpdates(baseUrl(), serviceKey, sheetId, changes)
  }

  await recordOutcome(connId, {
    last_sync_at: new Date().toISOString(),
    last_sync_orders: written,
    last_sync_rows: rows,
    last_sync_error: null,
  })

  return {
    ok: true,
    orders: written,
    rows,
    updated,
    headingsWritten: heading?.written || 0,
    considered: orders.length,
    message: written || updated
      ? `Sent ${written} order(s) and updated ${updated}.`
      : 'The sheet is already up to date.',
  }
}
