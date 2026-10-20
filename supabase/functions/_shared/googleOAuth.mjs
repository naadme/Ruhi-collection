// Google OAuth 2.0 (authorization code + PKCE) and the encryption of the
// tokens this app keeps at rest.
//
// Plain JavaScript on purpose: the Edge Functions import it and so does the
// Node test suite, so the flow the tests prove is the flow that runs.
//
// WHAT NEVER HAPPENS HERE
//   * a client secret is never sent to a browser — the code exchange happens
//     in the Edge Function and nowhere else;
//   * a refresh token is never written to a log, to a response body or to
//     Git — it is encrypted with AES-256-GCM before it is stored, and the key
//     itself lives in the function's secrets;
//   * a token is never put in a URL — the browser only ever sees the one-time
//     `state` and the one-time `code` that Google hands back.
//
// SCOPES — the minimum this integration needs, and nothing more:
//   spreadsheets  write the export rows (the whole point of the feature)
//   drive.file    create a destination spreadsheet, and see ONLY the files
//                 this app created — never the rest of the owner's Drive
//   openid,email  say which Google account is connected (and nothing else)

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
export const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3/files'

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'email',
]

/** base64url, without padding — the framing Google's own URLs use. */
export function base64url(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url -> bytes. */
function fromBase64url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

function randomBytes(length) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/** A URL-safe, unguessable token. Used for `state` and the PKCE verifier. */
export function randomToken(bytes = 32) {
  return base64url(randomBytes(bytes))
}

/** Hex SHA-256 — how a one-time `state` is stored, so the raw value never is. */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * A PKCE pair (RFC 7636). The verifier never leaves the server: it is stored
 * with the one-time state and used once, at the code exchange.
 */
export async function pkcePair() {
  const verifier = randomToken(32)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

/**
 * The URL the browser is sent to so the owner can approve access with their
 * own Google account.
 *
 * `access_type=offline` is what makes Google issue a refresh token, and
 * `prompt=consent` is what makes it issue a fresh one every time — without it
 * Google only hands over a refresh token the very first time, and a
 * connection that quietly stops working is far worse than one click.
 */
export function buildAuthorizeUrl({
  clientId,
  redirectUri,
  state,
  codeChallenge,
  scopes = GOOGLE_SCOPES,
  loginHint = '',
}) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  if (loginHint) params.set('login_hint', loginHint)
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`
}

/** The body of the code-for-tokens request. */
export function encodeTokenForm({ code, clientId, clientSecret, redirectUri, codeVerifier }) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  })
  return params.toString()
}

/** The body of the refresh request. */
export function encodeRefreshForm({ refreshToken, clientId, clientSecret }) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  })
  return params.toString()
}

/**
 * What the function keeps after a successful exchange.
 *
 * `refreshToken` may be missing: Google omits it when it decides the old one
 * is still good. The old refresh token then stays valid and is kept.
 */
export function readTokenResponse(body) {
  if (!body || typeof body !== 'object') return null
  const accessToken = typeof body.access_token === 'string' ? body.access_token : ''
  if (!accessToken) return null
  const expiresIn = Number(body.expires_in)
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : '',
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : '',
    scope: typeof body.scope === 'string' ? body.scope : '',
    idToken: typeof body.id_token === 'string' ? body.id_token : '',
  }
}

// ---------------------------------------------------------------------------
// Encryption at rest
// ---------------------------------------------------------------------------

/** The 32-byte key, from the function's secrets. */
function keyBytes(keyBase64) {
  const raw = String(keyBase64 || '').trim()
  if (!raw) return null
  try {
    const bytes = fromBase64url(raw.replace(/\+/g, '-').replace(/\//g, '_'))
    return bytes.length === 32 ? bytes : null
  } catch {
    return null
  }
}

/**
 * Encrypt a token for storage. AES-256-GCM, a fresh 12-byte IV every time,
 * and the IV is kept alongside the ciphertext.
 *
 * Returns '' when there is no key — the caller must then refuse to store
 * anything rather than fall back to writing the token in the clear.
 */
export async function encryptText(plain, keyBase64) {
  const key = keyBytes(keyBase64)
  if (!key || !plain) return ''
  const iv = randomBytes(12)
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt'])
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(plain))
  const out = new Uint8Array(iv.length + sealed.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(sealed), iv.length)
  return base64url(out)
}

/** Decrypt a token. Returns '' when it cannot be read — never throws. */
export async function decryptText(payload, keyBase64) {
  const key = keyBytes(keyBase64)
  if (!key || !payload) return ''
  try {
    const bytes = fromBase64url(String(payload))
    if (bytes.length <= 12) return ''
    const iv = bytes.slice(0, 12)
    const body = bytes.slice(12)
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt'])
    const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, body)
    return new TextDecoder().decode(opened)
  } catch {
    return ''
  }
}

/** A short, safe fingerprint of a secret — enough to correlate two log lines
 *  about the same token, never enough to use it. */
export async function tokenFingerprint(secret) {
  if (!secret) return 'none'
  return (await sha256Hex(secret)).slice(0, 8)
}

// ---------------------------------------------------------------------------
// Talking to Google
// ---------------------------------------------------------------------------

/**
 * A sentence the owner can act on, for every way Google can say no.
 *
 * `needsReconnect` marks the two cases only the owner can fix by approving
 * access again; everything else is transient or a configuration mistake.
 */
export function describeGoogleError(status, body) {
  const code = typeof body?.error === 'string' ? body.error : ''
  const text = typeof body?.error_description === 'string' ? body.error_description : ''

  if (code === 'invalid_grant' || (status === 400 && /invalid_grant|expired|revoked/i.test(text))) {
    return {
      code: 'invalid_grant',
      needsReconnect: true,
      message: 'Your Google connection has expired. Please connect Google Sheets again.',
    }
  }
  if (status === 401) {
    return {
      code: code || 'unauthorized',
      needsReconnect: true,
      message: 'Google rejected the access token. Please connect Google Sheets again.',
    }
  }
  if (status === 403) {
    return {
      code: code || 'forbidden',
      needsReconnect: false,
      message: 'That Google account is not allowed to write to this spreadsheet. Add it as an editor, or choose another spreadsheet.',
    }
  }
  if (status === 404) {
    return {
      code: code || 'not_found',
      needsReconnect: false,
      message: 'That spreadsheet could not be found. It may have been deleted, or it may not be shared with this Google account.',
    }
  }
  if (status === 429) {
    return {
      code: 'rate_limited',
      needsReconnect: false,
      message: 'Google is asking us to slow down. Please wait a moment and try again.',
    }
  }
  if (status >= 500) {
    return {
      code: 'google_unavailable',
      needsReconnect: false,
      message: 'Google Sheets is having trouble at the moment. Please try again in a minute.',
    }
  }
  if (status === 400) {
    return {
      code: code || 'bad_request',
      needsReconnect: false,
      message: text || 'Google did not accept the request. Please check the spreadsheet and try again.',
    }
  }
  return {
    code: code || 'unknown',
    needsReconnect: false,
    message: 'Google Sheets did not accept the request. Please try again.',
  }
}

/**
 * The spreadsheet id out of whatever the owner pasted: a bare id, a share
 * link, or a full browser URL. Returns '' when there is no id in there.
 */
export function parseSpreadsheetId(input) {
  const text = String(input || '').trim()
  if (!text) return ''
  const fromUrl = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (fromUrl) return fromUrl[1]
  if (/^[a-zA-Z0-9-_]{20,}$/.test(text)) return text
  return ''
}

/** A spreadsheet title that is safe to hand to Google. */
export function safeSheetTitle(input, fallback = 'Ruhi Collection — Orders') {
  const text = String(input || '').trim()
  if (!text) return fallback
  return text.slice(0, 120)
}

/**
 * The one-time `state` Google sent back, checked against what we sent.
 *
 * Google can answer the callback with an error instead of a code — the owner
 * pressed "Cancel", or the app is in "Testing" mode and their account is not
 * one of the test users. Both need a sentence, not a stack trace.
 */
export function describeAuthorizationError(params) {
  const error = params?.get?.('error') || ''
  const description = params?.get?.('error_description') || ''
  if (error === 'access_denied') {
    return 'Access was declined, so Google Sheets was not connected. Nothing was changed.'
  }
  if (error === 'invalid_scope') {
    return 'This Google Cloud project does not allow the permissions this app asks for. Check the scopes in the consent screen.'
  }
  if (error === 'unauthorized_client') {
    return 'This Google Cloud project is not allowed to sign in yet. Add your account as a test user, or publish the app.'
  }
  if (error) {
    return `Google could not complete the sign-in (${error}). ${description}`.trim()
  }
  return ''
}

/**
 * The claims inside a Google id token — who signed in.
 *
 * The token is NOT verified here: this is only used to show the owner whose
 * account was connected. Every decision that matters is made with the
 * access token, which Google itself checks on every call.
 */
export function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.')
    if (parts.length < 2) return null
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')
      + '='.repeat((4 - (parts[1].length % 4)) % 4))
    const claims = JSON.parse(json)
    return typeof claims === 'object' && claims ? claims : null
  } catch {
    return null
  }
}

/** The setup an owner needs when the Google side is not configured yet. */export function missingConfigMessage(missing) {
  const names = (Array.isArray(missing) ? missing : []).filter(Boolean)
  return [
    'Google Sheets is not connected to this project yet.',
    names.length ? `Still missing: ${names.join(', ')}.` : '',
    '1. In Google Cloud, create a project and enable the Google Sheets API and the Google Drive API.',
    '2. Configure the OAuth consent screen (add yourself as a test user) and create an OAuth client of type "Web application".',
    '3. Add the authorised redirect URI: <the callback URL shown on the Connect button>.',
    '4. Set the project secrets: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
    '5. Press "Connect Google Sheets" and approve access with your own Google account.',
    'The Excel download keeps working in the meantime.',
  ].filter(Boolean)
}

/** Which of the settings the function needs are absent. */
export function missingConfig(env, keys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_TOKEN_KEY']) {
  return keys.filter((k) => {
    const v = env?.[k]
    return typeof v !== 'string' || v.trim().length === 0
  })
}
