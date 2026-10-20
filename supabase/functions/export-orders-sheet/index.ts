// export-orders-sheet
//
// Sends the orders the admin is currently looking at to a Google Sheet.
//
// Everything private happens here and nowhere else: the service-account
// private key lives in Edge Function secrets, is used to sign a short-lived
// Google OAuth token inside this runtime, and is never returned, logged or
// bundled for a browser. The browser sends nothing but the ids of the rows it
// already has on screen (RLS decides what those are) and the filter labels for
// the banner row.
//
// Authorisation is checked here, not trusted from the client: the caller's
// own JWT is exchanged for their user id, and that id must be present in
// `public.admins`. A forged body cannot reach another customer's order.
//
// When the Google side has not been configured yet the function answers with
// the exact setup steps — it never claims an export happened.

import { serve } from '../_shared/deno.ts'
import { env } from '../_shared/env.ts'
import { asString, fail, json, preflight, readJson, type Json } from '../_shared/http.ts'
import { serviceFetch } from '../_shared/supabase.ts'
import { buildSheetValues, missingConfig, missingConfigMessage } from '../_shared/sheetRows.mjs'

const MAX_IDS = 5000
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

/** base64url — Google's JWT framing, not base64. */
function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** PKCS#8 PEM -> DER bytes, without ever printing the key. */
function der(pem: string): Uint8Array {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  const bin = atob(body)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * A Google OAuth access token for a service account.
 *
 * The key is read from the environment inside this runtime, used to sign a
 * one-hour assertion, and discarded. `kid` is included because Google asks
 * for it when the key carries one (a p12-derived key); a JSON key works
 * without it.
 */
async function accessToken(): Promise<string> {
  const email = env('GOOGLE_SERVICE_ACCOUNT_EMAIL') ?? ''
  const key = (env('GOOGLE_PRIVATE_KEY') ?? '').replace(/\\n/g, '\n')
  const issued = Math.floor(Date.now() / 1000)

  const header: Json = { alg: 'RS256', typ: 'JWT' }
  const claims: Json = {
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: issued,
    exp: issued + 3600,
  }
  const signingInput = `${b64url(utf8(JSON.stringify(header)))}.${b64url(utf8(JSON.stringify(claims)))}`

  const imported = await crypto.subtle.importKey(
    'pkcs8',
    der(key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    imported,
    utf8(signingInput),
  )
  const assertion = `${signingInput}.${b64url(new Uint8Array(signature))}`

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}`
      + `&assertion=${encodeURIComponent(assertion)}`,
  })
  const body = (await res.json().catch(() => null)) as { access_token?: string } | null
  if (!res.ok || !body?.access_token) {
    console.warn('[export-orders-sheet] Google refused the service account:', res.status)
    throw new Error('google-token-refused')
  }
  return body.access_token
}

/** Who is calling? The caller's own JWT, verified by Supabase Auth itself. */
async function callerId(authorization: string): Promise<string> {
  const token = authorization.replace(/^bearer\s+/i, '').trim()
  if (!token) return ''
  const res = await fetch(`${(env('SUPABASE_URL') ?? '').replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: env('SUPABASE_ANON_KEY') ?? '',
      Authorization: `Bearer ${token}`,
    },
  })
  if (!res.ok) return ''
  const user = (await res.json().catch(() => null)) as { id?: string } | null
  return user?.id ?? ''
}

/** An admin, or nothing. `public.admins` holds one row per owner account. */
async function isAdmin(userId: string): Promise<boolean> {
  if (!userId) return false
  const res = await serviceFetch(
    `/rest/v1/admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id&limit=1`,
  )
  if (!res.ok) return false
  const rows = (await res.json().catch(() => [])) as Json[]
  return Array.isArray(rows) && rows.length === 1
}

/** The orders named by the request, WITH their line items. */
async function loadOrders(ids: string[]): Promise<Json[]> {
  const list = ids.map((id) => encodeURIComponent(id)).join(',')
  const res = await serviceFetch(
    '/rest/v1/orders'
      + `?id=in.(${list})`
      + '&select=id,reference,created_at,status,payment_status,full_name,email,phone,address,city,state,pincode,'
      + 'subtotal,discount,coupon_code,shipping,total,razorpay_order_id,razorpay_payment_id,note,'
      + 'order_items(title,size,qty,unit_price)'
      + '&order=created_at.desc&limit=5000',
  )
  if (!res.ok) {
    console.warn('[export-orders-sheet] orders not readable:', res.status)
    return []
  }
  const rows = (await res.json().catch(() => [])) as Json[]
  return Array.isArray(rows) ? rows : []
}

export async function handle(req: Request): Promise<Response> {
  const early = preflight(req) ?? (req.method === 'POST' ? null : fail(405, 'Method not allowed.'))
  if (early) return early

  try {
    // ---- who is asking -------------------------------------------------
    const userId = await callerId(req.headers.get('Authorization') ?? '')
    if (!(await isAdmin(userId))) {
      return fail(403, 'Only the store owner can export orders to Google Sheets.')
    }

    // ---- is the integration configured at all? -------------------------
    const missing = missingConfig({
      GOOGLE_SERVICE_ACCOUNT_EMAIL: env('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
      GOOGLE_PRIVATE_KEY: env('GOOGLE_PRIVATE_KEY'),
      GOOGLE_SHEET_ID: env('GOOGLE_SHEET_ID'),
    })
    if (missing.length) {
      // 501, not 200: an export that never reached Google must never look
      // like one that did.
      return json(501, {
        error: 'Google Sheets export is not configured on this project yet.',
        missing,
        setup: missingConfigMessage(missing),
      })
    }

    // ---- what are they exporting? --------------------------------------
    const body = await readJson(req)
    const rawIds = Array.isArray(body.ids) ? body.ids : []
    const ids = rawIds.map((v) => asString(v)).filter(Boolean)
    if (!ids.length) return fail(400, 'There are no orders to export.')
    if (ids.length > MAX_IDS) {
      return fail(400, `Please narrow the export to at most ${MAX_IDS} orders.`)
    }

    const orders = await loadOrders(ids)
    if (!orders.length) return fail(400, 'None of those orders could be read.')

    const values = buildSheetValues(orders, (body.filters ?? {}) as Json)

    // ---- write them ----------------------------------------------------
    const token = await accessToken()
    const sheetId = env('GOOGLE_SHEET_ID') ?? ''
    const tab = env('GOOGLE_SHEET_NAME') || 'Orders'
    const range = `${encodeURIComponent(tab)}!A1`
    const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`
      + `/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.warn('[export-orders-sheet] append failed:', res.status, detail.slice(0, 300))
      if (res.status === 401 || res.status === 403) {
        return json(501, {
          error: 'Google refused the service account.',
          setup: [
            'The service account could not sign in, or its key is not valid.',
            'Check GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY, then deploy again.',
          ],
        })
      }
      if (res.status === 404) {
        return json(501, {
          error: 'That spreadsheet could not be found, or the service account cannot open it.',
          setup: [
            'Open the sheet in Google Sheets → Share → add the service account email as an Editor.',
            'Check GOOGLE_SHEET_ID is the spreadsheet id from its URL.',
          ],
        })
      }
      return fail(502, 'Google Sheets did not accept the export. Please try again.')
    }

    return json(200, {
      ok: true,
      rows: values.length,
      orders: orders.length,
      url: `https://docs.google.com/spreadsheets/d/${sheetId}`,
    })
  } catch (error) {
    console.warn('[export-orders-sheet] failed:', String(error))
    return fail(500, 'The export could not be completed. Please try again.')
  }
}

serve(handle)
