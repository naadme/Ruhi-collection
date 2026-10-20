// The Google Sheets API helpers and the admin panel that drives them.
//
// These are the pieces that were wrong when the owner pressed "Create
// spreadsheet" and the panel kept spinning: the tab Google gave the sheet was
// not the tab the code renamed, a sheet could be made twice, and a finished
// action left its spinner behind.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  createSpreadsheet,
  listSpreadsheets,
  pickTab,
  renameFirstTab,
} from '../supabase/functions/_shared/googleSheets.mjs'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const PANEL = 'src/admin/GoogleSheetsPanel.jsx'
const CLIENT = 'src/lib/googleSheets.js'
const FN = 'supabase/functions/google-sheets/index.ts'

// ---------------------------------------------------------------------------
// The tab Google really gave the sheet
// ---------------------------------------------------------------------------

test('a new spreadsheet reports the tab id Google assigned it', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    spreadsheetId: 'sheet-1',
    properties: { title: 'Orders' },
    sheets: [{ properties: { sheetId: 1318175855, title: 'Sheet1' } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  try {
    const created = await createSpreadsheet('token', 'Orders')
    assert.equal(created.id, 'sheet-1')
    assert.equal(created.firstSheetId, 1318175855, 'not a made-up 0')
    assert.equal(created.firstTabTitle, 'Sheet1')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a rename is refused when it is aimed at a tab that does not exist', async () => {
  const realFetch = globalThis.fetch
  let asked = null
  globalThis.fetch = async (_url, init) => {
    asked = JSON.parse(init.body).requests[0].updateSheetProperties
    return new Response(JSON.stringify({ error: { code: 400, message: 'No sheet with id: 0' } }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const renamed = await renameFirstTab('token', 'sheet-1', 'Orders', 1318175855)
    assert.equal(renamed.ok, false, 'the refusal is reported, not hidden')
    assert.equal(asked.sheetId, 1318175855, 'and the real tab id was the one asked for')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('the tab to write to is the one wanted, or the first there is', () => {
  const structure = { title: 'Sheet', tabs: [{ sheetId: 1, title: 'Sheet1' }, { sheetId: 2, title: 'Orders' }] }
  assert.equal(pickTab(structure, 'Orders').title, 'Orders', 'the one that was asked for')
  assert.equal(pickTab(structure, 'Sheet1').title, 'Sheet1')
  assert.equal(pickTab(structure, 'Nope').title, 'Sheet1', 'a tab that is not there: the first one')
  assert.equal(pickTab({ tabs: [] }, 'Orders'), null, 'no tabs at all')
  assert.equal(pickTab(null, 'Orders'), null)
})

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

test('the list of spreadsheets follows Google\'s pages', async () => {
  const realFetch = globalThis.fetch
  let page = 0
  globalThis.fetch = async (url) => {
    page += 1
    const asked = String(url)
    if (page === 1) {
      assert.match(asked, /pageSize=100/)
      return new Response(JSON.stringify({
        files: [{ id: 'a', name: 'One' }],
        nextPageToken: 'page-2',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    assert.match(asked, /pageToken=page-2/, 'the second page is asked for')
    return new Response(JSON.stringify({
      files: [{ id: 'b', name: 'Two' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const sheets = await listSpreadsheets('token')
    assert.equal(sheets.length, 2, 'a sheet on the second page is not invisible')
    assert.deepEqual(sheets.map((s) => s.title), ['One', 'Two'])
  } finally {
    globalThis.fetch = realFetch
  }
})

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

test('every action clears its spinner, whatever happened', () => {
  const panel = read(PANEL)
  // One runner for every action, and it always clears the busy flag.
  assert.match(panel, /const run = useCallback\(async \(name, work\) => \{/)
  assert.match(panel, /\} finally \{\s*setState\(\(s\) => \(\{ \.\.\.s, busy: '' \}\)\)/,
    'the spinner goes away on success, on failure and on a timeout alike')
  // And no action may set the busy flag without going through the runner.
  const setters = panel.match(/busy: '[a-z]+'/g) || []
  assert.equal(setters.length, 0, 'the busy flag is only ever set by the runner')
})

test('a call that never answers is called off, and says so', () => {
  assert.match(read(CLIENT), /timeout: \d+/, 'the request has a deadline')
  assert.match(read(CLIENT), /did not answer in time/i, 'and the owner is told what happened')
})

test('the destination is only remembered after Google has confirmed it', () => {
  const fn = read(FN)
  const create = fn.slice(fn.indexOf('async function actionCreateSheet'))
  const body = create.slice(0, create.indexOf('\n}\n'))
  // After the sheet is asked for, a refusal returns BEFORE anything is saved...
  const afterCreate = body.slice(body.indexOf('const created = await createSheetWithTab'))
  assert.ok(
    afterCreate.indexOf('created.error') < afterCreate.indexOf('await patchConnection(String(conn.id)'),
    'a refused creation never reaches the save',
  )
  // ...and the save happens only once the spreadsheet really exists.
  assert.match(body, /await patchConnection\(String\(conn\.id\), \{\s*spreadsheet_id: created\.id/)
})

test('the export writes to a tab the sheet really has', () => {
  const fn = read(FN)
  const body = fn.slice(fn.indexOf('async function actionExport'))
  assert.match(body, /getSheetStructure\(token, sheetId\)/, 'the tabs are read before writing')
  assert.match(body, /pickTab\(structure/, 'and the right one is chosen')
  assert.match(body, /exportOrdersToSheet\(\{/, 'the write goes through the shared export')
  assert.match(body, /tab: tab\.title/, 'and it is the tab that exists')
  // And the shared export is what actually appends.
  const shared = read('supabase/functions/_shared/googleSheets.mjs')
  assert.match(shared, /await appendRows\(accessToken, sheetId, tab, values\)/)
})

test('creating the same spreadsheet twice reuses it', () => {
  const fn = read(FN)
  const body = fn.slice(fn.indexOf('async function actionCreateSheet'))
  assert.match(body, /listSpreadsheets\(token\)\)\.find\(\(s\) => s\.title === title\)/,
    'a sheet with that name is looked for first')
  assert.match(body, /reused: true/, 'and reused rather than made again')
})

test('signing in again changes nothing about the destination', () => {
  const cb = read('supabase/functions/google-sheets-callback/index.ts')
  assert.match(cb, /hadDestination/, 'the existing destination is noticed')
  assert.match(cb, /hadDestination\s*\?\s*null\s*:\s*await createSheetWithTab/,
    'and no second spreadsheet is made')
  assert.doesNotMatch(cb, /spreadsheet_id: null/, 'the destination is never wiped')
})
