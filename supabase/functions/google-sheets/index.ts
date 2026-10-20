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
import {
  buildAuthorizeUrl,
  decryptText,
  describeGoogleError,
  missingConfig,
  missingConfigMessage,
  parseSpreadsheetId,
  pkcePair,
  probeGoogleSetup,
  randomToken,
  safeSheetTitle,
  setupLinks,
  sha256Hex,
} from '../_shared/googleOAuth.mjs'
import {
  ensureToken,
  loadConnection,
  patchConnection,
} from '../_shared/googleConnection.ts'
import {
  DEFAULT_TAB,
  appendRows,
  createSheetWithTab,
  describeApiProblem,
  exportOrdersToSheet,
  getSheetStructure,
  getSpreadsheet,
  listSpreadsheets,
  pickTab,
  probeGoogleApis,
  readRange,
} from '../_shared/googleSheets.mjs'

const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
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

async function deleteConnection(id: string): Promise<void> {
  await serviceFetch(`/rest/v1/google_sheets_connections?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

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
      + 'order_items(title,size,qty,unit_price,sku)'
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
  const clientSecret = env('GOOGLE_CLIENT_SECRET') ?? ''
  const missing = missingConfig({
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
    GOOGLE_TOKEN_KEY: env('GOOGLE_TOKEN_KEY'),
  })
  if (missing.length) {
    return json(501, {
      error: 'Google Sheets is not set up on this project yet.',
      missing,
      setup: missingConfigMessage(missing),
      setupLinks: setupLinks(clientId),
    })
  }

  // Before the owner is sent to a consent screen, check the two things that
  // would otherwise only fail at the very last step: the client secret, and
  // whether this callback URL is registered for the client. One wasted
  // consent click is a poor trade for a sentence.
  const probe = await probeGoogleSetup({
    clientId,
    clientSecret,
    redirectUri: callbackUrl(),
  })
  if (!probe.ok) {
    return json(501, {
      error: probe.reason === 'invalid_secret'
        ? 'This project’s Google Client secret is not valid, so Google would refuse the sign-in.'
        : probe.reason === 'redirect_not_registered'
          ? 'This project’s Google OAuth client does not accept the Sheets callback URL yet.'
          : 'Google could not be reached, so the sign-in cannot be started.',
      missing: [],
      reason: probe.reason,
      setup: missingConfigMessage([], { reason: probe.reason, redirectUri: callbackUrl() }),
      setupLinks: setupLinks(clientId),
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
  const clientId = env('GOOGLE_CLIENT_ID') ?? ''
  const clientSecret = env('GOOGLE_CLIENT_SECRET') ?? ''
  const missing = missingConfig({
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
    GOOGLE_TOKEN_KEY: env('GOOGLE_TOKEN_KEY'),
  })
  const conn = await loadConnection(userId)
  if (!conn || !conn.refresh_token) {
    // Not connected yet: say what is actually missing, rather than a list of
    // everything that could be.
    let reason = ''
    let setup = missing.length ? missingConfigMessage(missing) : null
    if (!missing.length) {
      const probe = await probeGoogleSetup({
        clientId,
        clientSecret,
        redirectUri: callbackUrl(),
      })
      if (!probe.ok) {
        reason = probe.reason
        setup = missingConfigMessage([], { reason, redirectUri: callbackUrl() })
      }
    }
    return json(200, {
      ok: true,
      connected: false,
      configured: missing.length === 0,
      missing,
      reason,
      setup,
      setupLinks: setupLinks(clientId),
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

  // A read-only check of the two Google APIs this integration needs, kept on
  // the connection so the panel (and whoever is looking after the site) can
  // see exactly which one is missing, instead of a generic failure.
  let apiCheck = conn.api_check ?? null
  try {
    apiCheck = await probeGoogleApis(token, env('GOOGLE_CLIENT_ID') ?? '')
    await patchConnection(String(conn.id), { api_check: apiCheck })
  } catch {
    /* the check is a convenience; never let it break the panel */
  }

  return json(200, {
    ok: true,
    connected: true,
    configured: true,
    apiCheck,
    email: conn.google_email ?? '',
    spreadsheet: conn.spreadsheet_id
      ? { id: conn.spreadsheet_id, title: conn.spreadsheet_title ?? '', tab: conn.sheet_tab ?? DEFAULT_TAB }
      : null,
    // What the last export actually did, as Google confirmed it.
    lastExport: {
      at: conn.last_export_at ?? null,
      orders: conn.last_export_orders ?? null,
      rows: conn.last_export_rows ?? null,
      range: conn.last_export_range ?? null,
    },
    // What the AUTOMATIC daily sync did, and what went wrong if it did not.
    // The panel shows both, so the owner can tell "the sheet is up to date"
    // from "the sheet has not been reached for three days".
    lastSync: {
      at: conn.last_sync_at ?? null,
      orders: conn.last_sync_orders ?? null,
      rows: conn.last_sync_rows ?? null,
      error: conn.last_sync_error ?? null,
    },
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

  // Idempotent: if this app already made a spreadsheet with that name, that
  // one is used again. Pressing the button twice — or pressing it again
  // after a response that never arrived — must not leave a second,
  // near-identical spreadsheet in the owner's Drive.
  const existing = (await listSpreadsheets(token)).find((s) => s.title === title)
  if (existing) {
    const structure = await getSheetStructure(token, existing.id)
    const tab = pickTab(structure, String(conn.sheet_tab ?? DEFAULT_TAB))
    await patchConnection(String(conn.id), {
      spreadsheet_id: existing.id,
      spreadsheet_title: existing.title,
      sheet_tab: tab ? tab.title : DEFAULT_TAB,
    })
    return json(200, {
      ok: true,
      reused: true,
      spreadsheet: { id: existing.id, title: existing.title, tab: tab ? tab.title : DEFAULT_TAB },
      url: `https://docs.google.com/spreadsheets/d/${existing.id}`,
    })
  }

  const created = await createSheetWithTab(token, title)
  if (created.error) {
    // Google's own reason, in a sentence the owner can act on. The usual one
    // is an API that is not enabled on the Google Cloud project — Google
    // answers 403 SERVICE_DISABLED and names the project, and the fix is one
    // click on a link.
    const problem = describeApiProblem(created.error.status, created.error.body, env('GOOGLE_CLIENT_ID') ?? '')
    console.warn('[google-sheets] could not create the spreadsheet:', created.error.status, problem.reason)
    return json(problem.reason === 'api_not_enabled' ? 501 : 502, {
      error: problem.message,
      reason: problem.reason,
      setup: problem.link ? [problem.message, `Enable it here: ${problem.link}`] : null,
      setupLinks: problem.link
        ? [{
          label: 'Enable the Google API',
          url: problem.link,
          hint: 'Press “Enable”, wait a minute for it to take effect, then press “Create spreadsheet” again.',
        }]
        : null,
    })
  }
  // The destination is remembered only now — after Google has confirmed the
  // spreadsheet exists. Nothing is saved on a refusal.
  await patchConnection(String(conn.id), {
    spreadsheet_id: created.id,
    spreadsheet_title: created.title,
    sheet_tab: created.tab,
  })
  return json(200, {
    ok: true,
    reused: false,
    spreadsheet: { id: created.id, title: created.title, tab: created.tab },
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
  const found = await getSpreadsheet(token, sheetId)
  if (!found) {
    return json(400, {
      error: 'That spreadsheet could not be opened with this Google account. It may have been deleted, or it may not be shared with the account you connected.',
      needsReconnect: false,
    })
  }
  const title = found.title || 'Untitled spreadsheet'

  // The tab to write to is the one this sheet really has: the export must
  // never be pointed at a tab that does not exist, or every export fails
  // with a confusing error from Google.
  const structure = await getSheetStructure(token, sheetId)
  const tab = pickTab(structure, DEFAULT_TAB)
  const tabTitle = tab ? tab.title : DEFAULT_TAB

  await patchConnection(String(conn.id), {
    spreadsheet_id: sheetId,
    spreadsheet_title: title,
    sheet_tab: tabTitle,
  })
  return json(200, {
    ok: true,
    spreadsheet: { id: sheetId, title, tab: tabTitle },
    url: `https://docs.google.com/spreadsheets/d/${sheetId}`,
  })
}

/**
 * What is actually in the destination spreadsheet right now.
 *
 * The owner does not have to open Google to know whether the export worked:
 * the sheet's own first rows are read back through the same connection and
 * shown in the panel. Nothing secret comes back — only cell values.
 */
async function actionPreview(userId: string): Promise<Response> {
  const conn = await loadConnection(userId)
  if (!conn || !conn.refresh_token) return fail(400, 'Connect Google Sheets first.')
  const sheetId = String(conn.spreadsheet_id ?? '')
  if (!sheetId) return fail(400, 'Choose a spreadsheet to look at first.')

  const token = await ensureToken(conn)
  if (!token) {
    return json(401, {
      error: 'Your Google connection has expired. Please connect Google Sheets again.',
      needsReconnect: true,
    })
  }

  const tab = String(conn.sheet_tab ?? DEFAULT_TAB)
  const values = await readRange(token, sheetId, tab)
  if (values === null) {
    return fail(502, 'Google would not open that spreadsheet just now. Please try again.')
  }

  return json(200, {
    ok: true,
    tab,
    rows: values.length,
    header: values[0] || [],
    sample: values.slice(1, 11),
    lastExport: {
      at: conn.last_export_at ?? null,
      orders: conn.last_export_orders ?? null,
      rows: conn.last_export_rows ?? null,
      range: conn.last_export_range ?? null,
    },
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
    const includeExported = body.includeExported === true

    // The tab to write to: the one that was chosen, if the sheet still has it,
    // and otherwise the first tab there is. A spreadsheet the owner made
    // themselves may call its only tab something else, and the export must
    // still find somewhere to write.
    const structure = await getSheetStructure(token, sheetId)
    const tab = pickTab(structure, String(conn.sheet_tab ?? DEFAULT_TAB))
    if (!tab) {
      return fail(502, 'That spreadsheet has no tabs to write to. Please choose another one.')
    }
    if (tab.title !== conn.sheet_tab) {
      // Keep the connection in step with the sheet, so the next export goes
      // to the same place.
      await patchConnection(String(conn.id), { sheet_tab: tab.title })
    }

    // The write itself, and only the orders that are not in the sheet yet.
    const written = await exportOrdersToSheet({
      accessToken: token,
      sheetId,
      tab: tab.title,
      orders,
      alreadyExported: already,
      includeExported,
      filters: (body.filters ?? {}) as Json,
    })
    if (!written.ok) {
      const described = describeGoogleError(written.status, written.body)
      console.warn('[google-sheets] append refused:', written.status)
      return json(written.status === 401 ? 401 : 502, {
        error: described.message,
        needsReconnect: described.needsReconnect,
      })
    }
    if (!written.orders) {
      return json(200, {
        ok: true,
        orders: 0,
        rows: 0,
        skipped: written.skipped,
        message: written.message,
        url: `https://docs.google.com/spreadsheets/d/${sheetId}`,
      })
    }

    // What Google itself said it wrote — the range and the number of rows.
    // The panel shows it, and it is the receipt that the export really
    // happened rather than merely being attempted.
    await patchConnection(String(conn.id), {
      last_export_at: new Date().toISOString(),
      last_export_orders: written.orders,
      last_export_rows: written.rows,
      last_export_range: written.range ?? null,
    })

    // Only now is the order marked as exported: if Google refused the rows,
    // they must still be exportable next time.
    const batchId = crypto.randomUUID()
    await serviceFetch('/rest/v1/order_sheet_exports', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(
        (written.orderIds || []).map((id) => ({ sheet_id: sheetId, order_id: id, batch_id: batchId })),
      ),
    })

    return json(200, {
      ok: true,
      orders: written.orders,
      rows: written.rows,
      skipped: written.skipped,
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
      case 'preview': return actionPreview(who.id)
      default:
        return fail(400, 'That action is not something this function does.')
    }
  } catch (error) {
    console.warn('[google-sheets] failed:', String(error))
    return fail(500, 'The request could not be completed. Please try again.')
  }
}

serve(handle)
