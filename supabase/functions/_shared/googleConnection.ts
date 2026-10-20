// The owner's Google Sheets connection: reading it, refreshing its token and
// writing back to it.
//
// These were private to the `google-sheets` function. The automatic daily sync
// needs exactly the same three things — read the connection, get a working
// access token, remember what happened — so they live here and both callers
// use one implementation. A second copy of the token refresh would be a
// second thing to keep in step with Google's rules.
//
// The tokens are stored ENCRYPTED (`AES-256-GCM`, keyed by `GOOGLE_TOKEN_KEY`)
// and are only ever decrypted here, in the server, on their way to Google.

import { env } from './env.ts'
import { asString, type Json } from './http.ts'
import { serviceFetch } from './supabase.ts'
import {
  decodeJwtPayload,
  decryptText,
  encodeRefreshForm,
  encryptText,
  GOOGLE_TOKEN_ENDPOINT,
  readTokenResponse,
} from './googleOAuth.mjs'

/** The connection row for an owner (there is one per admin who connects). */
export async function loadConnection(ownerId: string): Promise<Json | null> {
  const res = await serviceFetch(
    `/rest/v1/google_sheets_connections?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&limit=1`,
  )
  if (!res.ok) return null
  const rows = (await res.json().catch(() => [])) as Json[]
  return Array.isArray(rows) && rows.length ? rows[0] : null
}

/**
 * The connection of the store — the one that has a spreadsheet chosen.
 *
 * The automatic sync has no browser session and therefore no owner to ask
 * about, so it finds the connection that is actually set up. If the owner has
 * never connected, or has not chosen a spreadsheet, there is nothing to sync
 * and the sync says so.
 */
export async function loadAnyConnection(): Promise<Json | null> {
  const res = await serviceFetch(
    '/rest/v1/google_sheets_connections?select=*&spreadsheet_id=not.is.null&limit=1',
  )
  if (!res.ok) return null
  const rows = (await res.json().catch(() => [])) as Json[]
  return Array.isArray(rows) && rows.length ? rows[0] : null
}

/** Write a field of the connection back to the database. */
export async function patchConnection(id: string, patch: Json): Promise<void> {
  await serviceFetch(`/rest/v1/google_sheets_connections?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  })
}

/** Swap the refresh token for a fresh access token. */
export async function refreshAccessToken(conn: Json): Promise<{ token: string; expiresAt: string } | null> {
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

/**
 * A working access token for this connection.
 *
 * The stored token is used while it is still good; otherwise a fresh one is
 * fetched. An empty string means "this connection cannot be used" — the
 * owner has to connect again — and the caller must report that rather than
 * carrying on.
 */
export async function ensureToken(conn: Json): Promise<string> {
  const key = env('GOOGLE_TOKEN_KEY') ?? ''
  const expires = conn.access_expires_at ? new Date(String(conn.access_expires_at)).getTime() : 0
  if (conn.access_token && expires - Date.now() > 60_000) {
    const token = await decryptText(String(conn.access_token), key)
    if (token) return token
  }
  const refreshed = await refreshAccessToken(conn)
  return refreshed?.token ?? ''
}

/** The email of the Google account behind the connection, for the panel. */
export function connectionEmail(conn: Json): string {
  return asString(conn?.google_email)
}
