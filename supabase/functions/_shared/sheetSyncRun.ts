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
  const where = new Map<string, number[]>()
  let sheetRowsRead = 0
  let referencesFound = 0
  let updateError = ''

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

  // The sheet is read once: its first column says which order each row is.
  const referenceRows = await readRange(token, sheetId, tab, 'A1:A2000')
  sheetRowsRead = Array.isArray(referenceRows) ? referenceRows.length : 0
  const found = mapOrderRows(referenceRows)
  referencesFound = found.size
  for (const [key, value] of found) where.set(key, value)

  // Two things can be out of date in a row that is already there: the STATUS,
  // and the ORDER ID itself. Both are brought up to date where the row is —
  // never by adding another row for the same order.
  const changes = selectStatusChanges(orders, ledger)
  let updated = 0
  let renamed = 0

  /** Write one range of the sheet. */
  const write = async (range, values) => {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`
        + `/values/${encodeURIComponent(`${tab}!${range}`)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      },
    )
    if (res.ok) return true
    const why = (await res.text().catch(() => '')).slice(0, 300)
    console.warn('[google-sheets-sync] could not update a row:', res.status, why)
    updateError = updateError || `HTTP ${res.status}: ${why}`
    return false
  }

  for (const order of orders) {
    // The rows of this order — found by the ID the sheet carries, which may be
    // the one the order had before its IDs were regenerated.
    const reference = String(order.reference ?? '')
    const previous = String(order.previous_reference ?? '')
    const rows = [...(where.get(reference) || []), ...(where.get(previous) || [])]
    if (!rows.length) continue

    // The Order ID the row carries: the order's current one.
    const current = String(order.reference ?? '')
    if (previous && where.get(previous)?.length && current !== previous) {
      for (const row of where.get(previous) || []) {
        if (await write(`A${row}:A${row}`, [[current]])) renamed += 1
      }
    }

    const change = changes.find((c) => String(c.order.id) === String(order.id))
    if (!change) continue
    for (const row of rows) {
      if (await write(`C${row}:D${row}`, [[change.now, change.nowPayment]])) updated += 1
    }
  }
  if (updated || renamed) await recordStatusUpdates(baseUrl(), serviceKey, sheetId, changes)

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
    // How many orders the sheet was out of date about, and how many rows of
    // the sheet were read to find them — so a sheet that cannot be read is
    // visible as such rather than as "nothing to do".
    statusChanges: changes.length,
    sheetRows: sheetRowsRead,
    sheetReferences: referencesFound,
    renamed,
    updateError: updateError || null,
    headingsWritten: heading?.written || 0,
    considered: orders.length,
    message: written || updated
      ? `Sent ${written} order(s) and updated ${updated}.`
      : 'The sheet is already up to date.',
  }
}
