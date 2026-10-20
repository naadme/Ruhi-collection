// The Google Sheets and Drive calls, in one place, so the two functions that
// make them can never drift apart.
//
// Plain JavaScript for the same reason as the rest of the shared code: the
// Edge Functions import it and so does the Node test suite.
//
// The access token is always the OWNER'S OWN — it comes from the OAuth
// connection, not from a service account — and it is only ever used in the
// Authorization header of the call it belongs to.

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
 * The spreadsheets this app created in the owner's Drive — and only those.
 *
 * The `drive.file` scope cannot see the rest of their Drive, so this is the
 * whole of what the app is able to list.
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

/** Create a spreadsheet in the owner's Drive. */
export async function createSpreadsheet(accessToken, title) {
  const res = await googleJson(`${DRIVE_API}?fields=${encodeURIComponent('id,name')}`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ name: title, mimeType: SPREADSHEET_MIME }),
  })
  if (!res.ok) return null
  const id = String(res.body?.id ?? '')
  return id ? { id, title } : null
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
  if (!created) return null
  const tab = await renameFirstTab(accessToken, created.id, DEFAULT_TAB)
  return { ...created, tab }
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
