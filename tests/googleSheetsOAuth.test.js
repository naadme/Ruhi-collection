// The Google Sheets integration (OAuth, token handling, export formatting,
// errors and duplicate prevention).
//
// The rules that can be decided without a network live in
// supabase/functions/_shared/googleOAuth.mjs and sheetRows.mjs as plain
// JavaScript, so the Edge Function and this suite run the SAME code. The
// parts that need Deno, a Google account or a JWT are pinned by reading the
// source, which is the convention this repository already uses.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  GOOGLE_SCOPES,
  SETUP_SCOPES,
  buildAuthorizeUrl,
  decodeJwtPayload,
  decryptText,
  describeAuthorizationError,
  describeGoogleError,
  encodeRefreshForm,
  encodeTokenForm,
  encryptText,
  missingConfig,
  missingConfigMessage,
  parseSpreadsheetId,
  pkcePair,
  probeGoogleSetup,
  randomToken,
  readTokenResponse,
  safeSheetTitle,
  setupLinks,
  sha256Hex,
  tokenFingerprint,
} from '../supabase/functions/_shared/googleOAuth.mjs'
import { describeApiProblem } from '../supabase/functions/_shared/googleSheets.mjs'
import {
  SHEET_COLUMNS,
  buildSheetValues,
  duplicatesAmong,
  formatPlacedAt,
  orderRows,
} from '../supabase/functions/_shared/sheetRows.mjs'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const FN = 'supabase/functions/google-sheets/index.ts'
const CALLBACK = 'supabase/functions/google-sheets-callback/index.ts'
const MIG = 'supabase/migrations/20261020140000_google_sheets_oauth.sql'
const PANEL = 'src/admin/GoogleSheetsPanel.jsx'
const CLIENT = 'src/lib/googleSheets.js'

// A 32-byte key, as the function's secret would be.
const KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')
const KEY_URLSAFE = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64url')

// ---------------------------------------------------------------------------
// 1. The authorization request
// ---------------------------------------------------------------------------

test('the sign-in asks for the minimum permissions, and nothing more', () => {
  assert.deepEqual(GOOGLE_SCOPES, [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
    'openid',
    'email',
  ])
  // `drive` (the whole Drive) and `gmail` and `calendar` would be far more
  // than this feature needs, and Google asks the owner to approve them.
  for (const scope of GOOGLE_SCOPES) {
    assert.doesNotMatch(scope, /auth\/drive$/, 'the whole Drive is never asked for')
    assert.doesNotMatch(scope, /gmail|calendar|contacts|photos/, 'only sheets, the app\'s own files and the account name')
  }
})

test('the consent URL is a plain authorization-code request', () => {
  const url = new URL(buildAuthorizeUrl({
    clientId: 'client-id.apps.googleusercontent.com',
    redirectUri: 'https://project.supabase.co/functions/v1/google-sheets-callback',
    state: 'the-state',
    codeChallenge: 'the-challenge',
    loginHint: 'owner@example.com',
  }))

  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.equal(url.searchParams.get('client_id'), 'client-id.apps.googleusercontent.com')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://project.supabase.co/functions/v1/google-sheets-callback')
  assert.equal(url.searchParams.get('response_type'), 'code', 'the token never comes back in the URL')
  assert.equal(url.searchParams.get('state'), 'the-state')
  assert.equal(url.searchParams.get('code_challenge'), 'the-challenge')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('login_hint'), 'owner@example.com')
  // offline + consent is what makes Google hand over a refresh token.
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.equal(url.searchParams.get('prompt'), 'consent')
  assert.equal(url.searchParams.get('scope').split(' ').length, GOOGLE_SCOPES.length)
})

test('PKCE really is a challenge over a fresh verifier', async () => {
  const a = await pkcePair()
  const b = await pkcePair()
  assert.notEqual(a.verifier, b.verifier, 'a new verifier every time')
  assert.ok(a.verifier.length >= 43 && a.verifier.length <= 128, 'RFC 7636 length')
  assert.match(a.verifier, /^[A-Za-z0-9\-._~]+$/, 'unreserved characters only')
  assert.notEqual(a.challenge, b.challenge)

  const expected = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(a.verifier)),
  ).toString('base64url')
  assert.equal(a.challenge, expected, 'the challenge is the SHA-256 of the verifier')
})

test('the one-time state is unguessable and is only ever stored hashed', async () => {
  const state = randomToken(32)
  assert.ok(state.length >= 43)
  assert.notEqual(state, randomToken(32))
  const hash = await sha256Hex(state)
  assert.equal(hash.length, 64)
  assert.notEqual(hash, state, 'the raw state is never what gets stored')
  assert.equal(await sha256Hex(state), hash, 'and hashing is stable, so the lookup works')
})

test('the code-for-tokens request carries the secret and the verifier', () => {
  const form = new URLSearchParams(encodeTokenForm({
    code: 'the-code',
    clientId: 'the-id',
    clientSecret: 'the-secret',
    redirectUri: 'https://project.supabase.co/functions/v1/google-sheets-callback',
    codeVerifier: 'the-verifier',
  }))
  assert.equal(form.get('grant_type'), 'authorization_code')
  assert.equal(form.get('code'), 'the-code')
  assert.equal(form.get('client_secret'), 'the-secret')
  assert.equal(form.get('code_verifier'), 'the-verifier')
  assert.equal(form.get('redirect_uri'), 'https://project.supabase.co/functions/v1/google-sheets-callback')
})

test('a refresh asks for a refresh token and nothing else', () => {
  const form = new URLSearchParams(encodeRefreshForm({
    refreshToken: 'r', clientId: 'i', clientSecret: 's',
  }))
  assert.equal(form.get('grant_type'), 'refresh_token')
  assert.equal(form.get('refresh_token'), 'r')
  assert.equal(form.get('code'), null)
})

test('the token answer is read safely, and a missing refresh token is kept missing', () => {
  const parsed = readTokenResponse({
    access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'a b',
  })
  assert.equal(parsed.accessToken, 'at')
  assert.equal(parsed.refreshToken, 'rt')
  assert.ok(Date.parse(parsed.expiresAt) > Date.now(), 'the expiry is a real time')

  const noRefresh = readTokenResponse({ access_token: 'at', expires_in: 60 })
  assert.equal(noRefresh.refreshToken, '', 'an absent refresh token is not invented')

  assert.equal(readTokenResponse({}), null)
  assert.equal(readTokenResponse(null), null)
  assert.equal(readTokenResponse({ access_token: '' }), null)
})

// ---------------------------------------------------------------------------
// 2. The tokens at rest
// ---------------------------------------------------------------------------

test('a token is encrypted, and only the holder of the key can read it', async () => {
  const secret = 'ya29.super-secret-refresh-token'
  const sealed = await encryptText(secret, KEY_URLSAFE)
  assert.ok(sealed.length > 20)
  assert.notEqual(sealed, secret)
  assert.ok(!sealed.includes(secret), 'the token is not in the ciphertext')
  assert.equal(await decryptText(sealed, KEY_URLSAFE), secret, 'the key gets it back')

  const other = Buffer.from('ffffffffffffffffffffffffffffffff').toString('base64url')
  assert.equal(await decryptText(sealed, other), '', 'a different key gets nothing')
  assert.equal(await decryptText('not-even-base64!!', KEY_URLSAFE), '', 'garbage gets nothing')
  assert.equal(await decryptText('', KEY_URLSAFE), '')
})

test('the same token never encrypts to the same thing twice', async () => {
  const a = await encryptText('same', KEY_URLSAFE)
  const b = await encryptText('same', KEY_URLSAFE)
  assert.notEqual(a, b, 'a fresh IV every time')
  assert.equal(await decryptText(a, KEY_URLSAFE), 'same')
  assert.equal(await decryptText(b, KEY_URLSAFE), 'same')
})

test('with no key, nothing is encrypted — so nothing can be stored in the clear', async () => {
  assert.equal(await encryptText('secret', ''), '')
  assert.equal(await encryptText('secret', 'too-short'), '')
  assert.equal(await decryptText('anything', ''), '')
})

test('a fingerprint is safe to write in a log', async () => {
  const print = await tokenFingerprint('a-real-token')
  assert.equal(print.length, 8)
  assert.notEqual(print, 'a-real-token')
  assert.equal(await tokenFingerprint('a-real-token'), print, 'and it is stable')
  assert.equal(await tokenFingerprint(''), 'none')
})

// ---------------------------------------------------------------------------
// 3. Failures, and what the owner is told
// ---------------------------------------------------------------------------

test('an expired or revoked grant asks the owner to connect again', () => {
  const expired = describeGoogleError(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
  assert.equal(expired.needsReconnect, true)
  assert.match(expired.message, /connect Google Sheets again/i)

  const unauthorised = describeGoogleError(401, {})
  assert.equal(unauthorised.needsReconnect, true)
})

test('every other refusal gets a sentence the owner can act on', () => {
  const forbidden = describeGoogleError(403, {})
  assert.equal(forbidden.needsReconnect, false)
  assert.match(forbidden.message, /not allowed to write/i)

  const missing = describeGoogleError(404, {})
  assert.equal(missing.needsReconnect, false)
  assert.match(missing.message, /could not be found/i)

  const slow = describeGoogleError(429, {})
  assert.match(slow.message, /slow down/i)

  const broken = describeGoogleError(503, {})
  assert.match(broken.message, /try again/i)

  const unknown = describeGoogleError(418, {})
  assert.ok(unknown.message.length > 10)
})

test('a sign-in that never happened is explained, not swallowed', () => {
  const denied = describeAuthorizationError(new URLSearchParams({ error: 'access_denied' }))
  assert.match(denied, /declined/i)

  const scope = describeAuthorizationError(new URLSearchParams({ error: 'invalid_scope' }))
  assert.match(scope, /permissions/i)

  const client = describeAuthorizationError(new URLSearchParams({ error: 'unauthorized_client' }))
  assert.match(client, /test user|publish/i)

  assert.equal(describeAuthorizationError(new URLSearchParams({})), '')
})

test('a spreadsheet is recognised from a bare id or from any of its links', () => {
  const id = '1a2B3c4D5e6F7g8H9i0JkLmNoPqRsTuVw'
  assert.equal(parseSpreadsheetId(id), id)
  assert.equal(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}/edit?gid=0`), id)
  assert.equal(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}`), id)
  assert.equal(parseSpreadsheetId('not a spreadsheet'), '')
  assert.equal(parseSpreadsheetId(''), '')
})

test('a sheet title is trimmed and cannot run away', () => {
  assert.equal(safeSheetTitle('  Weekly orders  '), 'Weekly orders')
  assert.equal(safeSheetTitle(''), 'Ruhi Collection — Orders')
  assert.equal(safeSheetTitle('x'.repeat(500)).length, 120)
})

test('the id token is only ever read for display', () => {
  const claims = decodeJwtPayload('x.' + Buffer.from(JSON.stringify({ email: 'a@b.com', sub: '1' })).toString('base64url') + '.y')
  assert.equal(claims.email, 'a@b.com')
  assert.equal(decodeJwtPayload('nonsense'), null)
  assert.equal(decodeJwtPayload(''), null)
})

test('the setup message names the variables and never a value', () => {
  assert.deepEqual(missingConfig({}), ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_TOKEN_KEY'])
  assert.deepEqual(missingConfig({ GOOGLE_CLIENT_ID: 'a' }), ['GOOGLE_CLIENT_SECRET', 'GOOGLE_TOKEN_KEY'])
  assert.deepEqual(
    missingConfig({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', GOOGLE_TOKEN_KEY: 'c' }),
    [],
  )
  const text = missingConfigMessage(['GOOGLE_CLIENT_ID']).join('\n')
  assert.match(text, /Google Sheets API/)
  assert.match(text, /Google Drive API/)
  assert.match(text, /consent screen/i)
  assert.match(text, /GOOGLE_CLIENT_ID/)
  assert.match(text, /Excel download keeps working/)
  assert.doesNotMatch(text, /BEGIN PRIVATE KEY|client_secret\s*[:=]/i, 'no secret is ever shown')
})

// ---------------------------------------------------------------------------
// 3b. Finding out what is wrong BEFORE the owner is sent to Google
// ---------------------------------------------------------------------------

test('the setup probe names the exact thing Google objects to', async () => {
  const realFetch = globalThis.fetch
  const json = (body, status) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
  try {
    // 1. a secret that does not belong to the client
    globalThis.fetch = async () => json({ error: 'invalid_client', error_description: 'The provided client secret is invalid.' }, 401)
    const bad = await probeGoogleSetup({ clientId: 'x', clientSecret: 'y', redirectUri: 'https://z/callback' })
    assert.equal(bad.ok, false)
    assert.equal(bad.reason, 'invalid_secret')
    assert.equal(bad.secretValid, false)

    // 2. a callback URL Google does not know — it answers with a redirect to
    //    its own error page, where the reason is base64 in `authError`
    globalThis.fetch = async (url) => {
      if (String(url).includes('oauth2/v2/auth')) {
        const encoded = Buffer.from('redirect_uri_mismatch').toString('base64url')
        return new Response(null, {
          status: 302,
          headers: { location: `https://accounts.google.com/signin/oauth/error?authError=${encoded}` },
        })
      }
      return json({ error: 'invalid_grant' }, 400)
    }
    const mismatch = await probeGoogleSetup({ clientId: 'x', clientSecret: 'y', redirectUri: 'https://z/callback' })
    assert.equal(mismatch.reason, 'redirect_not_registered')
    assert.equal(mismatch.secretValid, true, 'the secret was fine — only the URL was wrong')

    // 3. everything in order
    globalThis.fetch = async (url) => {
      if (String(url).includes('oauth2/v2/auth')) {
        return new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/v3/signin/identifier' } })
      }
      return json({ error: 'invalid_grant' }, 400)
    }
    const good = await probeGoogleSetup({ clientId: 'x', clientSecret: 'y', redirectUri: 'https://z/callback' })
    assert.equal(good.ok, true)
    assert.equal(good.secretValid, true)
    assert.equal(good.redirectRegistered, true)
  } finally {
    globalThis.fetch = realFetch
  }
})

// ---------------------------------------------------------------------------
// 3c. Google's own answer, in the shape Google actually sends it
// ---------------------------------------------------------------------------

test('an API that is not enabled is recognised and linked', () => {
  // This is Google's real answer, verbatim in shape: the error is an OBJECT
  // nested under `error`, and the reason is in `details[0].reason`.
  const body = {
    error: {
      code: 403,
      message: 'Google Sheets API has not been used in project 550615952572 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=550615952572 then retry.',
      status: 'PERMISSION_DENIED',
      details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED' }],
    },
  }
  const problem = describeApiProblem(403, body, '550615952572-abc.apps.googleusercontent.com')
  assert.equal(problem.reason, 'api_not_enabled')
  assert.match(problem.message, /Sheets API is not enabled/i)
  assert.match(problem.message, /550615952572/)
  assert.match(problem.link, /sheets\.googleapis\.com/)
  assert.match(problem.link, /project=550615952572/)
})

test('the flat OAuth error shape is read as well', () => {
  const problem = describeApiProblem(401, { error: 'invalid_client', error_description: 'The provided client secret is invalid.' })
  assert.equal(problem.reason, 'expired')
  assert.match(problem.message, /rejected the access token/i)
})

test('a refusal that is neither is still a sentence, never a stack trace', () => {
  const problem = describeApiProblem(500, { error: { code: 500, message: 'Internal error encountered.' } })
  assert.match(problem.message, /Internal error encountered/)
  assert.equal(problem.link, '')
})

test('the setup links point at the exact Google Cloud pages', () => {
  const links = setupLinks('550615952572-abc.apps.googleusercontent.com')
  assert.ok(links.length >= 2)
  for (const link of links) {
    assert.match(link.url, /^https:\/\/console\.cloud\.google\.com\//, 'a real console page')
    assert.ok(link.label.length > 5, 'and something to read')
  }
  assert.ok(links.some((l) => l.url.includes('/apis/credentials')), 'the OAuth client page')
  assert.ok(links.some((l) => l.url.includes('/auth/branding')), 'the consent screen page')
  assert.ok(links.some((l) => l.hint.includes('550615952572')), 'and it names the client to open')
})

test('the consent screen is told to allow exactly the scopes the app asks for', () => {
  assert.deepEqual(SETUP_SCOPES, GOOGLE_SCOPES)
  const text = missingConfigMessage([], { reason: 'redirect_not_registered', redirectUri: 'https://z/callback' }).join('\n')
  for (const scope of SETUP_SCOPES) assert.ok(text.includes(scope), `${scope} is listed`)
  assert.match(text, /https:\/\/z\/callback/, 'and the exact URL to register')
})

// ---------------------------------------------------------------------------
// 4. The rows that land in the sheet
// ---------------------------------------------------------------------------

const order = (extra = {}) => ({
  id: '11111111-1111-1111-1111-111111111111',
  reference: 'RCH-0001',
  created_at: '2026-10-05T10:30:00+00:00',
  status: 'confirmed',
  payment_status: 'paid',
  payment_method: 'razorpay',
  full_name: 'Asha Rao', email: 'a@example.com', phone: '9000000000',
  address: '1 Main Street', city: 'Pune', state: 'MH', pincode: '411001',
  subtotal: 958, discount: 0, coupon_code: null, shipping: 0, total: 958,
  razorpay_order_id: 'order_A', razorpay_payment_id: 'pay_A', note: null,
  order_items: [], ...extra,
})

test('every row has exactly the columns the header row names', () => {
  const rows = orderRows(order({
    order_items: [{ title: 'Denim Shirt - Blue', size: 'M', qty: 2, unit_price: 479 }],
  }))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].length, SHEET_COLUMNS.length)
})

test('one order becomes one row per item, with the money repeated', () => {
  const rows = orderRows(order({
    order_items: [
      { title: 'Denim Shirt - Blue', size: 'M', qty: 2, unit_price: 479 },
      { title: 'Denim Shirt - Red', size: 'L', qty: 1, unit_price: 479 },
    ],
  }))
  assert.equal(rows.length, 2)
  const header = SHEET_COLUMNS
  assert.equal(rows[0][header.indexOf('Reference')], 'RCH-0001')
  assert.equal(rows[0][header.indexOf('Item')], 'Denim Shirt - Blue')
  assert.equal(rows[0][header.indexOf('Qty')], 2)
  assert.equal(rows[0][header.indexOf('Unit price (₹)')], 479)
  assert.equal(rows[0][header.indexOf('Line total (₹)')], 958)
  assert.equal(rows[1][header.indexOf('Line total (₹)')], 479)
  assert.equal(rows[0][header.indexOf('Order total (₹)')], 958, 'the order total repeats on every item row')
  assert.equal(rows[0][header.indexOf('Payment method')], 'razorpay')
})

test('an order with no items still gets exactly one row', () => {
  const rows = orderRows(order())
  assert.equal(rows.length, 1)
  assert.equal(rows[0].length, SHEET_COLUMNS.length)
})

test('a date is written the way a spreadsheet can read as a date', () => {
  // 10:30 UTC is 16:00 in India, and the shop's times are India's.
  assert.equal(formatPlacedAt('2026-10-05T10:30:00+00:00'), '2026-10-05 16:00:00')
  assert.equal(formatPlacedAt('2026-10-05T00:00:00+00:00'), '2026-10-05 05:30:00')
  assert.equal(formatPlacedAt('not-a-date'), 'not-a-date')
  assert.match(formatPlacedAt(new Date().toISOString()), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
})

test('the header row is written once, with the first export only', () => {
  const orders = [order()]
  const first = buildSheetValues(orders, { status: 'shipped' })
  assert.deepEqual(first[0], SHEET_COLUMNS, 'headers first')
  assert.match(first[1][0], /Filtered to status: shipped/, 'then the filter banner')
  assert.equal(first[2][0], 'RCH-0001', 'then the data')

  const later = buildSheetValues(orders, { status: 'shipped' }, { includeHeaders: false })
  assert.equal(later.length, 2, 'no second header row in the middle of the data')
  assert.match(later[0][0], /Filtered to status: shipped/)
})

// ---------------------------------------------------------------------------
// 5. The same order is never sent twice
// ---------------------------------------------------------------------------

test('an order already in the sheet is separated from the ones that are not', () => {
  const a = { id: 'a' }
  const b = { id: 'b' }
  const c = { id: 'c' }
  const { fresh, repeated } = duplicatesAmong([a, b, c], ['b'])
  assert.deepEqual(fresh.map((o) => o.id), ['a', 'c'])
  assert.deepEqual(repeated.map((o) => o.id), ['b'])
})

test('nothing already exported means everything is fresh', () => {
  const { fresh, repeated } = duplicatesAmong([{ id: 'a' }], [])
  assert.equal(fresh.length, 1)
  assert.equal(repeated.length, 0)
})

test('the ledger itself makes a duplicate impossible', () => {
  const sql = read(MIG)
  assert.match(sql, /primary key \(sheet_id, order_id\)/, 'one row per order per sheet')
  assert.match(sql, /order_id\s+uuid not null references public\.orders \(id\)/, 'and it points at a real order')
})

// ---------------------------------------------------------------------------
// 6. The function: authorisation, and what it must never leak
// ---------------------------------------------------------------------------

test('every action needs a store owner', () => {
  const fn = read(FN)
  assert.match(fn, /if \(!\(await isAdmin\(who\.id\)\)\)/, 'the admin check gates the whole switch')
  assert.match(fn, /Only the store owner can use Google Sheets/)
  assert.match(fn, /auth\/v1\/user/, "the caller's own JWT is verified by Supabase Auth")
  // The sign-in itself is the one action that cannot carry a session.
  assert.doesNotMatch(fn, /case 'callback'/, 'the callback lives in its own function')
})

test('the main function keeps the platform JWT check; only the callback does not', () => {
  const config = read('supabase/config.toml')
  assert.match(config, /\[functions\.google-sheets\]\s*\nverify_jwt = true/)
  assert.match(config, /\[functions\.google-sheets-callback\]\s*\nverify_jwt = false/)
})

test('the callback proves the caller with a one-time state, not with a token from the browser', () => {
  const fn = read(CALLBACK)
  assert.match(fn, /state_hash=eq\./, 'the state is looked up by its hash')
  assert.match(fn, /used_at/, 'and it can only be used once')
  assert.match(fn, /expires_at/, 'and only for ten minutes')
  assert.match(fn, /code_verifier/, 'and the PKCE verifier is required')
  assert.doesNotMatch(fn, /auth\/v1\/user/, 'the callback trusts no session at all')
  assert.doesNotMatch(fn, /access_token.*from the browser/i)
})

test('the state row can only belong to an admin', () => {
  const sql = read(MIG)
  assert.match(sql, /owner_id\s+uuid not null references public\.admins \(user_id\)/)
})

test('no secret is ever written to a log, and none is left in the browser', () => {
  for (const file of [FN, CALLBACK]) {
    const source = read(file)
    assert.doesNotMatch(source, /console\.(log|info|warn)\([^)]*refresh_token/, 'a refresh token is never logged')
    assert.doesNotMatch(source, /console\.(log|info|warn)\([^)]*access_token/, 'nor an access token')
    assert.doesNotMatch(source, /console\.(log|info|warn)\([^)]*client_secret/, 'nor the client secret')
  }
  const browser = read('src/lib/googleSheets.js') + read(PANEL)
  assert.doesNotMatch(browser, /client_secret|refresh_token|access_token|GOOGLE_CLIENT_SECRET/,
    'the browser never names a credential')
  assert.doesNotMatch(browser, /GOOGLE_TOKEN_KEY/)
})

test('the browser only ever sends names and order ids', () => {
  const client = read(CLIENT)
  assert.match(client, /action, \.\.\.body/, 'an action name and a body')
  assert.match(client, /supabase\.functions\.invoke\(SHEETS_FUNCTION/)
  assert.doesNotMatch(client, /fetch\(['"]https:\/\/(googleapis|sheets|accounts)\./,
    'the browser never talks to Google directly')
})

test('the tokens are encrypted before they touch the database', () => {
  for (const file of [FN, CALLBACK]) {
    const source = read(file)
    assert.match(source, /encryptText\(/, 'the token is encrypted')
    assert.doesNotMatch(source, /access_token:\s*tokens\.accessToken/, 'never in the clear')
    assert.doesNotMatch(source, /refresh_token:\s*tokens\.refreshToken/, 'never in the clear')
  }
  const sql = read(MIG)
  assert.match(sql, /enable row level security/, 'and the table is closed to the browser')
  assert.doesNotMatch(sql, /create policy[\s\S]{0,160}google_sheets/i, 'with no policy a browser cannot read it')
})

test('an access token is refreshed when it expires, and only once per call', () => {
  const fn = read(FN)
  assert.match(fn, /expires - Date\.now\(\) > 60_000/, 'a token is used while it is fresh')
  assert.match(fn, /refreshAccessToken/, 'and refreshed when it is not')
  assert.match(read('supabase/functions/_shared/googleOAuth.mjs'), /grant_type: 'refresh_token'/)
  // The old refresh token is kept when Google does not send a new one.
  assert.match(fn, /the old one stays valid and is kept/)
})

test('an export takes the lease, so two clicks cannot write the same orders twice', () => {
  const fn = read(FN)
  assert.match(fn, /claimLease/, 'the lease is taken')
  assert.match(fn, /releaseLease/, 'and given back')
  assert.match(fn, /Another export is already running/, 'and a second one is told why it is refused')
  assert.match(fn, /export_started_at=is\.null/, 'the lease is claimed atomically')
})

test('the export only records an order as sent once Google has taken the rows', () => {
  const fn = read(FN)
  const append = fn.indexOf('appendRows(token')
  const record = fn.indexOf('resolution=merge-duplicates,return=minimal')
  assert.ok(append > 0 && record > append, 'the ledger is written after the append, never before')
  assert.match(fn, /if \(!written\.ok\)[\s\S]{0,400}return/, 'a refusal never marks the orders as sent')
})

test('the admin panel can connect, disconnect, choose and create', () => {
  const panel = read(PANEL)
  assert.match(panel, /'Connect Google Sheets'/, 'a clear Connect button')
  assert.match(panel, /Disconnect/, 'and a way to disconnect')
  assert.match(panel, /window\.location\.assign\(authorizeUrl\)/, 'the owner goes to Google')
  assert.match(panel, /sheetsAction\('create-sheet'/, 'a new spreadsheet can be created')
  assert.match(panel, /sheetsAction\('select-sheet'/, 'or an existing one chosen')
  assert.match(panel, /sheetsAction\('export'/, 'and the orders sent')
  assert.match(panel, /includeExported/, 'with the owner in charge of duplicates')
  assert.match(panel, /status\?\.email/, 'the connected account is shown')
})

test('the admin panel sits in Admin → Orders', () => {
  assert.match(read('src/admin/OrdersPanel.jsx'), /<GoogleSheetsPanel rows=\{rows\} filters=\{filters\}/)
})

test('the Excel export is untouched', () => {
  const panel = read('src/admin/OrdersPanel.jsx')
  assert.match(panel, /downloadOrdersXlsx/, 'the Excel download still works')
  assert.match(panel, /'Export Excel'/)
})

test('the sign-in sends the owner back to the orders tab', () => {
  const dashboard = read('src/admin/Dashboard.jsx')
  assert.match(dashboard, /\.get\('section'\)/, 'the section comes from the URL')
  assert.match(dashboard, /url\.searchParams\.set\('section', next\)/, 'and goes back into it')
  const fn = read(FN)
  assert.match(fn, /GOOGLE_ADMIN_URL/, 'where to send the owner is configurable')
})
