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

import { buildSheetValues, duplicatesAmong } from './sheetRows.mjs'

export const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet'
export const DEFAULT_TAB = 'Orders'

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files'

/** One call to Google, with the answer already parsed. */
export async function googleJson(url, accessToken, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const body = (await res.json().catch(() => null))
  return { ok: res.ok, status: res.status, body }
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
export async function createSpreadsheet(accessToken, title) {
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
export async function createSheetWithTab(accessToken, title) {
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

/** Append rows to a spreadsheet. */
export async function appendRows(accessToken, sheetId, tab, values) {
  const range = `${encodeURIComponent(tab)}!A1`
  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${range}:append`
    + '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS'
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
    + 'razorpay_order_id,razorpay_payment_id,note,order_items(title,size,qty,unit_price)'
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
 * One row per line item, the order's money repeated on every item row, the
 * header row only with the first export, and the orders that are already in
 * the sheet left out unless the owner asks for them again.
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
  const { fresh, repeated } = duplicatesAmong(orders, alreadyExported)
  const sending = includeExported ? orders : fresh

  if (!sending.length) {
    return {
      ok: true,
      orders: 0,
      rows: 0,
      skipped: repeated.length,
      message: 'Every order in this view is already in that spreadsheet.',
    }
  }

  const values = buildSheetValues(sending, filters, {
    includeHeaders: alreadyExported.length === 0,
  })
  const written = await appendRows(accessToken, sheetId, tab, values)
  if (!written.ok) {
    return { ok: false, status: written.status, body: written.body }
  }

  const updates = written.body && written.body.updates
  return {
    ok: true,
    orders: sending.length,
    rows: values.length,
    skipped: repeated.length,
    range: updates && typeof updates.updatedRange === 'string' ? updates.updatedRange : null,
    orderIds: sending.map((o) => String(o.id)),
  }
}
