// A dependency-free writer for real .xlsx (Office Open XML) workbooks.
//
// An .xlsx file is a ZIP of XML parts. This module writes exactly the minimal
// parts Excel needs — content types, relationships, workbook, one worksheet
// and a stylesheet — with STORE (uncompressed) ZIP entries and inline
// strings, so it stays small, deterministic and testable without adding any
// package to the project. Excel and LibreOffice both open store-only ZIP
// archives happily.
//
// Supported: one or more sheets, a header row, string and number cells, a
// bold or frozen header, wrapped text and column widths. Nothing here touches the network or the DOM
// except the download helper's caller.

const enc = new TextEncoder()

// ---- CRC-32 (the ZIP checksum) --------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ---- minimal ZIP (store only) ---------------------------------------------

const concat = (chunks) => {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** entries: [{ name, bytes }] -> a ZIP archive (method 0, no compression). */
function zip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, bytes } of entries) {
    const nameBytes = enc.encode(name)
    const crc = crc32(bytes)

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // local file header signature
    lv.setUint16(4, 20, true) //        version needed
    lv.setUint16(6, 0x0800, true) //    flags: file names are UTF-8
    lv.setUint16(8, 0, true) //         method: store
    lv.setUint16(10, 0, true) //        mod time
    lv.setUint16(12, 0x21, true) //     mod date (1980-01-01)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, bytes.length, true)
    lv.setUint32(22, bytes.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true) //        extra field length
    local.set(nameBytes, 30)

    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true) // central directory signature
    cv.setUint16(4, 20, true) //        version made by
    cv.setUint16(6, 20, true) //        version needed
    cv.setUint16(8, 0x0800, true) //    flags: UTF-8 names
    cv.setUint16(10, 0, true) //        method: store
    cv.setUint16(12, 0, true) //        mod time
    cv.setUint16(14, 0x21, true) //     mod date
    cv.setUint32(16, crc, true)
    cv.setUint32(20, bytes.length, true)
    cv.setUint32(24, bytes.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true) //   local header offset
    central.set(nameBytes, 46)

    locals.push(local, bytes)
    centrals.push(central)
    offset += local.length + bytes.length
  }

  const centralBytes = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true) //  end of central directory signature
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralBytes, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true) //          comment length

  return concat([...locals, ...centrals, end])
}

// ---- XML helpers -----------------------------------------------------------

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

/** Escape text for an XML node, dropping control characters XML cannot carry. */
export const xmlText = (value) =>
  String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch])

export const colName = (n) => {
  let s = ''
  let x = n
  while (x >= 0) {
    s = String.fromCharCode(65 + (x % 26)) + s
    x = Math.floor(x / 26) - 1
  }
  return s
}

// ---- workbook parts --------------------------------------------------------

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'

const contentTypes = (count) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${
  Array.from({ length: count }, (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`

// Sheets are rId1…rIdN; the stylesheet comes after them.
const workbookRels = (count) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL_NS}">${
  Array.from({ length: count }, (_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
}<Relationship Id="rId${count + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`

// Three cell styles: 0 plain, 1 bold (a header row), 2 text that wraps and
// sits at the top of its cell (long instructions).
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

const workbookXml = (names) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><sheets>${
  names.map((name, i) => `<sheet name="${xmlText(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
}</sheets></workbook>`

/** One worksheet: every cell as it arrives — numbers as numbers, everything
 *  else as an inline string, so no shared-strings table can drift.
 *
 *  Options, all off by default: `boldHeader` (row 1 in bold), `freezeHeader`
 *  (row 1 stays in view while scrolling), `wrap` (every cell below the header
 *  wraps its text) and `widths` (column widths, in characters). */
const sheetXml = (rows, { boldHeader = false, freezeHeader = false, wrap = false, widths = [] } = {}) => {
  const body = rows
    .map((cells, r) => {
      const style = r === 0 && boldHeader ? ' s="1"' : r > 0 && wrap ? ' s="2"' : ''
      const cs = cells
        .map((value, c) => {
          const ref = `${colName(c)}${r + 1}`
          if (typeof value === 'number' && Number.isFinite(value)) {
            return `<c r="${ref}"${style}><v>${value}</v></c>`
          }
          if (value === null || value === undefined || value === '') return ''
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`
        })
        .join('')
      return `<row r="${r + 1}">${cs}</row>`
    })
    .join('')
  const views = freezeHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : ''
  const cols = widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Number(w) || 10}" customWidth="1"/>`).join('')}</cols>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}">${views}${cols}<sheetData>${body}</sheetData></worksheet>`
}

/**
 * Build an .xlsx workbook of one or more sheets.
 *
 * `sheets` is [{ name, columns, rows, boldHeader, freezeHeader, wrap, widths }]:
 * `columns` are the header cells, `rows` arrays of values (string or number)
 * aligned with them. Returns the raw bytes of the file.
 */
export function buildWorkbook({ sheets = [] } = {}) {
  const list = sheets.length ? sheets : [{ name: 'Sheet1', columns: [], rows: [] }]
  const parts = [
    { name: '[Content_Types].xml', text: contentTypes(list.length) },
    { name: '_rels/.rels', text: rootRels },
    { name: 'xl/workbook.xml', text: workbookXml(list.map((s, i) => s.name || `Sheet${i + 1}`)) },
    { name: 'xl/_rels/workbook.xml.rels', text: workbookRels(list.length) },
    { name: 'xl/styles.xml', text: stylesXml },
    ...list.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      text: sheetXml([[...(s.columns || [])], ...(s.rows || [])], s),
    })),
  ]
  return zip(parts.map(({ name, text }) => ({ name, bytes: enc.encode(text) })))
}

/**
 * Build a one-sheet .xlsx workbook.
 *
 * `columns` are the header cells; `rows` are arrays of values (string or
 * number) aligned with `columns`. Returns the raw bytes of the file.
 */
export function buildXlsx({ sheetName = 'Sheet1', columns = [], rows = [] } = {}) {
  return buildWorkbook({ sheets: [{ name: sheetName, columns, rows }] })
}
