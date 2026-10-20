// The automatic Google Sheet sync.
//
// The client wants the sheet to hold every order, updated every day, without
// anyone having to remember to press "Export". This module is that sync: it
// sends the orders the sheet does not have yet, updates the rows whose status
// has changed, and records what it did so the admin panel can show it.
//
// It is deliberately free of the Deno runtime and of the Supabase client: the
// database address and the service key are passed in, the way
// `loadOrdersForExport` already does it. That is what lets the Node test
// suite drive the whole thing.
//
// Three rules, all of them load-bearing:
//
//   1. NEVER send an order twice. The ledger (`public.order_sheet_exports`)
//      has one row per (sheet, order) and its primary key IS the guard. An
//      order is only written to the sheet once, however many times the sync
//      runs, and however many times it fails half way through.
//   2. NEVER lose an order. The ledger row is written AFTER Google has
//      accepted the rows. A crash in between therefore sends the order again
//      — which is safe, because the sheet is append-only and the ledger is
//      the only thing that decides what is new.
//   3. NEVER lose the connection. An expired authorization is reported, not
//      swallowed: the sync records the reason so the admin panel can say that
//      the owner has to connect again.

/** How many recent orders the sync looks at. */
export const SYNC_LOOKBACK_LIMIT = 500

/**
 * The orders that are worth sending: the ones that have been paid.
 *
 * A checkout creates its order before the payment is taken, so an unpaid
 * order is an abandoned basket rather than an order. The store takes payment
 * online only, so "paid" is the whole story. The admin's own manual export
 * sends whatever the admin is looking at — this is the automatic one, and it
 * sends the real orders.
 */
export const isEligible = (order) => (
  !!order
  && String(order.payment_status || '') === 'paid'
  && !String(order.status || '').toLowerCase().includes('cancel')
)

/**
 * Which of these orders the sheet does not have yet.
 *
 * `alreadyExported` is the list of order ids the ledger already holds for this
 * sheet. Anything in it is left out — that is what stops the sheet filling up
 * with the same order every day.
 */
export function selectNewOrders(orders, alreadyExported, eligible = isEligible) {
  const seen = new Set((Array.isArray(alreadyExported) ? alreadyExported : []).map(String))
  const fresh = []
  const skipped = []
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!order?.id) continue
    if (seen.has(String(order.id)) || !eligible(order)) { skipped.push(order); continue }
    fresh.push(order)
  }
  return { fresh, skipped }
}

/**
 * The orders whose status the sheet is out of date about.
 *
 * The ledger remembers the status the sheet was last told; a status that has
 * changed since then is updated in place, in the row that already holds the
 * order, instead of being appended a second time.
 */
export function selectStatusChanges(orders, ledger) {
  const rows = Array.isArray(ledger) ? ledger : []
  const out = []
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!order?.id) continue
    const known = rows.find((r) => String(r?.order_id) === String(order.id))
    if (!known) continue
    const was = String(known.last_status ?? '')
    const now = String(order.status ?? '')
    const wasPayment = String(known.last_payment_status ?? '')
    const nowPayment = String(order.payment_status ?? '')
    if (was === now && wasPayment === nowPayment) continue
    out.push({ order, was, now, wasPayment, nowPayment })
  }
  return out
}

/**
 * The sheet rows that hold an order, by the Order ID the sheet carries.
 *
 * The Order ID is the first column, so one narrow read finds where every
 * order lives. A row that is not an order (the filter banner the manual
 * export writes) is simply not in the map.
 *
 * An order with several line items has SEVERAL rows, and the status is
 * written on every one of them, so the map holds all of them.
 *
 * A sheet written before the order IDs changed carries the OLD ID, so an
 * order is found by its current ID *or* by the one it had before — the row
 * is the same order either way.
 */
export function mapOrderRows(references, referenceColumn = 0) {
  const map = new Map()
  const list = Array.isArray(references) ? references : []
  list.forEach((row, index) => {
    const cell = Array.isArray(row) ? row[referenceColumn] : row
    const value = String(cell ?? '').trim()
    if (!value) return
    const rows = map.get(value) || []
    rows.push(index + 1) // spreadsheets count from 1
    map.set(value, rows)
  })
  return map
}

/**
 * The order ids the ledger already holds for this sheet.
 *
 * Read from the database, which is the only place the ledger exists.
 */
export async function loadLedger(baseUrl, serviceKey, sheetId) {
  if (!baseUrl || !serviceKey || !sheetId) return []
  const res = await fetch(
    `${baseUrl}/rest/v1/order_sheet_exports?sheet_id=eq.${encodeURIComponent(sheetId)}`
      + '&select=order_id,last_status,last_payment_status,status_synced_at',
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  )
  if (!res.ok) return []
  const rows = await res.json().catch(() => [])
  return Array.isArray(rows) ? rows : []
}

/**
 * The recent orders, with their line items, as the sync needs them.
 */
export async function loadSyncOrders(baseUrl, serviceKey, limit = SYNC_LOOKBACK_LIMIT) {
  if (!baseUrl || !serviceKey) return []
  const res = await fetch(
    `${baseUrl}/rest/v1/orders`
      + `?select=id,reference,previous_reference,created_at,status,payment_status,payment_method,full_name,email,phone,`
      + 'address,city,state,pincode,subtotal,discount,coupon_code,shipping,total,'
      + 'razorpay_order_id,razorpay_payment_id,note,'
      + 'order_items(title,size,qty,unit_price,sku)'
      + `&order=created_at.desc&limit=${limit}`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  )
  if (!res.ok) return []
  const rows = await res.json().catch(() => [])
  return Array.isArray(rows) ? rows : []
}

/**
 * Record that these orders are in the sheet.
 *
 * Written AFTER Google has accepted the rows, so a failure never leaves an
 * order marked as sent when it is not in the sheet. The insert is a plain
 * multi-row insert; a row that is already there is left alone rather than
 * failing the whole batch.
 */
export async function recordExports(baseUrl, serviceKey, sheetId, orders, statuses = []) {
  if (!baseUrl || !serviceKey || !sheetId) return { ok: false, written: 0 }
  const rows = (Array.isArray(orders) ? orders : []).map((order, index) => ({
    sheet_id: sheetId,
    order_id: order.id,
    last_status: order.status ?? null,
    last_payment_status: order.payment_status ?? null,
    status_synced_at: new Date().toISOString(),
  }))
  if (!rows.length) return { ok: true, written: 0 }
  const res = await fetch(`${baseUrl}/rest/v1/order_sheet_exports`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  })
  void statuses
  return { ok: res.ok, written: rows.length, status: res.status }
}

/**
 * Remember that the sheet now shows these orders with these statuses.
 */
export async function recordStatusUpdates(baseUrl, serviceKey, sheetId, changes) {
  if (!baseUrl || !serviceKey || !sheetId) return { ok: false, written: 0 }
  const rows = (Array.isArray(changes) ? changes : []).map(({ order }) => ({
    sheet_id: sheetId,
    order_id: order.id,
    last_status: order.status ?? null,
    last_payment_status: order.payment_status ?? null,
    status_synced_at: new Date().toISOString(),
  }))
  if (!rows.length) return { ok: true, written: 0 }
  // The ledger's primary key is (sheet_id, order_id), so this is an UPSERT.
  const res = await fetch(`${baseUrl}/rest/v1/order_sheet_exports?on_conflict=sheet_id,order_id`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  })
  return { ok: res.ok, written: rows.length, status: res.status }
}
