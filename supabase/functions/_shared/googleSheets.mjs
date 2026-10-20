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
  const reason = typeof body?.error === 'string' ? body.error : ''
  const message = typeof body?.error_description === 'string' ? body.error_description
    : typeof body?.message === 'string' ? body.message : ''
  const project = (String(clientId).match(/^(\d+)-/) || [])[1] || ''

  if (reason === 'SERVICE_DISABLED' || /has not been used in project|is disabled/i.test(message)) {
    const api = /drive/i.test(message) ? 'drive' : 'sheets'
    return {
      reason: 'api_not_enabled',
      message: `The Google ${api === 'drive' ? 'Drive' : 'Sheets'} API is not enabled for this project`
        + `${project ? ` (${project})` : ''}, so Google refused the request.`,
      link: `https://console.cloud.google.com/apis/library/${api}.googleapis.com`
        + `${project ? `?project=${project}` : ''}`,
    }
  }
  if (status === 403 && /insufficient|insufficientPermissions|not authorized/i.test(`${reason} ${message}`)) {
    return {
      reason: 'not_permitted',
      message: 'This Google account is not allowed to do that with this connection. '
        + 'Press Connect Google Sheets again and approve the access when Google asks.',
      link: '',
    }
  }
  if (status === 401) {
    return {
      reason: 'expired',
      message: 'Google rejected the access token. Press Connect Google Sheets again to renew it.',
      link: '',
    }
  }
  if (status === 404) {
    return {
      reason: 'not_found',
      message: 'Google could not find that spreadsheet. It may have been deleted.',
      link: '',
    }
  }
  return {
    reason: reason || `http_${status}`,
    message: message || `Google refused the request (HTTP ${status}).`,
    link: '',
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
  const query = `mimeType='${SPREADSHEET_MIME}' and trashed=false`
  const url = `${DRIVE_API}?q=${encodeURIComponent(query)}`
    + '&fields=' + encodeURIComponent('files(id,name,modifiedTime,webViewLink)')
    + '&pageSize=50'
  const res = await googleJson(url, accessToken)
  if (!res.ok) return []
  const files = Array.isArray(res.body?.files) ? res.body.files : []
  return files
    .filter((f) => typeof f.id === 'string' && f.id)
    .map((f) => ({
      id: String(f.id),
      title: String(f.name ?? 'Untitled spreadsheet'),
      modified: typeof f.modifiedTime === 'string' ? f.modifiedTime : '',
      url: `https://docs.google.com/spreadsheets/d/${f.id}`,
    }))
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
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { tabColor: { red: 0.9, green: 0.7, blue: 0.6 } } }],
    }),
  })
  if (!res.ok) return { error: res }
  const id = String(res.body?.spreadsheetId ?? '')
  if (!id) return { error: { status: 502, body: { error: 'no_id' } } }
  return { id, title: String(res.body?.properties?.title ?? title) }
}

/**
 * Rename a spreadsheet's first tab.
 *
 * A brand new spreadsheet's first tab is called "Sheet1"; the export writes
 * to a tab called "Orders", so it is renamed straight away.
 */
export async function renameFirstTab(accessToken, sheetId, title = DEFAULT_TAB) {
  const res = await googleJson(
    `${SHEETS_API}/${encodeURIComponent(sheetId)}:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [{ updateSheetProperties: { sheetId: 0, title, fields: 'title' } }],
      }),
    },
  )
  return res.ok ? title : 'Sheet1'
}

/** Create a spreadsheet and give it the tab the export writes to. */
export async function createSheetWithTab(accessToken, title) {
  const created = await createSpreadsheet(accessToken, title)
  if (created.error) return { error: created.error }
  const tab = await renameFirstTab(accessToken, created.id, DEFAULT_TAB)
  return { id: created.id, title: created.title, tab }
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
