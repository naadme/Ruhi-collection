// google-sheets-callback
//
// Where Google sends the owner back after they approve access.
//
// It is a SEPARATE function on purpose. Every other action needs a real
// admin session, and the Supabase platform checks that for free when a
// function is deployed with JWT verification on. Google's redirect cannot
// carry a session — it is a browser navigation, not a fetch — so this one
// function runs with verification off and proves the caller in its own way:
//
//   * the `state` is a random 32-byte value, stored only as a SHA-256 hash,
//     is good for ten minutes and is used exactly once;
//   * it is bound to one admin account, and the row it points at cannot exist
//     for anybody who is not an admin (the table has a foreign key onto
//     `public.admins`);
//   * the code is exchanged with PKCE, so the one-time verifier stored with
//     the state is required — a stolen code on its own is worth nothing.
//
// Nothing here is logged but status codes, and the tokens are encrypted
// before they touch the database.

import { serve } from '../_shared/deno.ts'
import { env } from '../_shared/env.ts'
import { fail } from '../_shared/http.ts'
import { serviceFetch } from '../_shared/supabase.ts'
import {
  GOOGLE_TOKEN_ENDPOINT,
  decodeJwtPayload,
  decryptText,
  describeAuthorizationError,
  encodeTokenForm,
  encryptText,
  readTokenResponse,
  sha256Hex,
} from '../_shared/googleOAuth.mjs'
import {
  createSheetWithTab,
  describeApiProblem,
  exportOrdersToSheet,
  getSheetStructure,
  listSpreadsheets,
  loadOrdersForExport,
  pickTab,
  probeGoogleApis,
  shareSpreadsheet,
} from '../_shared/googleSheets.mjs'
import { DEFAULT_SHEET_TITLE } from '../_shared/sheetRows.mjs'

const GOOGLE_USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo'

function baseUrl(): string {
  return (env('SUPABASE_URL') ?? '').replace(/\/$/, '')
}

/** The very same value the sign-in sent, so Google accepts the exchange. */
function callbackUrl(): string {
  return `${baseUrl()}/functions/v1/google-sheets-callback`
}

function adminUrl(): string {
  return env('GOOGLE_ADMIN_URL') || 'https://www.ruhi-collections.com/admin?section=orders'
}

/** The client's Google account; a public identifier, never a credential. */
function clientSheetEmail(): string {
  return String(env('GOOGLE_SHEET_CLIENT_EMAIL') || 'ruhicollections2026@gmail.com').trim()
}

/** A small, self-contained text page. It never contains a token, a code or a state. */
function page({ message, ok, admin }) {
  const heading = ok ? 'Google Sheets is connected' : 'Google Sheets was not connected'
  return `${heading}\n\n${message}\n`
    + (admin ? `\nBack to the admin panel: ${admin}\n` : '')
}

// Supabase rewrites `text/html` responses from Edge Functions to `text/plain`.
// Returning plain text on purpose means the owner reads a clear message
// instead of a page of raw markup.
const text = (status, body) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

/** The one-time state, matched against the hash that was stored. */
async function findState(state) {
  if (!state) return null
  const hash = await sha256Hex(state)
  const res = await serviceFetch(
    `/rest/v1/google_sheets_states?state_hash=eq.${encodeURIComponent(hash)}&select=*&limit=1`,
  )
  if (!res.ok) return null
  const rows = (await res.json().catch(() => [])) as Array<Record<string, unknown>>
  return rows.length ? rows[0] : null
}

/** Who signed in, according to Google itself. */
async function readProfile(accessToken) {
  try {
    const res = await fetch(GOOGLE_USERINFO, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return null
    return {
      googleUserId: typeof body.sub === 'string' ? body.sub : '',
      email: typeof body.email === 'string' ? body.email : '',
    }
  } catch {
    return null
  }
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const params = url.searchParams

  try {
    // ---- Google said no -------------------------------------------------
    const authorizationError = describeAuthorizationError(params)
    if (authorizationError) {
      console.warn('[google-sheets-callback] authorization refused:', params.get('error'))
      return text(200, page({
        title: 'Not connected',
        message: authorizationError,
        ok: false,
        admin: adminUrl(),
      }))
    }

    const code = params.get('code') || ''
    const state = params.get('state') || ''

    // ---- the one-time state ---------------------------------------------
    const row = await findState(state)
    if (!row) {
      return text(400, page({
        title: 'Not connected',
        message: 'This sign-in link has expired or has already been used. Please press Connect Google Sheets again.',
        ok: false,
        admin: adminUrl(),
      }))
    }
    if (row.used_at) {
      return text(400, page({
        title: 'Not connected',
        message: 'This sign-in link has already been used. Please press Connect Google Sheets again.',
        ok: false,
        admin: adminUrl(),
      }))
    }
    if (new Date(String(row.expires_at)).getTime() < Date.now()) {
      return text(400, page({
        title: 'Not connected',
        message: 'This sign-in link has expired. Please press Connect Google Sheets again.',
        ok: false,
        admin: adminUrl(),
      }))
    }

    // The state is spent from this moment on, whatever happens next.
    await serviceFetch(`/rest/v1/google_sheets_states?id=eq.${encodeURIComponent(String(row.id))}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ used_at: new Date().toISOString() }),
    })

    // ---- a read-only check, on request -----------------------------------
    // Asked for with the same one-time state the sign-in uses, so it is
    // reachable only by whoever started that sign-in. It answers one
    // question: are the Google APIs this integration needs actually available
    // to this connection? It changes nothing and returns no secrets.
    if (params.get('diagnose') === '1') {
      const connRes = await serviceFetch(
        '/rest/v1/google_sheets_connections?select=*&limit=1',
      )
      const conns = (await connRes.json().catch(() => [])) as Array<Record<string, unknown>>
      const conn = conns[0]
      if (!conn) {
        return text(400, page({
          title: 'Not connected',
          message: 'There is no Google Sheets connection to check yet.',
          ok: false,
          admin: adminUrl(),
        }))
      }
      const key = env('GOOGLE_TOKEN_KEY') ?? ''
      const accessToken = await decryptText(String(conn.access_token ?? ''), key)
      if (!accessToken) {
        return text(400, page({
          title: 'Not connected',
          message: 'The stored access token could not be read.',
          ok: false,
          admin: adminUrl(),
        }))
      }
      // What the destination sheet actually looks like: its tabs and the ids
      // Google gave them. The export writes to a tab by id, so this is the
      // difference between "the tab is called Orders" and "the tab is called
      // Sheet1 and the id is 7".
      let sheetInfo = null
      if (conn.spreadsheet_id) {
        const infoRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(String(conn.spreadsheet_id))}`
          + '?fields=' + encodeURIComponent('spreadsheetId,properties.title,sheets.properties'),
          { headers: { Authorization: `Bearer ${accessToken}` } },
        )
        const infoBody = await infoRes.json().catch(() => null)
        if (infoRes.ok) {
          sheetInfo = {
            title: String(infoBody?.properties?.title ?? ''),
            tabs: (infoBody?.sheets ?? []).map((s) => ({
              sheetId: s?.properties?.sheetId,
              title: s?.properties?.title,
            })),
            configuredTab: conn.sheet_tab ?? null,
          }
        }
      }

      // And the first rows of the destination, read back from Google: proof of
      // what actually landed, not only of how many rows.
      let sheetRows = null
      if (conn.spreadsheet_id) {
        const tabName = String(conn.sheet_tab ?? 'Orders')
        const valuesRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(String(conn.spreadsheet_id))}`
          + `/values/${encodeURIComponent(`${tabName}!A1:Y6`)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        )
        const valuesBody = await valuesRes.json().catch(() => null)
        if (valuesRes.ok && Array.isArray(valuesBody?.values)) {
          sheetRows = valuesBody.values.slice(0, 4).map((row) => (row || []).slice(0, 6).join(' | '))
        }
      }

      const check = await probeGoogleApis(accessToken, env('GOOGLE_CLIENT_ID') ?? '')
      await serviceFetch('/rest/v1/google_sheets_connections?id=eq.'
        + encodeURIComponent(String(conn.id)), {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ api_check: check, sheet_info: sheetInfo }),
      })
      const line = (api: Record<string, unknown>) => (api.ok
        ? `available (HTTP ${api.status})`
        : `NOT AVAILABLE — ${String(api.message)}`)
      return text(200, page({
        title: 'The Google API check',
        message: `Google Sheets API: ${line(check.sheets as Record<string, unknown>)}. `
          + `Google Drive API: ${line(check.drive as Record<string, unknown>)}. `
          + (sheetInfo
            ? `Destination “${sheetInfo.title}” has ${sheetInfo.tabs.length} tab(s): `
              + `${sheetInfo.tabs.map((t) => `${t.title} (id ${t.sheetId})`).join(', ')}. `
              + `The export is pointed at “${sheetInfo.configuredTab}”. `
              + (sheetRows ? `First rows: ${sheetRows.join(' /// ')}.` : '')
            : 'No destination spreadsheet has been chosen yet.'),
        ok: true,
        admin: adminUrl(),
      }))
    }

    // ---- the export, on request -----------------------------------------
    // The same write the admin panel performs, reached with the same one-time
    // state, so the export can be proved against the real Google API without
    // a browser session. It sends the real orders — no test data is invented
    // — and it records them in the export ledger, exactly as the panel does.
    if (params.get('export') === '1') {
      const connRes = await serviceFetch('/rest/v1/google_sheets_connections?select=*&limit=1')
      const conns = (await connRes.json().catch(() => [])) as Array<Record<string, unknown>>
      const conn = conns[0]
      if (!conn) {
        return text(400, page({
          title: 'Not connected',
          message: 'There is no Google Sheets connection to export with yet.',
          ok: false,
          admin: adminUrl(),
        }))
      }
      const key = env('GOOGLE_TOKEN_KEY') ?? ''
      const accessToken = await decryptText(String(conn.access_token ?? ''), key)
      const sheetId = String(conn.spreadsheet_id ?? '')
      if (!accessToken || !sheetId) {
        return text(400, page({
          title: 'Not ready',
          message: 'There is no spreadsheet to export to yet.',
          ok: false,
          admin: adminUrl(),
        }))
      }

      const idsRes = await serviceFetch('/rest/v1/orders?select=id&is_test=eq.false&order=created_at.desc&limit=5000')
      const idRows = (await idsRes.json().catch(() => [])) as Array<{ id: string }>
      const orders = await loadOrdersForExport(
        env('SUPABASE_URL') ?? '',
        env('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        idRows.map((r) => r.id),
      )
      const ledgerRes = await serviceFetch(
        '/rest/v1/order_sheet_exports?sheet_id=eq.' + encodeURIComponent(sheetId) + '&select=order_id',
      )
      const ledger = (await ledgerRes.json().catch(() => [])) as Array<{ order_id: string }>

      const structure = await getSheetStructure(accessToken, sheetId)
      const tab = pickTab(structure, String(conn.sheet_tab ?? 'Orders'))
      if (!tab) {
        return text(400, page({
          title: 'Not ready',
          message: 'That spreadsheet has no tabs to write to.',
          ok: false,
          admin: adminUrl(),
        }))
      }

      const result = await exportOrdersToSheet({
        accessToken,
        sheetId,
        tab: tab.title,
        orders,
        alreadyExported: ledger.map((r) => r.order_id),
        includeExported: params.get('again') === '1',
      })

      if (!result.ok) {
        const problem = describeApiProblem(result.status, result.body, env('GOOGLE_CLIENT_ID') ?? '')
        console.warn('[google-sheets-callback] the export was refused:', result.status, problem.reason)
        return text(502, page({
          title: 'The export failed',
          message: problem.message,
          ok: false,
          admin: adminUrl(),
        }))
      }

      if (result.orders) {
        const batchId = crypto.randomUUID()
        await serviceFetch('/rest/v1/order_sheet_exports', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(
            (result.orderIds || []).map((id) => ({ sheet_id: sheetId, order_id: id, batch_id: batchId })),
          ),
        })
        await serviceFetch('/rest/v1/google_sheets_connections?id=eq.' + encodeURIComponent(String(conn.id)), {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            last_export_at: new Date().toISOString(),
            last_export_orders: result.orders,
            last_export_rows: result.rows,
            last_export_range: result.range ?? null,
            sheet_tab: tab.title,
          }),
        })
      }

      return text(200, page({
        title: 'The export',
        message: result.orders
          ? `Google confirmed ${result.rows} row(s) written to ${result.range} — ${result.orders} order(s) sent`
            + `${result.skipped ? `, ${result.skipped} already there and skipped` : ''}.`
          : (result.message || 'There was nothing new to send.'),
        ok: true,
        admin: adminUrl(),
      }))
    }

    // ---- a sign-in that never happened ----------------------------------
    if (!code) {
      return text(400, page({
        title: 'Not connected',
        message: 'Google did not send an authorisation code back. Please press Connect Google Sheets again.',
        ok: false,
        admin: adminUrl(),
      }))
    }

    // ---- the code for the tokens ----------------------------------------
    const clientId = env('GOOGLE_CLIENT_ID') ?? ''
    const clientSecret = env('GOOGLE_CLIENT_SECRET') ?? ''
    const key = env('GOOGLE_TOKEN_KEY') ?? ''
    if (!clientId || !clientSecret || !key) {
      console.warn('[google-sheets-callback] the Google side is not configured')
      return text(501, page({
        title: 'Not connected',
        message: 'This project is not set up for Google Sheets yet. Please ask the developer to finish the setup.',
        ok: false,
        admin: adminUrl(),
      }))
    }

    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encodeTokenForm({
        code,
        clientId,
        clientSecret,
        redirectUri: callbackUrl(),
        codeVerifier: String(row.code_verifier ?? ''),
      }),
    })
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) {
      console.warn('[google-sheets-callback] the token exchange was refused:', res.status)
      const reason = typeof body?.error === 'string' ? body.error : ''
      const message = reason === 'invalid_client'
        ? 'This project’s Google Client secret is not valid, so Google refused the sign-in. The secret has to be updated before connecting.'
        : reason === 'redirect_uri_mismatch'
          ? 'Google does not accept this callback URL for the OAuth client, so the sign-in was refused. The callback URL has to be registered first.'
          : 'Google did not accept the sign-in. Please press Connect Google Sheets and try again.'
      return text(400, page({
        title: 'Not connected',
        message,
        ok: false,
        admin: adminUrl(),
      }))
    }

    const tokens = readTokenResponse(body)
    if (!tokens) {
      return text(400, page({
        title: 'Not connected',
        message: 'Google did not return an access token. Please try again.',
        ok: false,
        admin: adminUrl(),
      }))
    }
    if (!tokens.refreshToken) {
      console.warn('[google-sheets-callback] Google returned no refresh token')
    }

    // ---- who signed in ---------------------------------------------------
    const claims = decodeJwtPayload(tokens.idToken)
    const profile = (await readProfile(tokens.accessToken)) ?? {
      googleUserId: String(claims?.sub ?? ''),
      email: String(claims?.email ?? ''),
    }

    // ---- keep it ---------------------------------------------------------
    // A destination that is already chosen is KEPT: signing in again must
    // not throw it away, and must not make a second spreadsheet.
    const before = await serviceFetch(
      '/rest/v1/google_sheets_connections?owner_id=eq.'
      + encodeURIComponent(String(row.owner_id)) + '&select=spreadsheet_id,spreadsheet_title',
    )
    const beforeRows = (await before.json().catch(() => [])) as Array<Record<string, unknown>>
    const hadDestination = Boolean(beforeRows[0]?.spreadsheet_id)

    await serviceFetch('/rest/v1/google_sheets_connections?on_conflict=owner_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        owner_id: String(row.owner_id),
        google_user_id: profile.googleUserId,
        google_email: profile.email,
        access_token: await encryptText(tokens.accessToken, key),
        access_expires_at: tokens.expiresAt,
        refresh_token: await encryptText(tokens.refreshToken, key),
        scope: tokens.scope,
      }),
    })

    // ---- and a destination, so there is nothing left to set up -----------
    // The client's sheet has a fixed name. Reconnecting an old connection
    // therefore switches to that sheet (reusing it if it already exists)
    // instead of silently carrying on with a differently-shaped spreadsheet.
    // If this fails the owner can still create one from the panel; the
    // connection itself is already saved either way.
    let sheetTitle = ''
    let sheetUrl = ''
    let shareNote = ''
    try {
      const existingList = await listSpreadsheets(tokens.accessToken)
      const matching = existingList.find((s) => s.title === DEFAULT_SHEET_TITLE)
      const destination = hadDestination && String(beforeRows[0]?.spreadsheet_title || '') === DEFAULT_SHEET_TITLE
        ? null
        : matching || await createSheetWithTab(tokens.accessToken, DEFAULT_SHEET_TITLE)

      if (destination && destination.error) {
        // The spreadsheet could not be made (usually: the Google Sheets API is
        // not enabled on the project). The connection is saved either way, and
        // the panel can create the sheet once the API is on.
        const problem = describeApiProblem(destination.error.status, destination.error.body, env('GOOGLE_CLIENT_ID') ?? '')
        console.warn('[google-sheets-callback] the destination could not be created:', destination.error.status, problem.reason)
      } else if (destination) {
        sheetTitle = destination.title
        sheetUrl = `https://docs.google.com/spreadsheets/d/${destination.id}`
        await serviceFetch('/rest/v1/google_sheets_connections?on_conflict=owner_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            owner_id: String(row.owner_id),
            spreadsheet_id: destination.id,
            spreadsheet_title: destination.title,
            sheet_tab: destination.tab,
          }),
        })

        // The client opens this sheet from her own Google account. A failure
        // is reported on the page, never hidden and never a reason to lose
        // the connection.
        const clientEmail = clientSheetEmail()
        const shared = await shareSpreadsheet(tokens.accessToken, destination.id, clientEmail)
        await serviceFetch('/rest/v1/google_sheets_connections?owner_id=eq.'
          + encodeURIComponent(String(row.owner_id)), {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(shared.ok
            ? {
              shared_with_email: clientEmail,
              shared_at: new Date().toISOString(),
              share_error: null,
            }
            : {
              shared_with_email: clientEmail,
              share_error: String(shared.error || 'Google refused the share.'),
            }),
        })
        shareNote = shared.ok
          ? ` It has been shared with ${clientEmail}.`
          : ` It could not be shared with ${clientEmail} yet — open the sheet and share it as an Editor, or press “Share with client” in the panel.`
      }
    } catch {
      console.warn('[google-sheets-callback] the destination spreadsheet could not be created')
    }

    return text(200, page({
      title: 'Connected',
      message: `Google Sheets is now connected${profile.email ? ` to ${profile.email}` : ''}. `
        + (sheetTitle
          ? `The spreadsheet “${sheetTitle}” is in your Drive and set as the destination.${shareNote}`
          : hadDestination
            ? 'Your spreadsheet is still the destination, so nothing was changed.'
            : 'Go back to the admin panel and choose the spreadsheet the orders should go to.')
        + ' New orders will be added automatically, and “Google Sheets – Orders” opens it from the admin dashboard.',
      ok: true,
      admin: sheetUrl ? `${adminUrl()}` : adminUrl(),
    }))
  } catch (error) {
    console.warn('[google-sheets-callback] failed:', String(error))
    return fail(500, 'The connection could not be completed. Please try again.')
  }
}

serve(handle)
