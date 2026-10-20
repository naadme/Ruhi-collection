// google-sheets
//
// The admin panel's Google Sheets integration, driven by the OWNER'S OWN
// Google account. There is no service-account key and no JSON file to hand
// around: the owner presses "Connect Google Sheets", signs in with Google,
// approves access, and the connection is theirs from then on.
//
// WHAT THIS FUNCTION IS ALLOWED TO SEE
//   * the caller's Supabase session, which it exchanges for the caller's user
//     id and then checks against `public.admins` — so only the store owner
//     (and not a product manager, and not a shopper) gets past the door;
//   * the OAuth tokens, which live in the database ENCRYPTED and never leave
//     this runtime.
//
// WHAT IT IS NOT ALLOWED TO LEAK
//   * the client secret and the refresh token are used here and nowhere
//     else — never in a response body, never in a log line, never in the
//     browser;
//   * every log line carries a status code or a short fingerprint, never a
//     token.
//
// The sign-in itself lives in `google-sheets-callback`, a separate function
// that Google redirects to. Keeping it separate means this one keeps the
// platform's own JWT verification: every action below needs a real admin
// session, and none of them can be reached by a stranger who guesses a URL.

import { serve } from '../_shared/deno.ts'
import { env } from '../_shared/env.ts'
import { asString, fail, json, preflight, readJson, type Json } from '../_shared/http.ts'
import { serviceFetch } from '../_shared/supabase.ts'
import { buildSheetValues, duplicatesAmong } from '../_shared/sheetRows.mjs'
import {
  GOOGLE_DRIVE_API,
  GOOGLE_SHEETS_API,
  GOOGLE_TOKEN_ENDPOINT,
  buildAuthorizeUrl,
  decryptText,
  describeGoogleError,
  encodeRefreshForm,
  encryptText,
  missingConfig,
  missingConfigMessage,
  parseSpreadsheetId,
  pkcePair,
  randomToken,
  readTokenResponse,
  safeSheetTitle,
  sha256Hex,
} from '../_shared/googleOAuth.mjs'

const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const DEFAULT_TAB = 'Orders'
const STATE_TTL_MS = 10 * 60 * 1000
const LEASE_MS = 5 * 60 * 1000
const MAX_IDS = 5000

function baseUrl(): string {
  return (env('SUPABASE_URL') ?? '').replace(/\/$/, '')
}

/** Where Google sends the owner back to. The same value is used when the
 *  code is exchanged, and Google insists the two match exactly. */
export function callbackUrl(): string {
  return `${baseUrl()}/functions/v1/google-sheets-callback`
}

/** Where the owner is sent once the sign-in is done. */
function adminUrl(): string {
  return env('GOOGLE_ADMIN_URL') || 'https://www.ruhi-collections.com/admin?section=orders'
}

// ---------------------------------------------------------------------------
// Who is calling
// ---------------------------------------------------------------------------

/** The caller's own id and email, verified by Supabase Auth itself. */
async function caller(authorization: string): Promise<{ id: string; email: string }> {
  const token = authorization.replace(/^bearer\s+/i, '').trim()
  if (!token) return { id: '', email: '' }
  const res = await fetch(`${baseUrl()}/auth/v1/user`, {
    headers: { apikey: env('SUPABASE_ANON_KEY') ?? '', Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return { id: '', email: '' }
  const user = (await res.json().catch(() => null)) as { id?: string; email?: string } | null
  return { id: user?.id ?? '', email: user?.email ?? '' }
}

/** An admin, or nobody. `public.admins` holds one row per owner account. */
async function isAdmin(userId: string): Promise<boolean> {
  if (!userId) return false
  const res = await serviceFetch(
    `/rest/v1/admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id&limit=1`,
  )
  if (!res.ok) return false
  const rows = (await res.json().catch(() => [])) as Json[]
  return Array.isArray(rows) && rows.length === 1
}

// ---------------------------------------------------------------------------
// The connection, in the database
// ---------------------------------------------------------------------------

async function loadConnection(ownerId: string): Promise<Json | null> {
  const res = await serviceFetch(
    `/rest/v1/google_sheets_connections?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&limit=1`,
  )
  if (!res.ok) return null
  const rows = (await res.json().catch(() => [])) as Json[]
  return Array.isArray(rows) && rows.length ? rows[0] : null
}

async function patchConnection(id: string, patch: Json): Promise<void> {
  await serviceFetch(`/rest/v1/google_sheets_connections?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  })
}

async function deleteConnection(id: string): Promise<void> {
  await serviceFetch(`/rest/v1/google_sheets_connections?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

/** One call to Google, with the answer already parsed. */
async function googleJson(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; body: Json | null }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    },
  })
  const body = (await res.json().catch(() => null)) as Json | null
  return { ok: res.ok, status: res.status, body }
}

/** Swap the refresh token for a fresh access token. */
async function refreshAccessToken(conn: Json): Promise<{ token: string; expiresAt: string } | null> {
  const key = env('GOOGLE_TOKEN_KEY') ?? ''
  const refreshToken = await decryptText(String(conn.refresh_token ?? ''), key)
  if (!refreshToken) return null

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: encodeRefreshForm({
      refreshToken,
      clientId: env('GOOGLE_CLIENT_ID') ?? '',
      clientSecret: env('GOOGLE_CLIENT_SECRET') ?? '',
    }),
  })
  const body = (await res.json().catch(() => null)) as Json | null
  if (!res.ok) {
    console.warn('[google-sheets] refresh refused:', res.status)
    return null
  }
  const parsed = readTokenResponse(body)
  if (!parsed) return null

  // Google usually does not send a new refresh token when it refreshes one;
  // the old one stays valid and is kept.
  await patchConnection(String(conn.id), {
    access_token: await encryptText(parsed.accessToken, key),
    access_expires_at: parsed.expiresAt,
    scope: parsed.scope || conn.scope || '',
  })
  return { token: parsed.accessToken, expiresAt: parsed.expiresAt }
}

/** A usable access token, refreshed when it has expired. */
async function ensureToken(conn: Json): Promise<string> {
  const key = env('GOOGLE_TOKEN_KEY') ?? ''
  const expires = conn.access_expires_at ? new Date(String(conn.access_expires_at)).getTime() : 0
  if (conn.access_token && expires - Date.now() > 60_000) {
    const token = await decryptText(String(conn.access_token), key)
    if (token) return token
  }
  const refreshed = await refreshAccessToken(conn)
  return refreshed?.token ?? ''
}

/** The spreadsheets this app created in the owner's Drive — and only those:
 *  the `drive.file` scope cannot see the rest of their Drive. */
async function listSpreadsheets(accessToken: string): Promise<Json[]> {
  const query = `mimeType='${SPREADSHEET_MIME}' and trashed=false`
  const url = `${GOOGLE_DRIVE_API}?q=${encodeURIComponent(query)}`
    + '&fields=' + encodeURIComponent('files(id,name,modifiedTime,webViewLink)')
    + '&pageSize=50'
  const res = await googleJson(url, accessToken)
  if (!res.ok) {
    console.warn('[google-sheets] drive list refused:', res.status)
    return []
  }
  const files = Array.isArray((res.body as Json | null)?.files)
    ? ((res.body as Json).files as Json[])
    : []
  return files
    .filter((f) => typeof f.id === 'string' && f.id)
    .map((f) => ({
      id: String(f.id),
      title: String(f.name ?? 'Untitled spreadsheet'),
      modified: typeof f.modifiedTime === 'string' ? f.modifiedTime : '',
      url: `https://docs.google.com/spreadsheets/d/${f.id}`,
    }))
}

/** Create a spreadsheet in the owner's Drive and give it an "Orders" tab. */
async function createSpreadsheet(accessToken: string, title: string): Promise<{ id: string; tab: string } | null> {
  const res = await googleJson(`${GOOGLE_DRIVE_API}?fields=${encodeURIComponent('id,name')}`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ name: title, mimeType: SPREADSHEET_MIME }),
  })
  if (!res.ok) {
    console.warn('[google-sheets] drive create refused:', res.status)
    return null
  }
  const id = String((res.body as Json | null)?.id ?? '')
  if (!id) return null

  // A brand new spreadsheet's first tab is called "Sheet1"; the export writes
  // to a tab called "Orders", so it is renamed here.
  const renamed = await googleJson(
    `${GOOGLE_SHEETS_API}/${encodeURIComponent(id)}:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [{ updateSheetProperties: { sheetId: 0, title: DEFAULT_TAB, fields: 'title' } }],
      }),
    },
  )
  return { id, tab: renamed.ok ? DEFAULT_TAB : 'Sheet1' }
}

/** Append rows to a spreadsheet. */
async function appendRows(
  accessToken: string,
  sheetId: string,
  tab: string,
  values: unknown[][],
): Promise<{ ok: boolean; status: number; body: Json | null }> {
  const range = `${encodeURIComponent(tab)}!A1`
  const url = `${GOOGLE_SHEETS_API}/${encodeURIComponent(sheetId)}/values/${range}:append`
    + '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS'
  return googleJson(url, accessToken, { method: 'POST', body: JSON.stringify({ values }) })
}

// ---------------------------------------------------------------------------
// The export lease — one export at a time
// ---------------------------------------------------------------------------

async function claimLease(conn: Json, ownerId: string): Promise<boolean> {
  const now = new Date().toISOString()
  const res = await serviceFetch(
    `/rest/v1/google_sheets_connections?id=eq.${encodeURIComponent(String(conn.id))}&export_started_at=is.null`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ export_started_at: now, export_by: ownerId }),
    },
  )
  const rows = (await res.json().catch(() => [])) as Json[]
  if (Array.isArray(rows) && rows.length) return true

  // The lease may simply have been left behind by a request that died.
  const current = await loadConnection(ownerId)
  const started = current?.export_started_at
    ? new Date(String(current.export_started_at)).getTime()
    : 0
  if (started && Date.now() - started < LEASE_MS) return false
  await patchConnection(String(conn.id), { export_started_at: now, export_by: ownerId })
  return true
}

async function releaseLease(connId: string): Promise<void> {
  await patchConnection(connId, { export_started_at: null, export_by: null })
}

// ---------------------------------------------------------------------------
// The orders
// ---------------------------------------------------------------------------

async function loadOrders(ids: string[]): Promise<Json[]> {
  const list = ids.map((id) => encodeURIComponent(id)).join(',')
  const res = await serviceFetch(
    '/rest/v1/orders'
      + `?id=in.(${list})`
      + '&select=id,reference,created_at,status,payment_status,payment_method,full_name,email,phone,'
      + 'address,city,state,pincode,subtotal,discount,coupon_code,shipping,total,'
      + 'razorpay_order_id,razorpay_payment_id,note,'
      + 'order_items(title,size,qty,unit_price)'
      + '&order=created_at.desc&limit=5000',
  )
  if (!res.ok) {
    console.warn('[google-sheets] orders not readable:', res.status)
    return []
  }
  const rows = (await res.json().catch(() => [])) as Json[]
  return Array.isArray(rows) ? rows : []
}

/** Which orders are already in this sheet. */
async function loadExportedOrderIds(sheetId: string): Promise<string[]> {
  const res = await serviceFetch(
    `/rest/v1/order_sheet_exports?sheet_id=eq.${encodeURIComponent(sheetId)}&select=order_id`,
  )
  if (!res.ok) return []
  const rows = (await res.json().catch(() => [])) as Json[]
  return Array.isArray(rows) ? rows.map((r) => String(r.order_id)) : []
}

// ---------------------------------------------------------------------------
// The actions
// ---------------------------------------------------------------------------

async function actionStart(userId: string, email: string): Promise<Response> {
  const clientId = env('GOOGLE_CLIENT_ID') ?? ''
  const missing = missingConfig({
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: env('GOOGLE_CLIENT_SECRET'),
    GOOGLE_TOKEN_KEY: env('GOOGLE_TOKEN_KEY'),
  })
  if (missing.length) {
    return json(501, {
      error: 'Google Sheets is not set up on this project yet.',
      missing,
      setup: missingConfigMessage(missing),
    })
  }

  const { verifier, challenge } = await pkcePair()
  const state = randomToken(32)
  const stateHash = await sha256Hex(state)

  // The raw state and the PKCE verifier are never stored: only the state's
  // hash, so a copy of the table is worth nothing to anyone.
  const res = await serviceFetch('/rest/v1/google_sheets_states', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      state_hash: stateHash,
      owner_id: userId,
      code_verifier: verifier,
      expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
    }),
  })
  if (!res.ok) {
    console.warn('[google-sheets] could not start the sign-in:', res.status)
    return fail(500, 'The sign-in could not be started. Please try again.')
  }

  return json(200, {
    ok: true,
    authorizeUrl: buildAuthorizeUrl({
      clientId,
      redirectUri: callbackUrl(),
      state,
      codeChallenge: challenge,
      loginHint: email,
    }),
    redirectUri: callbackUrl(),
  })
}

async function actionStatus(userId: string): Promise<Response> {
  const missing = missingConfig({
    GOOGLE_CLIENT_ID: env('GOOGLE_CLIENT_ID'),
    GOOGLE_CLIENT_SECRET: env('GOOGLE_CLIENT_SECRET'),
    GOOGLE_TOKEN_KEY: env('GOOGLE_TOKEN_KEY'),
  })
  const conn = await loadConnection(userId)
  if (!conn || !conn.refresh_token) {
    return json(200, {
      ok: true,
      connected: false,
      configured: missing.length === 0,
      missing,
      setup: missing.length ? missingConfigMessage(missing) : null,
      sheets: [],
    })
  }

  const token = await ensureToken(conn)
  if (!token) {
    return json(200, {
      ok: true,
      connected: false,
      needsReconnect: true,
      configured: missing.length === 0,
      missing,
      setup: missing.length ? missingConfigMessage(missing) : null,
      email: conn.google_email ?? '',
      sheets: [],
    })
  }

  return json(200, {
    ok: true,
    connected: true,
    configured: true,
    email: conn.google_email ?? '',
    spreadsheet: conn.spreadsheet_id
      ? { id: conn.spreadsheet_id, title: conn.spreadsheet_title ?? '', tab: conn.sheet_tab ?? DEFAULT_TAB }
      : null,
    sheets: await listSpreadsheets(token),
  })
}

async function actionDisconnect(userId: string): Promise<Response> {
  const conn = await loadConnection(userId)
  if (!conn) return json(200, { ok: true, connected: false })

  // Ask Google to forget the grant, so the account is not left with an
  // approval nobody can see or revoke from the app.
  const key = env('GOOGLE_TOKEN_KEY') ?? ''
  const refresh = await decryptText(String(conn.refresh_token ?? ''), key)
  if (refresh) {
    await fetch(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(refresh)}`, { method: 'POST' })
      .catch(() => undefined)
  }
  await deleteConnection(String(conn.id))
  return json(200, { ok: true, connected: false })
}

async function actionListSheets(userId: string): Promise<Response> {
  const conn = await loadConnection(userId)
  if (!conn) return fail(400, 'Connect Google Sheets first.')
  const token = await ensureToken(conn)
  if (!token) return fail(401, 'Your Google connection has expired. Please connect Google Sheets again.')
  return json(200, { ok: true, sheets: await listSpreadsheets(token) })
}

async function actionCreateSheet(userId: string, body: Json): Promise<Response> {
  const conn = await loadConnection(userId)
  if (!conn) return fail(400, 'Connect Google Sheets first.')
  const token = await ensureToken(conn)
  if (!token) return fail(401, 'Your Google connection has expired. Please connect Google Sheets again.')

  const title = safeSheetTitle(asString(body.name), 'Ruhi Collection — Orders')
  const created = await createSpreadsheet(token, title)
  if (!created) {
    return fail(502, 'Google could not create the spreadsheet. Please try again.')
  }
  await patchConnection(String(conn.id), {
    spreadsheet_id: created.id,
    spreadsheet_title: title,
    sheet_tab: created.tab,
  })
  return json(200, {
    ok: true,
    spreadsheet: { id: created.id, title, tab: created.tab },
    url: `https://docs.google.com/spreadsheets/d/${created.id}`,
  })
}

async function actionSelectSheet(userId: string, body: Json): Promise<Response> {
  const conn = await loadConnection(userId)
  if (!conn) return fail(400, 'Connect Google Sheets first.')
  const token = await ensureToken(conn)
  if (!token) return fail(401, 'Your Google connection has expired. Please connect Google Sheets again.')

  const sheetId = parseSpreadsheetId(asString(body.spreadsheetId))
  if (!sheetId) {
    return fail(400, 'That does not look like a Google spreadsheet. Paste its link or id.')
  }

  // Prove the connection can actually open it before it is remembered.
  const res = await googleJson(
    `${GOOGLE_SHEETS_API}/${encodeURIComponent(sheetId)}?fields=${encodeURIComponent('spreadsheetId,title')}`,
    token,
  )
  if (!res.ok) {
    const described = describeGoogleError(res.status, res.body)
    return json(res.status === 401 ? 401 : 400, { error: described.message, needsReconnect: described.needsReconnect })
  }
  const title = String((res.body as Json | null)?.title ?? 'Untitled spreadsheet')

  await patchConnection(String(conn.id), {
    spreadsheet_id: sheetId,
    spreadsheet_title: title,
    sheet_tab: DEFAULT_TAB,
  })
  return json(200, {
    ok: true,
    spreadsheet: { id: sheetId, title, tab: DEFAULT_TAB },
    url: `https://docs.google.com/spreadsheets/d/${sheetId}`,
  })
}

async function actionExport(userId: string, body: Json): Promise<Response> {
  const conn = await loadConnection(userId)
  if (!conn || !conn.refresh_token) {
    return fail(400, 'Connect Google Sheets before exporting.')
  }
  const sheetId = String(conn.spreadsheet_id ?? '')
  if (!sheetId) {
    return fail(400, 'Choose a spreadsheet to send the orders to first.')
  }

  const rawIds = Array.isArray(body.ids) ? body.ids : []
  const ids = rawIds.map((v) => asString(v)).filter(Boolean)
  if (!ids.length) return fail(400, 'There are no orders to export.')
  if (ids.length > MAX_IDS) return fail(400, `Please narrow the export to at most ${MAX_IDS} orders.`)

  const token = await ensureToken(conn)
  if (!token) {
    return json(401, {
      error: 'Your Google connection has expired. Please connect Google Sheets again.',
      needsReconnect: true,
    })
  }

  // One export at a time, so two clicks cannot write the same orders twice.
  if (!(await claimLease(conn, userId))) {
    return json(409, { error: 'Another export is already running. Please wait a moment and try again.' })
  }

  try {
    const orders = await loadOrders(ids)
    if (!orders.length) return fail(400, 'None of those orders could be read.')

    const already = await loadExportedOrderIds(sheetId)
    const { fresh, repeated } = duplicatesAmong(orders, already)
    const includeExported = body.includeExported === true
    const sending = includeExported ? orders : fresh

    if (!sending.length) {
      return json(200, {
        ok: true,
        orders: 0,
        rows: 0,
        skipped: repeated.length,
        message: 'Every order in this view is already in that spreadsheet.',
        url: `https://docs.google.com/spreadsheets/d/${sheetId}`,
      })
    }

    // The headers are written once, with the first export; every later export
    // appends rows only, so the sheet stays a table instead of a pile.
    const values = buildSheetValues(sending, (body.filters ?? {}) as Json, {
      includeHeaders: already.length === 0,
    })
    const tab = String(conn.sheet_tab ?? DEFAULT_TAB)

    const written = await appendRows(token, sheetId, tab, values)
    if (!written.ok) {
      const described = describeGoogleError(written.status, written.body)
      console.warn('[google-sheets] append refused:', written.status)
      return json(written.status === 401 ? 401 : 502, {
        error: described.message,
        needsReconnect: described.needsReconnect,
      })
    }

    // Only now is the order marked as exported: if Google refused the rows,
    // they must still be exportable next time.
    const batchId = crypto.randomUUID()
    await serviceFetch('/rest/v1/order_sheet_exports', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(
        sending.map((o) => ({ sheet_id: sheetId, order_id: String(o.id), batch_id: batchId })),
      ),
    })

    return json(200, {
      ok: true,
      orders: sending.length,
      rows: values.length,
      skipped: repeated.length,
      url: `https://docs.google.com/spreadsheets/d/${sheetId}`,
    })
  } finally {
    await releaseLease(String(conn.id))
  }
}

// ---------------------------------------------------------------------------
// The entrypoint
// ---------------------------------------------------------------------------

export async function handle(req: Request): Promise<Response> {
  const early = preflight(req) ?? (req.method === 'POST' ? null : fail(405, 'Method not allowed.'))
  if (early) return early

  try {
    const body = await readJson(req)
    const action = asString(body.action)

    // Every action in this function needs a real store owner. The sign-in
    // itself is in the other function, where Google's redirect arrives
    // without a session.
    const who = await caller(req.headers.get('Authorization') ?? '')
    if (!who.id) return fail(401, 'Please sign in to the admin panel again.')
    if (!(await isAdmin(who.id))) {
      return fail(403, 'Only the store owner can use Google Sheets.')
    }

    switch (action) {
      case 'start': return actionStart(who.id, who.email)
      case 'status': return actionStatus(who.id)
      case 'disconnect': return actionDisconnect(who.id)
      case 'list-sheets': return actionListSheets(who.id)
      case 'create-sheet': return actionCreateSheet(who.id, body)
      case 'select-sheet': return actionSelectSheet(who.id, body)
      case 'export': return actionExport(who.id, body)
      default:
        return fail(400, 'That action is not something this function does.')
    }
  } catch (error) {
    console.warn('[google-sheets] failed:', String(error))
    return fail(500, 'The request could not be completed. Please try again.')
  }
}

serve(handle)
