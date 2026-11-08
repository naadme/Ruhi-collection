// A dependency-free reader for the spreadsheets the owner uploads: .xlsx
// (Excel, Google Sheets, Numbers' "Export to Excel") and .csv.
//
// The partner of `xlsx.js` (the writer). An .xlsx file is a ZIP of XML parts;
// this reads the ZIP's central directory, inflates the parts it needs with the
// platform's own `DecompressionStream('deflate-raw')` (every current browser,
// and Node 18+), and pulls the cell text out of the sheet XML. Only text is
// wanted: every cell comes back as a string, exactly as Excel stored it. A
// date typed into Excel is stored as a day number (45964 = 3 Nov 2025), and
// the caller that expects a date turns it into one.
//
// Not supported, with a message saying what to do: the old binary .xls
// format, password-protected files, and ZIP64 archives (over 4 GB).

const dec = new TextDecoder('utf-8')

// ---- ZIP -------------------------------------------------------------------

const u16 = (b, at) => b[at] | (b[at + 1] << 8)
const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0

/** name -> { method, compressed, offset } for every entry in the archive. */
function zipEntries(bytes) {
  // The end-of-central-directory record is in the last 22 bytes, or up to 64 KB
  // earlier when the archive carries a comment.
  let end = -1
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at -= 1) {
    if (u32(bytes, at) === 0x06054b50) { end = at; break }
  }
  if (end < 0) throw new Error('This file could not be opened as an Excel workbook.')

  const count = u16(bytes, end + 10)
  let at = u32(bytes, end + 16)
  const entries = new Map()
  for (let i = 0; i < count; i += 1) {
    if (u32(bytes, at) !== 0x02014b50) throw new Error('This Excel file looks damaged. Save it again and retry.')
    const flags = u16(bytes, at + 8)
    const method = u16(bytes, at + 10)
    const compressed = u32(bytes, at + 20)
    const nameLen = u16(bytes, at + 28)
    const extraLen = u16(bytes, at + 30)
    const commentLen = u16(bytes, at + 32)
    const offset = u32(bytes, at + 42)
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen))
    if (flags & 1) throw new Error('This file is password-protected. Remove the password in Excel and upload it again.')
    entries.set(name, { method, compressed, offset })
    at += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot open Excel files. Use a current Chrome, Safari or Edge, or upload a .csv.')
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** The text of one entry, or '' when the archive has no such entry. */
async function zipText(bytes, entries, name) {
  const entry = entries.get(name)
  if (!entry) return ''
  const at = entry.offset
  if (u32(bytes, at) !== 0x04034b50) throw new Error('This Excel file looks damaged. Save it again and retry.')
  const start = at + 30 + u16(bytes, at + 26) + u16(bytes, at + 28)
  const data = bytes.subarray(start, start + entry.compressed)
  if (entry.method === 0) return dec.decode(data)
  if (entry.method === 8) return dec.decode(await inflateRaw(data))
  throw new Error('This Excel file uses a compression this page cannot read. Save it again from Excel or Google Sheets.')
}

// ---- XML -------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** XML text to plain text: entities, character references, and Excel's own
 *  `_x000D_` escapes for characters XML cannot hold. */
export function xmlUnescape(text) {
  return String(text ?? '')
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, code) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        return Number.isFinite(n) ? String.fromCodePoint(n) : m
      }
      return ENTITIES[code.toLowerCase()] ?? m
    })
    .replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

/** The attributes of one tag, by local name (`r:id` and `id` are both `id`). */
function attrs(tagText) {
  const out = {}
  for (const m of String(tagText).matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    const name = m[1].includes(':') ? m[1].slice(m[1].indexOf(':') + 1) : m[1]
    if (!(name in out) || !m[1].includes(':')) out[name] = xmlUnescape(m[3] ?? m[4] ?? '')
  }
  return out
}

/** The visible text of a rich-text run list: every <t>, but not the phonetic
 *  guide (<rPh>) Excel adds to some East Asian text. */
const runText = (xml) =>
  [...String(xml).replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)]
    .map((m) => xmlUnescape(m[1] ?? ''))
    .join('')

/** "C12" -> 2 (zero-based column). */
const columnIndex = (ref) => {
  const letters = String(ref).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || ''
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function sheetRows(xml, shared) {
  const rows = []
  let nextRow = 0
  for (const rm of String(xml).matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const ra = attrs(rm[1])
    const r = ra.r ? Number(ra.r) - 1 : nextRow
    nextRow = r + 1
    const cells = []
    let nextCol = 0
    for (const cm of String(rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = attrs(cm[1])
      const c = ca.r ? columnIndex(ca.r) : nextCol
      nextCol = c + 1
      const inner = cm[2] || ''
      const v = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1]
      let value = ''
      if (ca.t === 's') value = shared[Number(v)] ?? ''
      else if (ca.t === 'inlineStr') value = runText(inner.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] || '')
      else if (ca.t === 'b') value = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : ''
      else if (ca.t === 'e') value = ''
      else value = v == null ? '' : xmlUnescape(v)
      if (c >= 0) cells[c] = value
    }
    rows[r] = Array.from(cells, (x) => x ?? '')
  }
  return Array.from(rows, (x) => x ?? [])
}

/** Every sheet of an .xlsx workbook, in the workbook's own order. */
export async function readXlsx(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const entries = zipEntries(bytes)
  const workbook = await zipText(bytes, entries, 'xl/workbook.xml')
  if (!workbook) throw new Error('This file is not an Excel workbook. Save it as .xlsx and upload it again.')
  const relsXml = await zipText(bytes, entries, 'xl/_rels/workbook.xml.rels')
  const rels = new Map(
    [...relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)].map((m) => {
      const a = attrs(m[1])
      const target = String(a.Target || '').replace(/^\/?xl\//, '').replace(/^\//, '')
      return [a.Id, `xl/${target}`]
    }),
  )
  const sharedXml = await zipText(bytes, entries, 'xl/sharedStrings.xml')
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => runText(m[1] || ''))

  const sheets = []
  for (const m of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1])
    const path = rels.get(a.id)
    if (!path) continue
    const xml = await zipText(bytes, entries, path)
    sheets.push({ name: a.name || `Sheet${sheets.length + 1}`, rows: sheetRows(xml, shared) })
  }
  return sheets
}

// ---- CSV -------------------------------------------------------------------

/**
 * A CSV file's rows. Quoted fields may hold commas, quotes ("") and line
 * breaks. The separator is whichever of comma, semicolon or tab the header
 * line uses most (Excel in some regions saves CSV with semicolons).
 */
export function readCsv(text) {
  const src = String(text ?? '').replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] || ''
  const outside = firstLine.replace(/"[^"]*"/g, '')
  const counts = [',', ';', '\t'].map((sep) => [sep, outside.split(sep).length - 1])
  const sep = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ','

  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1 } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

// ---- either ----------------------------------------------------------------

/**
 * The sheets of an uploaded file: [{ name, rows: string[][] }].
 * An .xlsx is recognised by its ZIP signature, not its name; anything else is
 * read as CSV text, except the old .xls format, which is refused.
 */
export async function readSpreadsheet(input, fileName = '') {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.length >= 4 && u32(bytes, 0) === 0x04034b50) return readXlsx(bytes)
  if (bytes.length >= 8 && u32(bytes, 0) === 0xe011cfd0 && u32(bytes, 4) === 0xe11ab1a1) {
    throw new Error('This is an old-style .xls file. In Excel choose File → Save As → Excel Workbook (.xlsx), then upload that.')
  }
  if (/\.(numbers|ods|pdf|docx?)$/i.test(fileName)) {
    throw new Error('Upload the sheet as .xlsx or .csv.')
  }
  const name = String(fileName || 'Sheet1').replace(/\.[^.]+$/, '') || 'Sheet1'
  return [{ name, rows: readCsv(dec.decode(bytes)) }]
}
