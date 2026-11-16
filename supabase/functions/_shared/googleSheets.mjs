// The Google Sheets and Drive calls, in one place, so the two functions that
// make them can never drift apart.
//
// Plain JavaScript for the same reason as the rest of the shared code: the
// Edge Functions import it and so does the Node test suite.
//
// The access token is always the OWNER'S OWN — it comes from the OAuth
// connection, not from a service account — and it is only ever used in the
// Authorization header of the call it belongs to.
//
// Creating a spreadsheet goes through the SHEETS API, not the Drive API.
// The Sheets API's `spreadsheets.create` needs only the `spreadsheets` scope —
// which the connection already has — and it puts the file in the owner's own
// Drive. The Drive API is then only used to LIST the sheets this app created,
// which is a convenience: if the Drive API is not enabled on the project, the
// list is simply empty and everything else still works.

import {
  buildSheetValues,
  DEFAULT_SHEET_TITLE,
  detectSheetLayout,
  duplicatesAmong,
  LEGACY_LAYOUT,
  legacyOrderRows,
  ORDER_LAYOUT,
  orderRows,
  sheetColumnsFor,
} from './sheetRows.mjs'

export const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet'
export const DEFAULT_TAB = 'Orders'

/**
 * Every key an Order ID may have in a sheet, so a row written before leading
 * zeros were preserved is still found and updated in place.
 *
 * `03112601`, `'03112601` and the number `3112601` all name the same order;
 * `Zero` is never used because the reference is never an empty string here.
 */
export function orderIdKeys(value) {
  let text = String(value ?? '').trim()
  if (!text) return []
  if (text.startsWith("'")) text = text.slice(1).trim()
  if (!text) return []
  const digits = text.replace(/[^\d]/g, '')
  const keys = new Set([text])
  if (digits) {
    keys.add(digits)
    // A leading zero lost by Sheets, whatever the ID's length: 8-digit DDMMYYNN.
    const trimmed = digits.replace(/^0+/, '')
    if (trimmed) {
      keys.add(trimmed)
      keys.add(trimmed.padStart(8, '0'))
    }
  }
  return [...keys]
}

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files'

/** One call to Google, with the answer already parsed.
 *
 * Google is a shared service and answers 429 (rate limit) and 503 (a bad
 * minute) at moments that have nothing to do with the request itself. Those
 * two are retried, a couple of times, a beat apart — a single failed call
 * used to cost the whole export until the next day's run.
 *
 * A WRITE is only retried when Google has certainly not carried it out: a
 * 429 or a 503 is answered BEFORE the append happens, so retrying them can
 * never put the same orders in the sheet twice. A write that fails with a
 * dropped connection might already have landed, so it is not retried here —
 * the daily run and the admin's own button pick it up, and the export ledger
 * is what stops it being written twice.
 *
 * `wait` and `attempts` are parameters so the tests can run this without
 * spending four seconds, and so the rule can be pinned. */
export const GOOGLE_RETRY_STATUSES = [429, 503]
export const GOOGLE_MAX_ATTEMPTS = 3

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Is this an answer worth asking Google for again? */
export function isRetryableGoogleStatus(status) {
  return GOOGLE_RETRY_STATUSES.includes(Number(status))
}

export async function googleJson(
  url,
  accessToken,
  init = {},
  { attempts = GOOGLE_MAX_ATTEMPTS, wait = sleep } = {}) {
  const isWrite = /^(POST|PUT|PATCH|DELETE)$/i.test(String(init.method || 'GET'))
  const tries = Math.max(1, Number(attempts) || 1)
  let last = null
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      })
      const body = (await res.json().catch(() => null))
      last = { ok: res.ok, status: res.status, body }
      // A dropped connection on a READ is worth one more try: nothing was
      // written, so there is nothing that could happen twice.
      if (res.ok || !isRetryableGoogleStatus(res.status)) return last
    } catch (e) {
      last = { ok: false, status: 0, body: null, network: String(e?.message ?? e) }
      if (isWrite) return last
    }
    if (attempt < tries) await wait(200 * attempt)
  }
  return last
}

/**
 * Google's own reason, turned into a sentence the admin can act on.
 *
 * The common one by far is an API that is not enabled on the Google Cloud
 * project: Google answers 403 with `SERVICE_DISABLED` and names the project.
 * Saying so — with the exact link to enable it — is the difference between
 * "something went wrong" and a five-second fix.
 */
export function describeApiProblem(status, body, clientId = '') {
  // Google answers the APIs with the error NESTED inside an object:
  //   { "error": { "code": 403, "message": "…", "status": "PERMISSION_DENIED",
  //                "details": [ { "reason": "SERVICE_DISABLED" } ] } }
  // and the OAuth endpoints with a flat one:
  //   { "error": "invalid_client", "error_description": "…" }
  // Both are read here, because missing the nested shape is what turns a
  // precise answer into "something went wrong".
  const nested = body && typeof body.error === 'object' && body.error ? body.error : null
  const reason = nested
    ? String(nested.status || (Array.isArray(nested.details) ? nested.details[0]?.reason : '') || '')
    : (typeof body?.error === 'string' ? body.error : '')
  const message = nested
    ? String(nested.message || '')
    : (typeof body?.error_description === 'string' ? body.error_description
      : typeof body?.message === 'string' ? body.message : '')
  const project = (String(clientId).match(/^(\d+)-/) || [])[1] || ''

  if (reason === 'SERVICE_DISABLED' || /has not been used in project|is disabled/i.test(message)) {
    const api = /drive/i.test(message) ? 'drive' : 'sheets'
    return {
      reason: 'api_not_enabled',
      message: `The Google ${api === 'drive' ? 'Drive' : 'Sheets'} API is not enabled for this project`
        + `${project ? ` (${project})` : ''}, so Google refused the request.`,
      link: `https://console.cloud.google.com/apis/library/${api}.googleapis.com`
        + `${project ? `?project=${project}` : ''}`,
      googleError: reason,
      googleMessage: message,
    }
  }
  if (status === 403 && /insufficient|not authorized|permission/i.test(`${reason} ${message}`)) {
    return {
      reason: 'not_permitted',
      message: 'This Google account is not allowed to do that with this connection. '
        + 'Press Connect Google Sheets again and approve the access when Google asks.',
      link: '',
      googleError: reason,
      googleMessage: message,
    }
  }
  if (status === 401) {
    return {
      reason: 'expired',
      message: 'Google rejected the access token. Press Connect Google Sheets again to renew it.',
      link: '',
      googleError: reason,
      googleMessage: message,
    }
  }
  if (status === 404) {
    return {
      reason: 'not_found',
      message: 'Google could not find that spreadsheet. It may have been deleted.',
      link: '',
      googleError: reason,
      googleMessage: message,
    }
  }
  return {
    reason: reason || `http_${status}`,
    message: message || `Google refused the request (HTTP ${status}).`,
    link: '',
    googleError: reason,
    googleMessage: message,
  }
}

/**
 * Check, without changing anything, whether the two Google APIs this app
 * needs are actually available to the connection.
 *
 * Both probes are read-only and need no spreadsheet:
 *   * the Sheets API is asked for an id that cannot exist — a 404 means the
 *     API is alive and working, a 403 SERVICE_DISABLED means the API is not
 *     enabled on the Google Cloud project;
 *   * the Drive API is asked for a single file.
 *
 * This is what turns "Google could not create the spreadsheet" into the
 * truth: which API is off, and the link that turns it on.
 */
export async function probeGoogleApis(accessToken, clientId = '') {
  const sheets = await googleJson(
    `${SHEETS_API}/000000000000000000000000000000000?fields=${encodeURIComponent('spreadsheetId')}`,
    accessToken,
  )
  const drive = await googleJson(
    `${DRIVE_API}?pageSize=1&fields=${encodeURIComponent('files(id)')}`,
    accessToken,
  )

  const describe = (res) => {
    // A spreadsheet that cannot exist — answered, so the API is enabled.
    if (res.status === 404) return { ok: true, status: 404 }
    if (res.ok) return { ok: true, status: res.status }
    const problem = describeApiProblem(res.status, res.body, clientId)
    return { ok: false, status: res.status, ...problem }
  }

  return {
    checkedAt: new Date().toISOString(),
    sheets: describe(sheets),
    drive: describe(drive),
  }
}

/**
 * The spreadsheets this app created in the owner's Drive — and only those.
 *
 * The `drive.file` scope cannot see the rest of their Drive, so this is the
 * whole of what the app is able to list. It is a convenience only: if the
 * Drive API is unavailable, the panel still works.
 */
export async function listSpreadsheets(accessToken) {
  const out = []
  const query = `mimeType='${SPREADSHEET_MIME}' and trashed=false`
  let pageToken = ''
  // The list is paged by Google; a sheet on the second page must not be
  // invisible, so every page is followed (up to a thousand sheets).
  for (let page = 0; page < 10; page += 1) {
    const url = `${DRIVE_API}?q=${encodeURIComponent(query)}`
      + '&fields=' + encodeURIComponent('files(id,name,modifiedTime,webViewLink),nextPageToken')
      + '&pageSize=100'
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '')
    const res = await googleJson(url, accessToken)
    if (!res.ok) return out
    const files = Array.isArray(res.body?.files) ? res.body.files : []
    out.push(...files
      .filter((f) => typeof f.id === 'string' && f.id)
      .map((f) => ({
        id: String(f.id),
        title: String(f.name ?? 'Untitled spreadsheet'),
        modified: typeof f.modifiedTime === 'string' ? f.modifiedTime : '',
        url: `https://docs.google.com/spreadsheets/d/${f.id}`,
      })))
    pageToken = String(res.body?.nextPageToken ?? '')
    if (!pageToken) break
  }
  return out
}

/**
 * Create a spreadsheet in the owner's own Drive.
 *
 * This is the SHEETS API, so it needs nothing beyond the `spreadsheets`
 * scope the connection already carries.
 */
export async function createSpreadsheet(accessToken, title = DEFAULT_SHEET_TITLE) {
  const res = await googleJson(SHEETS_API, accessToken, {
    method: 'POST',
    body: JSON.stringify({ properties: { title } }),
  })
  if (!res.ok) return { error: res }
  const id = String(res.body?.spreadsheetId ?? '')
  if (!id) return { error: { status: 502, body: { error: 'no_id' } } }
  // The first tab, exactly as Google made it. Its id is NOT always 0 — when a
  // spreadsheet is created with an explicit tab, Google assigns an id of its
  // own, and a rename aimed at 0 silently does nothing.
  const first = (Array.isArray(res.body?.sheets) ? res.body.sheets : [])[0]
  return {
    id,
    title: String(res.body?.properties?.title ?? title),
    firstSheetId: Number(first?.properties?.sheetId ?? 0),
    firstTabTitle: String(first?.properties?.title ?? 'Sheet1'),
  }
}

/**
 * Rename a spreadsheet's first tab.
 *
 * A brand new spreadsheet's first tab is called "Sheet1"; the export writes
 * to a tab called "Orders", so it is renamed straight away.
 */
export async function renameFirstTab(accessToken, sheetId, title = DEFAULT_TAB, tabSheetId = 0) {
  const res = await googleJson(
    `${SHEETS_API}/${encodeURIComponent(sheetId)}:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [{ updateSheetProperties: { sheetId: tabSheetId, title, fields: 'title' } }],
      }),
    },
  )
  return { ok: res.ok, title: res.ok ? title : null, error: res.ok ? null : res }
}

/** Create a spreadsheet and give it the tab the export writes to. */
export async function createSheetWithTab(accessToken, title = DEFAULT_SHEET_TITLE) {
  const created = await createSpreadsheet(accessToken, title)
  if (created.error) return { error: created.error }
  // Aim the rename at the tab Google really created, and if the rename is
  // refused, fall back to the name that tab already has — the export then
  // writes there, rather than to a tab that does not exist.
  const renamed = await renameFirstTab(accessToken, created.id, DEFAULT_TAB, created.firstSheetId)
  return {
    id: created.id,
    title: created.title,
    tab: renamed.ok ? DEFAULT_TAB : created.firstTabTitle,
    tabRenamed: renamed.ok,
  }
}

/**
 * The tabs a spreadsheet has, with the ids Google gave them.
 */
export async function getSheetStructure(accessToken, sheetId) {
  const res = await googleJson(
    `${SHEETS_API}/${encodeURIComponent(sheetId)}`
    + `?fields=${encodeURIComponent('spreadsheetId,properties.title,sheets.properties')}`,
    accessToken,
  )
  if (!res.ok) return null
  return {
    title: String(res.body?.properties?.title ?? ''),
    tabs: (Array.isArray(res.body?.sheets) ? res.body.sheets : []).map((s) => ({
      sheetId: Number(s?.properties?.sheetId ?? 0),
      title: String(s?.properties?.title ?? ''),
    })),
  }
}

/**
 * The tab to write to: the one that was asked for if the sheet has it, and
 * otherwise the first tab there is. A spreadsheet the owner made themselves
 * may well call its only tab something else entirely, and the export must
 * still find somewhere to write.
 */
export function pickTab(structure, preferred) {
  const tabs = structure && Array.isArray(structure.tabs) ? structure.tabs : []
  if (!tabs.length) return null
  const wanted = tabs.find((t) => t.title === preferred)
  return wanted || tabs[0]
}

/** Does the connection actually have this spreadsheet? */
export async function getSpreadsheet(accessToken, sheetId) {
  const res = await googleJson(
    `${SHEETS_API}/${encodeURIComponent(sheetId)}?fields=${encodeURIComponent('spreadsheetId,title')}`,
    accessToken,
  )
  if (!res.ok) return null
  return { id: String(res.body?.spreadsheetId ?? sheetId), title: String(res.body?.title ?? '') }
}

/**
 * Share a spreadsheet with the client's Google account.
 *
 * The file lives in the OWNER'S Drive; this adds the client as a writer so
 * she can open the same spreadsheet from her own account. The `drive.file`
 * scope is enough for a file this app created (which is the case for this
 * integration's own sheet), and no broader Drive access is asked for.
 *
 * `sendNotificationEmail=false` keeps Google from sending mail the owner did
 * not write. A refusal is returned, never thrown: a sheet that could not be
 * shared is still a working sheet for the owner.
 */
export async function shareSpreadsheet(accessToken, sheetId, email, role = 'writer') {
  const address = String(email || '').trim()
  if (!address) return { ok: false, error: 'No Google account was given to share with.' }
  const res = await googleJson(
    `${DRIVE_API}/${encodeURIComponent(sheetId)}/permissions`
    + '?sendNotificationEmail=false&supportsAllDrives=true'
    + '&fields=' + encodeURIComponent('id,emailAddress,role,type'),
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ role, type: 'user', emailAddress: address }),
    },
  )
  if (!res.ok) {
    const problem = describeApiProblem(res.status, res.body)
    return {
      ok: false,
      status: res.status,
      reason: problem.reason,
      error: problem.message,
      email: address,
    }
  }
  return {
    ok: true,
    email: address,
    role,
    permissionId: String(res.body?.id ?? ''),
    at: new Date().toISOString(),
  }
}

/**
 * Is this spreadsheet already shared with that account?
 *
 * Read-only; used by the panel to tell the truth instead of claiming a share
 * that Google does not have. A failure returns `null`, which the caller shows
 * as "could not check" rather than "not shared".
 */
export async function findSharingPermission(accessToken, sheetId, email) {
  const res = await googleJson(
    `${DRIVE_API}/${encodeURIComponent(sheetId)}/permissions`
    + '?fields=' + encodeURIComponent('permissions(id,emailAddress,role,type)'),
    accessToken,
  )
  if (!res.ok) return null
  const wanted = String(email || '').trim().toLowerCase()
  const list = Array.isArray(res.body?.permissions) ? res.body.permissions : []
  return list.find((p) => String(p?.emailAddress || '').toLowerCase() === wanted) || null
}

/** The first row of a tab, or null when Google would not read it. */
export async function readSheetHeader(accessToken, sheetId, tab) {
  const values = await readRange(accessToken, sheetId, tab, 'A1:ZZ1')
  if (values === null) return null
  return Array.isArray(values[0]) ? values[0] : []
}

/** The layout of a sheet — new, legacy, empty or somebody else's data. */
export async function sheetLayoutOf(accessToken, sheetId, tab) {
  const header = await readSheetHeader(accessToken, sheetId, tab)
  if (header === null) return null
  return { header, layout: detectSheetLayout(header) }
}

/**
 * Append rows to a spreadsheet.
 *
 * RAW on purpose: an Order ID such as `03112601` must keep its leading zero,
 * and a customer note that begins with "=" must stay text instead of becoming
 * a formula. `USER_ENTERED` parses the value first and loses both.
 */
export async function appendRows(accessToken, sheetId, tab, values) {
  const range = `${encodeURIComponent(tab)}!A1`
  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${range}:append`
    + '?valueInputOption=RAW&insertDataOption=INSERT_ROWS'
  return googleJson(url, accessToken, { method: 'POST', body: JSON.stringify({ values }) })
}

/** Read a range back — used to prove what actually landed in the sheet. */
export async function readRange(accessToken, sheetId, tab, range = 'A1:Z50') {
  const res = await googleJson(
    `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`${tab}!${range}`)}`,
    accessToken,
  )
  if (!res.ok) return null
  const values = Array.isArray(res.body?.values) ? res.body.values : []
  return values
}


/** Write a range of values — used to name the columns a sheet is missing. */
export async function updateRange(accessToken, sheetId, tab, range, values) {
  // Google refuses an update that does not say what to do with the value.
  // RAW writes the text exactly as given — a status is never run through a
  // formula.
  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`${tab}!${range}`)}`
    + '?valueInputOption=RAW'
  return googleJson(url, accessToken, { method: 'PUT', body: JSON.stringify({ values }) })
}

/** The spreadsheet column name for a zero-based index: 0 -> A, 25 -> Z, 26 -> AA. */
export function columnName(index) {
  let n = Number(index)
  if (!Number.isFinite(n) || n < 0) return 'A'
  let out = ''
  n = Math.floor(n)
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

/**
 * Put the column names in the first row of a sheet.
 *
 * Three cases, all safe:
 *   * an empty sheet gets its full header — the layout that header describes
 *     is the one the export then writes;
 *   * a sheet made by this version keeps its header, and only headings added
 *     later are appended to the right of the existing ones;
 *   * a sheet whose first cell is somebody else's data is left untouched. The
 *     export refuses it before calling this, so nothing is overwritten.
 */
export async function ensureSheetHeader(accessToken, sheetId, tab, columns) {
  const names = Array.isArray(columns) ? columns : []
  if (!names.length) return { ok: true, written: 0 }
  const header = await readRange(accessToken, sheetId, tab, 'A1:ZZ1')
  if (header === null) return { ok: false, written: 0, status: 0 }
  const first = header.length ? (header[0] || []) : []
  const firstCell = String(first[0] || '').trim()

  if (!firstCell) {
    // Empty sheet: write the whole header in one go. A blank first row with
    // data underneath would be unusual; refusing to touch anything but a
    // truly blank row keeps that from being overwritten.
    const second = await readRange(accessToken, sheetId, tab, 'A1:A2')
    const secondCell = second && second[1] ? String(second[1][0] || '').trim() : ''
    if (secondCell) return { ok: true, written: 0, layoutMismatch: true }
    const res = await updateRange(accessToken, sheetId, tab, 'A1', [names])
    if (!res.ok) {
      console.warn('[google-sheets] could not write the header:', res.status,
        JSON.stringify(res.body || {}).slice(0, 300))
    }
    return { ok: !!res.ok, written: res.ok ? names.length : 0, status: res.status, headerWritten: !!res.ok }
  }

  // A header of a different layout is not extended: that would mix the two
  // schemas in one row. The caller has already chosen the matching columns.
  if (firstCell !== String(names[0] || '').trim()) {
    return { ok: true, written: 0, layoutMismatch: true }
  }
  const missing = names.slice(first.length).filter(Boolean)
  if (!missing.length) return { ok: true, written: 0 }
  const from = columnName(first.length)
  const to = columnName(names.length - 1)
  const res = await updateRange(accessToken, sheetId, tab, `${from}1:${to}1`, [missing])
  if (!res.ok) {
    // Reported, not swallowed: a sheet whose columns are not named is worse
    // than no sheet at all, and the admin panel shows this.
    console.warn('[google-sheets] could not name the new columns:', res.status,
      JSON.stringify(res.body || {}).slice(0, 300))
  }
  return { ok: !!res.ok, written: res.ok ? missing.length : 0, status: res.status }
}

/**
 * The orders, with their line items, as the export needs them.
 *
 * `baseUrl` and `serviceKey` are passed in rather than read from the
 * environment here, so this module stays free of the Deno runtime and can be
 * imported by the test suite as it is.
 */
export async function loadOrdersForExport(baseUrl, serviceKey, ids) {
  if (!baseUrl || !serviceKey || !Array.isArray(ids) || !ids.length) return []
  const list = ids.map((id) => encodeURIComponent(String(id))).join(',')
  const res = await fetch(
    `${baseUrl}/rest/v1/orders?id=in.(${list})`
    + '&select=id,reference,created_at,status,payment_status,payment_method,full_name,email,phone,'
    + 'address,city,state,pincode,subtotal,discount,coupon_code,shipping,total,'
    + 'razorpay_order_id,razorpay_payment_id,note,order_items(title,size,qty,unit_price,sku)'
    + '&order=created_at.desc&limit=5000',
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  )
  if (!res.ok) return []
  const rows = await res.json().catch(() => [])
  return Array.isArray(rows) ? rows : []
}

/**
 * Write the orders to a spreadsheet.
 *
 * A new sheet gets one row per order. A legacy sheet keeps its old shape. The
 * orders already in the ledger are left out unless the owner explicitly asks
 * for a refresh; even then they are NEVER appended a second time — they are
 * updated in the rows they already occupy.
 *
 * Nothing is reported as done unless Google accepted the rows: the answer
 * carries the range and the row count Google itself confirmed.
 */
export async function exportOrdersToSheet({
  accessToken,
  sheetId,
  tab,
  orders,
  alreadyExported = [],
  includeExported = false,
  filters = {},
}) {
  const detected = await sheetLayoutOf(accessToken, sheetId, tab)
  if (!detected) {
    return {
      ok: false,
      status: 502,
      body: { error: 'sheet_unreadable' },
      message: 'Google would not open that spreadsheet just now. Please try again.',
    }
  }
  if (detected.layout === 'unknown') {
    return {
      ok: false,
      status: 409,
      body: { error: 'unsupported_layout' },
      message: 'That spreadsheet already has different columns in its first row. '
        + 'Choose an empty spreadsheet, or press “Create Ruhi Collections – Orders”.',
    }
  }
  const layout = detected.layout === 'empty' ? ORDER_LAYOUT : detected.layout
  const columns = sheetColumnsFor(layout)

  const { fresh, repeated } = duplicatesAmong(orders, alreadyExported)
  // A fresh order is appended; an order the sheet already holds is NEVER
  // appended again. When the owner asks for a refresh, those repeated orders
  // have the rows they already occupy brought up to date instead.
  const sending = fresh
  const refreshing = includeExported ? repeated : []

  if (!sending.length && !refreshing.length) {
    return {
      ok: true,
      orders: 0,
      rows: 0,
      skipped: repeated.length,
      layout,
      message: 'Every order in this view is already in that spreadsheet.',
    }
  }

  const heading = await ensureSheetHeader(accessToken, sheetId, tab, columns)
  if (heading && heading.layoutMismatch) {
    return {
      ok: false,
      status: 409,
      body: { error: 'unsupported_layout' },
      message: 'That spreadsheet has different columns in its first row. '
        + 'Choose an empty spreadsheet, or press “Create Ruhi Collections – Orders”.',
    }
  }

  // The header is written by ensureSheetHeader; the append carries data only.
  let written = null
  if (sending.length) {
    const values = buildSheetValues(sending, filters, { includeHeaders: false, layout })
    written = await appendRows(accessToken, sheetId, tab, values)
    if (!written.ok) {
      return { ok: false, status: written.status, body: written.body, layout }
    }
  }

  let refreshed = 0
  if (refreshing.length) {
    const references = await readRange(accessToken, sheetId, tab, 'A1:A5000')
    const rowMap = new Map()
    const put = (key, row) => {
      if (!key) return
      const list = rowMap.get(key) || []
      list.push(row)
      rowMap.set(key, list)
    }
    // Sheets can hand an Order ID back as a number, which loses a leading zero
    // (03112601 → 3112601). The same order is still matched under both forms
    // so an old row is updated in place instead of being appended again.
    for (let i = 0; i < (references || []).length; i += 1) {
      const cell = references[i]?.[0]
      for (const key of orderIdKeys(cell)) put(key, i + 1)
    }
    for (const order of refreshing) {
      const wanted = new Set()
      for (const value of [order.reference, order.previous_reference]) {
        for (const key of orderIdKeys(value)) {
          for (const row of rowMap.get(key) || []) wanted.add(row)
        }
      }
      const rows = [...wanted]
      const lineValues = layout === LEGACY_LAYOUT ? legacyOrderRows(order) : orderRows(order)
      if (!rows.length || !lineValues.length) continue
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i]
        const line = lineValues[Math.min(i, lineValues.length - 1)]
        const last = columnName(line.length - 1)
        await updateRange(accessToken, sheetId, tab, `A${row}:${last}${row}`, [line])
      }
      refreshed += 1
    }
  }

  const updates = written?.body && written.body.updates
  return {
    ok: true,
    orders: sending.length,
    rows: sending.length ? buildSheetValues(sending, filters, { includeHeaders: false, layout }).length : 0,
    skipped: repeated.length,
    refreshed,
    layout,
    headingsWritten: heading?.written || 0,
    headerWritten: !!heading?.headerWritten,
    range: updates && typeof updates.updatedRange === 'string' ? updates.updatedRange : null,
    orderIds: sending.map((o) => String(o.id)),
    message: sending.length
      ? undefined
      : `Refreshed ${refreshed} ${refreshed === 1 ? 'order' : 'orders'} already in that spreadsheet — no duplicate rows were added.`,
  }
}
