// The complete Google Sheets flow, end to end, against a simulated Google and
// a simulated Supabase.
//
// This runs the REAL handlers — the same `handle()` the Edge Function runs —
// with `fetch` pointed at a fake Google and a fake PostgREST, so the whole
// journey is exercised: the owner presses Connect, Google sends them back
// with a code, the tokens are stored encrypted, a spreadsheet is created,
// the orders are exported, the same orders are refused the second time, an
// expired access token is refreshed, and Google's refusals come back as
// sentences an admin can act on.
//
// What it cannot prove is Google's own behaviour — that needs the owner's
// Google account (scripts/check-google-sheets.mjs checks that side).

import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

// ---------------------------------------------------------------------------
// The world the handlers think they are in
// ---------------------------------------------------------------------------

const ADMIN_ID = '11111111-1111-1111-1111-111111111111'
const SUPABASE_URL = 'https://stub.supabase.co'
const TOKEN_KEY = crypto.randomBytes(32).toString('base64url')

const world = {
  db: { admins: [], google_sheets_connections: [], google_sheets_states: [], order_sheet_exports: [], orders: [] },
  google: {
    files: [],
    sheets: {},
    appended: [],
    accessToken: 'access-token-1',
    refreshToken: 'refresh-token-1',
    tokenCalls: 0,
    refreshCalls: 0,
    revokes: 0,
    renames: [],
    failNextAppend: 0,
    failNextAppendWith: 0,
    refreshFails: false,
  },
}

// ---- a very small PostgREST ------------------------------------------------
function rest(path, init = {}) {
  const url = new URL(SUPABASE_URL + path)
  const table = url.pathname.replace('/rest/v1/', '')
  const method = (init.method || 'GET').toUpperCase()
  const prefer = String((init.headers && init.headers.Prefer) || '')
  let rows = world.db[table] || []

  for (const [key, value] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(key)) continue
    if (value === 'is.null') rows = rows.filter((r) => r[key] === null || r[key] === undefined)
    else if (value.startsWith('eq.')) rows = rows.filter((r) => String(r[key]) === value.slice(3))
    else if (value.startsWith('in.(')) {
      const ids = value.slice(4, -1).split(',').map((s) => s.replace(/^"|"$/g, ''))
      rows = rows.filter((r) => ids.includes(String(r[key])))
    }
  }

  const json = (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })

  if (method === 'GET') return json(200, rows)

  const payload = init.body ? JSON.parse(init.body) : null

  if (method === 'POST') {
    const list = Array.isArray(payload) ? payload : [payload]
    const written = []
    for (const item of list) {
      const conflict = url.searchParams.get('on_conflict')
      const key = conflict || 'id'
      const at = rows.findIndex((r) => String(r[key]) === String(item[key]))
      if (at >= 0) {
        rows[at] = { ...rows[at], ...item }
        written.push(rows[at])
      } else {
        const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...item }
        rows.push(row)
        written.push(row)
      }
    }
    return prefer.includes('return=representation') ? json(201, written) : json(201, null)
  }

  if (method === 'PATCH') {
    for (const row of rows) Object.assign(row, payload || {})
    return prefer.includes('return=representation') ? json(200, rows) : new Response(null, { status: 204 })
  }

  if (method === 'DELETE') {
    world.db[table] = (world.db[table] || []).filter((r) => !rows.includes(r))
    return new Response(null, { status: 204 })
  }

  return json(405, null)
}

// ---- a very small Google ---------------------------------------------------
function googleJson(url, init = {}) {
  const u = new URL(url)
  const method = (init.method || 'GET').toUpperCase()
  const auth = String((init.headers && init.headers.Authorization) || '').replace(/^Bearer /, '')
  const raw = init.body === undefined || init.body === null ? '' : String(init.body)
  // Google is called with a JSON body everywhere except the token endpoint,
  // which is form-encoded.
  const body = raw.trim().startsWith('{') || raw.trim().startsWith('[') ? JSON.parse(raw) : null
  const form = new URLSearchParams(raw)
  const json = (status, payload) => new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json' },
  })

  const sheetsWrite = u.pathname.match(/^\/v4\/spreadsheets\/([^/]+)\/values\/(.+):append$/)
  const sheetsRead = u.pathname.match(/^\/v4\/spreadsheets\/([^/]+)\/values\/(.+)$/)
  const sheetGet = u.pathname.match(/^\/v4\/spreadsheets\/([^/]+)$/)
  const sheetBatch = u.pathname.match(/^\/v4\/spreadsheets\/([^/]+):batchUpdate$/)

  if (u.hostname === 'accounts.google.com' && u.pathname === '/o/oauth2/v2/auth') {
    // Google answers a callback URL it does not know with a redirect to its
    // own error page, where the reason travels base64-encoded.
    const wanted = u.searchParams.get('redirect_uri')
    if (!world.google.registeredRedirects.includes(wanted)) {
      return new Response(null, {
        status: 302,
        headers: {
          location: `https://accounts.google.com/signin/oauth/error?authError=${Buffer.from('redirect_uri_mismatch').toString('base64url')}`,
        },
      })
    }
    return new Response(null, {
      status: 302,
      headers: { location: 'https://accounts.google.com/v3/signin/identifier?dsh=S137300545' },
    })
  }

  if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/token') {
    world.google.tokenCalls += 1
    const form2 = form
    if (form2.get('grant_type') === 'refresh_token') {
      world.google.refreshCalls += 1
      if (world.google.refreshFails) {
        return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
      }
      world.google.accessToken = `access-token-refreshed-${world.google.refreshCalls}`
      return json(200, { access_token: world.google.accessToken, expires_in: 3600, scope: 'sheets' })
    }
    if (form2.get('code') === 'refused-code') {
      return json(400, { error: 'invalid_grant', error_description: 'Bad code.' })
    }
    if (form2.get('client_secret') !== 'client-secret') {
      return json(401, { error: 'invalid_client', error_description: 'The provided client secret is invalid.' })
    }
    return json(200, {
      access_token: world.google.accessToken,
      refresh_token: world.google.refreshToken,
      expires_in: 3600,
      scope: 'sheets drive.file',
      id_token: `x.${Buffer.from(JSON.stringify({ sub: 'google-user-1', email: 'owner@gmail.com' })).toString('base64url')}.y`,
    })
  }

  if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/revoke') {
    world.google.revokes += 1
    return json(200, {})
  }

  if (u.hostname === 'openidconnect.googleapis.com' && u.pathname === '/v1/userinfo') {
    if (auth !== world.google.accessToken) return json(401, { error: 'invalid_token' })
    return json(200, { sub: 'google-user-1', email: 'owner@gmail.com' })
  }

  if (u.hostname === 'www.googleapis.com' && u.pathname === '/drive/v3/files') {
    if (auth !== world.google.accessToken) return json(401, { error: 'invalid_token' })
    if (method === 'POST') {
      const id = `created-sheet-${world.google.files.length + 1}`
      const file = { id, name: body.name }
      world.google.files.push(file)
      world.google.sheets[id] = { title: file.name, tab: 'Sheet1' }
      return json(200, file)
    }
    return json(200, { files: world.google.files })
  }

  // The Sheets API refuses everything when it is not enabled on the project.
  if (u.hostname === 'sheets.googleapis.com' && world.google.sheetsApiDisabled) {
    if (auth !== world.google.accessToken) return json(401, { error: 'invalid_token' })
    return json(403, {
      error: 'SERVICE_DISABLED',
      error_description: 'Google Sheets API has not been used in project 550615952572 before or it is disabled. Enable it by visiting https://console.developer.google.com/apis/api/sheets.googleapis.com/overview?project=550615952572',
      status: 'PERMISSION_DENIED',
      details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED' }],
    })
  }

  // Creating a spreadsheet goes through the SHEETS API, so it needs nothing
  // beyond the `spreadsheets` scope the connection already carries.
  if (u.hostname === 'sheets.googleapis.com' && u.pathname === '/v4/spreadsheets' && method === 'POST') {
    if (auth !== world.google.accessToken) return json(401, { error: 'invalid_token' })
    const id = `created-sheet-${world.google.files.length + 1}`
    const title = body?.properties?.title || 'Untitled'
    // Google does NOT always hand out the tab id 0 — this is the id the real
    // sheet in the owner's Drive came back with, and the reason a rename
    // aimed at 0 did nothing.
    const tabId = 1318175855 + world.google.files.length
    world.google.files.push({ id, name: title })
    world.google.sheets[id] = { title, tab: 'Sheet1', tabId }
    return json(200, {
      spreadsheetId: id,
      properties: { title },
      sheets: [{ properties: { sheetId: tabId, title: 'Sheet1' } }],
    })
  }

  if (u.hostname === 'sheets.googleapis.com' && sheetBatch) {
    if (auth !== world.google.accessToken) return json(401, { error: 'invalid_token' })
    const id = decodeURIComponent(sheetBatch[1])
    const update = body.requests?.[0]?.updateSheetProperties
    const title = update?.title
    const tabSheetId = update?.sheetId
    world.google.renames.push({ id, title, sheetId: tabSheetId })
    const sheet = world.google.sheets[id]
    // Google refuses a rename aimed at a tab that does not exist.
    if (!sheet || sheet.tabId !== tabSheetId) {
      return json(400, { error: { code: 400, message: 'No sheet with id: ' + tabSheetId, status: 'INVALID_ARGUMENT' } })
    }
    sheet.tab = title
    return json(200, { spreadsheetId: id })
  }

  if (u.hostname === 'sheets.googleapis.com' && sheetGet) {
    if (auth !== world.google.accessToken) return json(401, { error: 'invalid_token' })
    const id = decodeURIComponent(sheetGet[1])
    const sheet = world.google.sheets[id]
    if (!sheet) return json(404, { error: 'not_found' })
    return json(200, {
      spreadsheetId: id,
      // The real API answers `title` at the top level when it is asked for,
      // and `properties.title` when it is asked for that instead.
      title: sheet.title,
      properties: { title: sheet.title },
      sheets: [{ properties: { sheetId: sheet.tabId, title: sheet.tab } }],
    })
  }

  if (u.hostname === 'sheets.googleapis.com' && sheetsWrite) {
    if (auth !== world.google.accessToken) return json(401, { error: 'invalid_token' })
    if (world.google.failNextAppend > 0) {
      world.google.failNextAppend -= 1
      return json(world.google.failNextAppendWith || 403, { error: 'forbidden' })
    }
    const id = decodeURIComponent(sheetsWrite[1])
    const sheet = world.google.sheets[id] || (world.google.sheets[id] = { title: 'Sheet', tab: 'Orders' })
    world.google.appended.push({ id, values: body.values })
    return json(200, {
      updates: { updatedRows: body.values.length, updatedRange: `${sheet.tab}!A1:Z${body.values.length}` },
    })
  }

  // Reading a range back — what the "what is in the sheet" preview uses.
  if (u.hostname === 'sheets.googleapis.com' && sheetsRead) {
    if (auth !== world.google.accessToken) return json(401, { error: 'invalid_token' })
    const id = decodeURIComponent(sheetsRead[1])
    const values = world.google.appended.filter((a) => a.id === id).flatMap((a) => a.values)
    return json(200, { values })
  }

  return json(404, { error: 'not_found' })
}

// ---- the fetch the handlers will use --------------------------------------
const ENV = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  GOOGLE_CLIENT_ID: '550615952572-testclient.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_TOKEN_KEY: TOKEN_KEY,
  GOOGLE_ADMIN_URL: 'https://www.ruhi-collections.com/admin?section=orders',
}

globalThis.Deno = { env: { get: (name) => ENV[name] } }

globalThis.fetch = async (url, init) => {
  const u = new URL(String(url))
  if (u.hostname === 'stub.supabase.co') {
    if (u.pathname === '/auth/v1/user') {
      if (String((init.headers || {}).Authorization || '').includes('admin-token')) {
        return new Response(JSON.stringify({ id: ADMIN_ID, email: 'owner@example.com' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 401 })
    }
    return rest(u.pathname + u.search, init)
  }
  if (u.hostname.endsWith('googleapis.com') || u.hostname.endsWith('google.com')) {
    return googleJson(String(url), init)
  }
  throw new Error(`unexpected fetch: ${url}`)
}

// The real handlers. Loaded after the shim, so the runtime sees it.
const { handle: sheets } = await import('../supabase/functions/google-sheets/index.ts')
const { handle: callback } = await import('../supabase/functions/google-sheets-callback/index.ts')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const post = (action, body = {}, headers = {}) => sheets(new Request(
  'https://stub.supabase.co/functions/v1/google-sheets',
  {
    method: 'POST',
    headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ action, ...body }),
  },
))

const getCallback = (query) => callback(new Request(
  `https://stub.supabase.co/functions/v1/google-sheets-callback${query}`,
))

const reset = () => {
  world.db = {
    admins: [{ user_id: ADMIN_ID }],
    google_sheets_connections: [],
    google_sheets_states: [],
    order_sheet_exports: [],
    orders: [
      {
        id: 'aaaaaaaa-1111-1111-1111-111111111111',
        reference: 'RCH-0001',
        created_at: '2026-10-05T10:30:00+00:00',
        status: 'confirmed',
        payment_status: 'paid',
        payment_method: 'razorpay',
        full_name: 'Asha Rao',
        email: 'a@example.com',
        phone: '9000000000',
        address: '1 Main Street',
        city: 'Pune',
        state: 'MH',
        pincode: '411001',
        subtotal: 958,
        discount: 0,
        coupon_code: null,
        shipping: 0,
        total: 958,
        razorpay_order_id: 'order_A',
        razorpay_payment_id: 'pay_A',
        note: null,
        order_items: [{ title: 'Denim Shirt - Blue', size: 'M', qty: 2, unit_price: 479 }],
      },
    ],
  }
  world.google = {
    files: [],
    sheets: {},
    appended: [],
    accessToken: 'access-token-1',
    refreshToken: 'refresh-token-1',
    tokenCalls: 0,
    refreshCalls: 0,
    revokes: 0,
    renames: [],
    failNextAppend: 0,
    failNextAppendWith: 0,
    refreshFails: false,
    sheetsApiDisabled: false,
    registeredRedirects: [`${SUPABASE_URL}/functions/v1/google-sheets-callback`],
  }
}

const connect = async () => {
  reset()
  const start = await post('start')
  const body = await start.json()
  const url = new URL(body.authorizeUrl)
  const state = url.searchParams.get('state')
  const done = await getCallback(`?code=the-code&state=${encodeURIComponent(state)}`)
  return { start, body, state, done }
}

const readConnection = () => world.db.google_sheets_connections[0] || null

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

test('pressing Connect sends the owner to Google with the right request', async () => {
  reset()
  const res = await post('start')
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)

  const url = new URL(body.authorizeUrl)
  assert.equal(url.hostname, 'accounts.google.com')
  assert.equal(url.searchParams.get('client_id'), '550615952572-testclient.apps.googleusercontent.com')
  assert.equal(url.searchParams.get('redirect_uri'), `${SUPABASE_URL}/functions/v1/google-sheets-callback`)
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.equal(url.searchParams.get('prompt'), 'consent')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.ok(url.searchParams.get('state').length >= 43, 'the state is unguessable')
  assert.match(url.searchParams.get('scope'), /auth\/spreadsheets/)

  // The raw state is never stored — only its hash.
  const stored = world.db.google_sheets_states
  assert.equal(stored.length, 1)
  assert.notEqual(stored[0].state_hash, url.searchParams.get('state'))
  assert.equal(stored[0].state_hash.length, 64, 'a SHA-256 hex digest')
  assert.equal(stored[0].owner_id, ADMIN_ID)
  assert.ok(stored[0].code_verifier, 'the PKCE verifier is kept for the exchange')
})

test('the owner approves, and the connection is stored encrypted', async () => {
  const { body, state, done } = await connect()
  assert.equal(done.status, 200)
  const page = await done.text()
  assert.match(page, /Google Sheets is connected/)
  assert.match(page, /owner@gmail\.com/)

  const conn = readConnection()
  assert.ok(conn, 'the connection was stored')
  assert.equal(conn.google_email, 'owner@gmail.com')
  assert.equal(conn.owner_id, ADMIN_ID)
  assert.notEqual(conn.access_token, 'access-token-1', 'the access token is not in the clear')
  assert.notEqual(conn.refresh_token, 'refresh-token-1', 'nor the refresh token')
  assert.ok(conn.access_token.length > 20, 'but something was stored')
  assert.ok(conn.access_expires_at, 'and when it expires')
  assert.ok(body.authorizeUrl, 'the sign-in URL was handed over')
  assert.ok(state, 'and the state came back')
})

test('a destination spreadsheet is created for the owner, so nothing is left to set up', async () => {
  const { done } = await connect()
  const page = await done.text()
  assert.match(page, /Ruhi Collection — Orders/, 'the page says which sheet was made')

  const conn = readConnection()
  assert.equal(conn.spreadsheet_id, 'created-sheet-1', 'and the connection points at it')
  assert.equal(conn.sheet_tab, 'Orders', 'with the tab the export writes to')
  assert.equal(world.google.files.length, 1, 'exactly one file was created in Drive')
  assert.equal(world.google.renames[0].title, 'Orders')
  assert.equal(
    world.google.renames[0].sheetId,
    world.google.sheets['created-sheet-1'].tabId,
    'the rename is aimed at the tab id Google actually gave, not at 0',
  )
})

test('a sign-in link cannot be used twice, and it expires', async () => {
  await connect()
  const state = world.db.google_sheets_states[0].state_hash
  const again = await getCallback(`?code=the-code&state=${encodeURIComponent(state)}`)
  assert.equal(again.status, 400, 'the raw state is not a state any more')
  assert.match(await again.text(), /already been used|expired/)
})

test('the panel shows who is connected and which spreadsheets the app owns', async () => {
  await connect()
  const res = await post('status')
  const body = await res.json()
  assert.equal(body.connected, true)
  assert.equal(body.email, 'owner@gmail.com')
  assert.equal(body.sheets.length, 1, 'the sheet the app created is listed')
  assert.equal(body.spreadsheet.id, 'created-sheet-1', 'and it is already the destination')
  assert.equal(body.spreadsheet.tab, 'Orders')
})

test('the owner creates a spreadsheet, and it becomes the destination', async () => {
  await connect()
  const res = await post('create-sheet', { name: 'Weekly orders' })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.spreadsheet.id, 'created-sheet-2', 'a second sheet, beside the automatic one')
  assert.equal(body.spreadsheet.tab, 'Orders', 'the first tab is renamed so the export has somewhere to go')

  assert.equal(world.google.files.length, 2, 'the automatic one and the new one')
  assert.equal(world.google.renames[0].title, 'Orders')
  assert.equal(
    world.google.renames[0].sheetId,
    world.google.sheets['created-sheet-1'].tabId,
    'the rename is aimed at the tab id Google actually gave, not at 0',
  )

  const conn = readConnection()
  assert.equal(conn.spreadsheet_id, 'created-sheet-2')
  assert.equal(conn.sheet_tab, 'Orders')
})

test('the owner can point it at a spreadsheet they already have', async () => {
  await connect()
  world.google.sheets['their-own-sheet'] = { title: 'Weekly orders', tab: 'Data', tabId: 4242 }
  const res = await post('select-sheet', { spreadsheetId: 'https://docs.google.com/spreadsheets/d/their-own-sheet/edit' })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.spreadsheet.id, 'their-own-sheet')
  assert.equal(body.spreadsheet.title, 'Weekly orders')
  assert.equal(body.spreadsheet.tab, 'Data', 'the tab the sheet really has, not one we invented')
  assert.equal(readConnection().spreadsheet_id, 'their-own-sheet')
  assert.equal(readConnection().sheet_tab, 'Data')
})

test('a spreadsheet the connection cannot open is refused, in plain words', async () => {
  await connect()
  const res = await post('select-sheet', { spreadsheetId: 'a-sheet-that-does-not-exist-at-all' })
  assert.equal(res.status, 400)
  const body = await res.json()
  assert.match(body.error, /could not be opened/i)
  assert.equal(readConnection().spreadsheet_id, 'created-sheet-1', 'and the destination is left alone')
})

test('the export writes headers and one row per item', async () => {
  await connect()
  await post('create-sheet', { name: 'Orders' })

  const res = await post('export', { ids: ['aaaaaaaa-1111-1111-1111-111111111111'], filters: { status: 'all' } })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.orders, 1)
  assert.equal(body.skipped, 0)
  assert.match(body.url, /docs\.google\.com\/spreadsheets\/d\/created-sheet-2/)

  assert.equal(world.google.appended.length, 1)
  const values = world.google.appended[0].values
  assert.equal(values[0][0], 'Reference', 'the header row comes first')
  assert.equal(values[values.length - 1][0], 'RCH-0001', 'and the order is last')
  assert.equal(values[values.length - 1].includes(958), true, 'the total is a number, not text')

  assert.equal(world.db.order_sheet_exports.length, 1, 'the order is now in the ledger')
  assert.equal(world.db.order_sheet_exports[0].order_id, 'aaaaaaaa-1111-1111-1111-111111111111')
})

test('the same order is never sent to the same sheet twice', async () => {
  await connect()
  await post('create-sheet', { name: 'Orders' })
  const id = 'aaaaaaaa-1111-1111-1111-111111111111'

  const first = await post('export', { ids: [id] })
  assert.equal((await first.json()).orders, 1)

  const second = await post('export', { ids: [id] })
  const body = await second.json()
  assert.equal(body.orders, 0, 'nothing new to send')
  assert.equal(body.skipped, 1, 'and the admin is told what was skipped')
  assert.match(body.message, /already in that spreadsheet/i)
  assert.equal(world.google.appended.length, 1, 'and the sheet did not grow')

  // Unless the owner insists.
  const forced = await post('export', { ids: [id], includeExported: true })
  assert.equal((await forced.json()).orders, 1)
  assert.equal(world.google.appended.length, 2, 'then it is sent again, as asked')
})

test('an expired access token is refreshed and the export still works', async () => {
  await connect()
  await post('create-sheet', { name: 'Orders' })

  // The stored access token has expired.
  const conn = readConnection()
  conn.access_expires_at = new Date(Date.now() - 60_000).toISOString()

  const before = world.google.refreshCalls
  const res = await post('export', { ids: ['aaaaaaaa-1111-1111-1111-111111111111'] })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).orders, 1)
  assert.equal(world.google.refreshCalls, before + 1, 'the token was refreshed')
  assert.equal(world.google.appended.length, 1)
})

test('a grant Google has taken back asks the owner to connect again', async () => {
  await connect()
  await post('create-sheet', { name: 'Orders' })
  const conn = readConnection()
  conn.access_expires_at = new Date(Date.now() - 60_000).toISOString()
  world.google.refreshFails = true

  const res = await post('export', { ids: ['aaaaaaaa-1111-1111-1111-111111111111'] })
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.equal(body.needsReconnect, true)
  assert.match(body.error, /connect Google Sheets again/i)
})

test('an export with no destination is refused before anything is sent', async () => {
  await connect()
  // The destination is created for the owner when they connect; this is the
  // case where it could not be, so the export has nowhere to go.
  readConnection().spreadsheet_id = null
  const res = await post('export', { ids: ['aaaaaaaa-1111-1111-1111-111111111111'] })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /Choose a spreadsheet/i)
})

test('a refusal from Google leaves the order exportable', async () => {
  await connect()
  await post('create-sheet', { name: 'Orders' })
  world.google.failNextAppend = 1
  world.google.failNextAppendWith = 403

  const res = await post('export', { ids: ['aaaaaaaa-1111-1111-1111-111111111111'] })
  assert.equal(res.status, 502)
  const body = await res.json()
  assert.match(body.error, /not allowed to write/i)
  assert.equal(world.db.order_sheet_exports.length, 0, 'nothing was marked as sent')
})

test('only the store owner gets in', async () => {
  reset()
  world.db.admins = []
  const res = await post('status')
  assert.equal(res.status, 403)
  assert.match((await res.json()).error, /store owner/i)
})

test('a stranger with no session gets nothing', async () => {
  reset()
  const res = await post('status', {}, { Authorization: '' })
  assert.equal(res.status, 401)
})

test('disconnecting revokes the grant at Google and forgets it', async () => {
  await connect()
  const res = await post('disconnect')
  assert.equal(res.status, 200)
  assert.equal(world.google.revokes, 1, 'the grant was revoked')
  assert.equal(world.db.google_sheets_connections.length, 0, 'and the tokens are gone')
})

test('a wrong Client secret is caught BEFORE the owner is sent to Google', async () => {
  reset()
  const before = ENV.GOOGLE_CLIENT_SECRET
  ENV.GOOGLE_CLIENT_SECRET = 'a-secret-that-does-not-belong'
  try {
    const res = await post('start')
    assert.equal(res.status, 501)
    const body = await res.json()
    assert.equal(body.reason, 'invalid_secret')
    assert.match(body.error, /Client secret is not valid/i)
    assert.ok(body.setup.length > 0, 'and the owner is told what to do')
    assert.ok(body.setupLinks.length > 0, 'with the pages to open')
    assert.equal(world.db.google_sheets_states.length, 0, 'no sign-in was started')
  } finally {
    ENV.GOOGLE_CLIENT_SECRET = before
  }
})

test('a callback URL Google does not know is caught BEFORE the owner is sent to Google', async () => {
  reset()
  world.google.registeredRedirects = []
  const res = await post('start')
  assert.equal(res.status, 501)
  const body = await res.json()
  assert.equal(body.reason, 'redirect_not_registered')
  assert.match(body.error, /callback URL/i)
  assert.ok(
    body.setup.join(' ').includes(`${SUPABASE_URL}/functions/v1/google-sheets-callback`),
    'and the exact URL to register is spelled out',
  )
  assert.equal(world.db.google_sheets_states.length, 0, 'no sign-in was started')
})

test('two exports cannot run at the same time', async () => {
  await connect()
  await post('create-sheet', { name: 'Orders' })
  const conn = readConnection()
  conn.export_started_at = new Date().toISOString()   // a lease is already held
  const res = await post('export', { ids: ['aaaaaaaa-1111-1111-1111-111111111111'] })
  assert.equal(res.status, 409)
  assert.match((await res.json()).error, /already running/i)
})

test('an API that is not enabled is reported with the link that fixes it', async () => {
  await connect()
  world.google.sheetsApiDisabled = true

  const res = await post('create-sheet', { name: 'Orders' })
  assert.equal(res.status, 501, 'not a generic failure: the owner is told what is wrong')
  const body = await res.json()
  assert.equal(body.reason, 'api_not_enabled')
  assert.match(body.error, /not enabled/i)
  assert.ok(body.setupLinks && body.setupLinks.length, 'with the page to open')
  assert.match(body.setupLinks[0].url, /console\.cloud\.google\.com/)
  assert.match(body.setupLinks[0].url, /project=550615952572/)
  assert.equal(readConnection().spreadsheet_id, 'created-sheet-1', 'and the connection is untouched')
})

test('the status says which Google API is missing, and keeps the answer', async () => {
  await connect()
  world.google.sheetsApiDisabled = true

  const res = await post('status')
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.apiCheck.sheets.ok, false, 'the Sheets API is the one that is off')
  assert.equal(body.apiCheck.sheets.reason, 'api_not_enabled')
  assert.match(body.apiCheck.sheets.message, /not enabled/i)
  assert.match(body.apiCheck.sheets.link, /sheets\.googleapis\.com/)
  assert.match(body.apiCheck.sheets.link, /project=550615952572/)
  assert.equal(body.apiCheck.drive.ok, true, 'the Drive API is fine')
  assert.ok(readConnection().api_check, 'and the answer is kept on the connection')
})

test('the tab is renamed with the id Google actually gave it', async () => {
  await connect()
  await post('create-sheet', { name: 'Orders' })
  const conn = readConnection()
  assert.equal(conn.sheet_tab, 'Orders', 'the export is pointed at a tab that exists')
  const rename = world.google.renames[world.google.renames.length - 1]
  assert.equal(rename.title, 'Orders')
  assert.equal(rename.sheetId, world.google.sheets[conn.spreadsheet_id].tabId)
  assert.notEqual(rename.sheetId, 0, 'and never at a made-up id')
})

test('creating the same spreadsheet twice reuses it instead of making a second', async () => {
  await connect()
  const first = await post('create-sheet', { name: 'Weekly orders' })
  const second = await post('create-sheet', { name: 'Weekly orders' })
  const a = await first.json()
  const b = await second.json()
  assert.equal(a.reused, false, 'the first one is made')
  assert.equal(b.reused, true, 'the second press reuses it')
  assert.equal(b.spreadsheet.id, a.spreadsheet.id)
  assert.equal(
    world.google.files.filter((f) => f.name === 'Weekly orders').length,
    1,
    'and there is exactly one spreadsheet with that name',
  )
})

test('the export writes to a tab that exists, even one the owner named', async () => {
  await connect()
  world.google.sheets['their-own-sheet'] = { title: 'Weekly orders', tab: 'Data', tabId: 4242 }
  await post('select-sheet', {
    spreadsheetId: 'https://docs.google.com/spreadsheets/d/their-own-sheet/edit',
  })

  const res = await post('export', { ids: ['aaaaaaaa-1111-1111-1111-111111111111'] })
  assert.equal(res.status, 200, 'the export did not fail on a missing tab')
  assert.equal(world.google.appended.length, 1)
  assert.equal(readConnection().sheet_tab, 'Data', 'and the connection follows the sheet')
})

test('signing in again does not make a second spreadsheet', async () => {
  await connect()
  const before = world.google.files.length
  await connect()
  assert.equal(world.google.files.length, before, 'the destination is kept, not replaced')
  assert.equal(readConnection().spreadsheet_id, 'created-sheet-1')
})

test('the panel can show what is actually in the sheet, and the receipt of the export', async () => {
  await connect()
  await post('export', { ids: ['aaaaaaaa-1111-1111-1111-111111111111'] })

  const res = await post('preview')
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.header[0], 'Reference', 'the header row is there')
  assert.equal(body.rows >= 2, true, 'and the order below it')
  assert.equal(body.sample[0][0], 'RCH-0001', 'the order is in there')
  assert.match(body.url, /docs\.google\.com\/spreadsheets\/d\/created-sheet-1/)

  // The receipt, written only after Google accepted the rows.
  const conn = readConnection()
  assert.equal(conn.last_export_orders, 1)
  assert.equal(conn.last_export_rows, 2, 'the header and the order')
  assert.match(conn.last_export_range, /A1/)
  assert.ok(conn.last_export_at, 'and when it happened')
})
