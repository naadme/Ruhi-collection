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
  describeAuthorizationError,
  encodeTokenForm,
  encryptText,
  readTokenResponse,
  sha256Hex,
} from '../_shared/googleOAuth.mjs'
import { createSheetWithTab, describeApiProblem } from '../_shared/googleSheets.mjs'

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

/** Everything that goes into the page is escaped — no exceptions. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** A small, self-contained page. It never contains a token, a code or a state. */
function page({ title, message, ok, admin }) {
  const heading = ok ? 'Google Sheets is connected' : 'Google Sheets was not connected'
  const colour = ok ? '#0f7b3f' : '#b42318'
  const button = admin
    ? `<p style="margin:26px 0 0"><a href="${escapeHtml(admin)}"`
      + ' style="display:inline-block;background:#000;color:#fff;text-decoration:none;'
      + 'padding:12px 22px;border-radius:8px;font-size:15px">Back to the admin panel</a></p>'
    : ''
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(heading)}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F8EDE6;
       font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#2b2b2b}
  .card{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:16px;padding:32px;
        max-width:520px;margin:24px;box-shadow:0 12px 40px rgba(74,44,35,.08)}
  h1{font-size:22px;margin:0 0 10px}
  p{margin:0;font-size:15px;line-height:1.6;color:#555}
  .dot{width:12px;height:12px;border-radius:999px;background:${colour};display:inline-block;margin-right:8px}
</style></head>
<body><div class="card">
  <h1><span class="dot"></span>${escapeHtml(heading)}</h1>
  <p>${escapeHtml(message)}</p>
  ${button}
</div></body></html>`
}

const html = (status, body) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

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
      return html(200, page({
        title: 'Not connected',
        message: authorizationError,
        ok: false,
        admin: adminUrl(),
      }))
    }

    const code = params.get('code') || ''
    const state = params.get('state') || ''
    if (!code) {
      return html(400, page({
        title: 'Not connected',
        message: 'Google did not send an authorisation code back. Please press Connect Google Sheets again.',
        ok: false,
        admin: adminUrl(),
      }))
    }

    // ---- the one-time state ---------------------------------------------
    const row = await findState(state)
    if (!row) {
      return html(400, page({
        title: 'Not connected',
        message: 'This sign-in link has expired or has already been used. Please press Connect Google Sheets again.',
        ok: false,
        admin: adminUrl(),
      }))
    }
    if (row.used_at) {
      return html(400, page({
        title: 'Not connected',
        message: 'This sign-in link has already been used. Please press Connect Google Sheets again.',
        ok: false,
        admin: adminUrl(),
      }))
    }
    if (new Date(String(row.expires_at)).getTime() < Date.now()) {
      return html(400, page({
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

    // ---- the code for the tokens ----------------------------------------
    const clientId = env('GOOGLE_CLIENT_ID') ?? ''
    const clientSecret = env('GOOGLE_CLIENT_SECRET') ?? ''
    const key = env('GOOGLE_TOKEN_KEY') ?? ''
    if (!clientId || !clientSecret || !key) {
      console.warn('[google-sheets-callback] the Google side is not configured')
      return html(501, page({
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
      return html(400, page({
        title: 'Not connected',
        message,
        ok: false,
        admin: adminUrl(),
      }))
    }

    const tokens = readTokenResponse(body)
    if (!tokens) {
      return html(400, page({
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
        // A new connection starts with no destination: the owner chooses the
        // spreadsheet, or lets the app create one.
        spreadsheet_id: null,
        spreadsheet_title: null,
        sheet_tab: null,
      }),
    })

    // ---- and a destination, so there is nothing left to set up -----------
    // A spreadsheet of the owner's own, with the tab the export writes to.
    // If this fails the owner can still create one from the panel; the
    // connection itself is already saved either way.
    let sheetTitle = ''
    try {
      const created = await createSheetWithTab(tokens.accessToken, 'Ruhi Collection — Orders')
      if (created?.error) {
        // The spreadsheet could not be made (usually: the Google Sheets API is
        // not enabled on the project). The connection is saved either way, and
        // the panel can create the sheet once the API is on.
        const problem = describeApiProblem(created.error.status, created.error.body, env('GOOGLE_CLIENT_ID') ?? '')
        console.warn('[google-sheets-callback] the destination could not be created:', created.error.status, problem.reason)
      } else if (created) {
        sheetTitle = created.title
        await serviceFetch('/rest/v1/google_sheets_connections?on_conflict=owner_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            owner_id: String(row.owner_id),
            spreadsheet_id: created.id,
            spreadsheet_title: created.title,
            sheet_tab: created.tab,
          }),
        })
      }
    } catch {
      console.warn('[google-sheets-callback] the destination spreadsheet could not be created')
    }

    return html(200, page({
      title: 'Connected',
      message: `Google Sheets is now connected${profile.email ? ` to ${profile.email}` : ''}. `
        + (sheetTitle
          ? `A spreadsheet called “${sheetTitle}” has been created in your Drive and set as the destination.`
          : 'Go back to the admin panel and choose the spreadsheet the orders should go to.')
        + ' Press “Export to Google Sheets” to send the orders on screen.',
      ok: true,
      admin: adminUrl(),
    }))
  } catch (error) {
    console.warn('[google-sheets-callback] failed:', String(error))
    return fail(500, 'The connection could not be completed. Please try again.')
  }
}

serve(handle)
