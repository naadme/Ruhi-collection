// Reviews uploaded from a sheet: the owner collects reviews customers sent on
// WhatsApp, Instagram, by phone or in the shop, and uploads them from
// Admin → Reviews. Every one lands pending and unverified, the customer's
// mobile stays private, and a review with no name is shown under a label that
// never claims a purchase the owner has not checked.
//
// The database (supabase/migrations/20261108120000_review_sheet_import.sql)
// holds the rules; src/lib/reviewSheet.js checks each row first, in words the
// owner can act on; src/lib/xlsxRead.js reads the file. These tests fail the
// suite if any of that drifts.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readCsv, readSpreadsheet, readXlsx, xmlUnescape } from '../src/lib/xlsxRead.js'
import {
  MAX_ROWS, SHEET_COLUMNS, checkSheet, findProduct, headerKey, importable, indexCatalogue, indiaToday,
  mapHeaders, normaliseSize, parseChannel, parsePhone, parseSheetDate, parseStars, pickSheet, reviewTemplateWorkbook,
} from '../src/lib/reviewSheet.js'
import { CHANNELS, REVIEW_LIMITS, reviewerLabel, sourceCopy } from '../src/lib/reviews.js'
import { buildWorkbook } from '../src/lib/xlsx.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const bytes = (rel) => new Uint8Array(fs.readFileSync(path.join(root, rel)))
const SQL = read('supabase/migrations/20261108120000_review_sheet_import.sql')
const FN = SQL.slice(SQL.indexOf('create or replace function public.import_reviews'), SQL.indexOf('commit;'))

const PRODUCTS = [
  { id: 'denim-shirt-black', sku: '0101BL', title: 'Denim Shirt - Black', colour: 'Black', sizes: ['S', 'M', 'L', 'XL'], design_id: '01-DS-01', is_active: true },
  { id: 'denim-shirt-blue', sku: '0102BU', title: 'Denim Shirt - Blue', colour: 'Blue', sizes: ['S', 'M', 'L', 'XL'], design_id: '01-DS-01', is_active: true },
  { id: 'panda-tshirt-white', sku: '0104WH', title: 'Panda Tshirt - White', colour: 'White', sizes: ['M', 'L', 'XL'], design_id: '01-PT-01', is_active: true },
  { id: 'korean-pants-maroon', sku: '0301MA', title: 'Korean Pants - Maroon', colour: 'Maroon', sizes: ['M'], design_id: '03-KP-01', is_active: false },
]

const HEAD = SHEET_COLUMNS.map((c) => c.header)
const at = Object.fromEntries(SHEET_COLUMNS.map((c, i) => [c.key, i]))
const row = (fields) => {
  const out = HEAD.map(() => '')
  for (const [k, v] of Object.entries(fields)) out[at[k]] = v
  return out
}

/* ---------------------------------------------------------------------------
 * 1. The migration
 * ------------------------------------------------------------------------- */

test('the migration is one transaction and opens no new write path', () => {
  assert.match(SQL, /^begin;$/m)
  assert.match(SQL, /^commit;$/m)
  assert.doesNotMatch(SQL, /create policy[^;]*for (insert|all)/i, 'no insert policy for anyone')
  assert.doesNotMatch(SQL, /grant[^;]*\binsert\b[^;]*to (anon|authenticated)/i, 'no insert grant for a browser role')
  assert.doesNotMatch(SQL, /grant[^;]*on table public\.product_review_contacts[^;]*to anon/i, 'contacts stay admin-only')
})

test('only the three new display columns are added to the public read', () => {
  const grants = [...SQL.matchAll(/grant\s+select \(([^)]*)\)\s+on table public\.product_reviews to anon;/g)]
  assert.equal(grants.length, 1)
  assert.deepEqual(grants[0][1].split(',').map((c) => c.trim()), ['reviewer_city', 'reviewer_state', 'size_bought'])
})

test('an uploaded review is a third source and needs no order line', () => {
  assert.match(SQL, /check \(source in \('account', 'public', 'imported'\)\)/)
  assert.match(SQL, /check \(source in \('public', 'imported'\) or \(order_item_id is not null and user_id is not null\)\)/)
  assert.equal(sourceCopy('imported'), 'Uploaded from a sheet')
})

test('only an uploaded review may be nameless; a given name keeps the old limits', () => {
  assert.match(SQL, /alter column customer_name drop not null/)
  assert.match(SQL, /check \(customer_name is not null or source = 'imported'\)/)
  assert.match(SQL, /customer_name is null\s+or \(char_length\(btrim\(customer_name\)\) >= 2 and char_length\(btrim\(customer_name\)\) <= 60\)/)
})

test('import_reviews() is admin-only, all-or-nothing, and lands every row pending and unverified', () => {
  assert.match(FN, /security definer/)
  assert.match(FN, /set search_path = public, pg_temp/)
  assert.match(FN, /if not public\.is_admin\(\) then\s+raise exception/)
  assert.match(SQL, /revoke all on function public\.import_reviews\(jsonb\) from public, anon;/)
  assert.match(SQL, /grant\s+execute on function public\.import_reviews\(jsonb\) to authenticated, service_role;/)
  assert.doesNotMatch(FN, /exception when others then\s+(continue|null;)/i, 'a bad row is never skipped silently')
  assert.match(FN, /'pending', 'imported', false, v_when\)/)
  assert.match(FN, /\(v_product, null, null, v_rating/, 'no order line, no account')
  assert.doesNotMatch(FN, /verified\s*:?=\s*true|'approved'/, 'it can neither verify nor publish')
})

test('the database and the sheet check agree on every limit', () => {
  assert.match(FN, new RegExp(`jsonb_array_length\\(p_rows\\) > ${MAX_ROWS}`))
  assert.match(FN, new RegExp(`char_length\\(v_body\\) < ${REVIEW_LIMITS.MIN_BODY}`))
  assert.match(FN, new RegExp(`char_length\\(v_body\\) > ${REVIEW_LIMITS.MAX_BODY}`))
  assert.match(FN, new RegExp(`char_length\\(v_title\\) > ${REVIEW_LIMITS.MAX_TITLE}`))
  const listed = CHANNELS.map(([v]) => `'${v}'`).join(', ')
  assert.ok(SQL.includes(`channel in (${listed})`), 'the table constraint lists the same channels')
  assert.ok(FN.includes(`v_channel not in (${listed})`), 'and so does the function')
})

test('the mobile, order number, channel and note go only to the private table', () => {
  const reviewInsert = FN.slice(FN.indexOf('insert into public.product_reviews'), FN.indexOf('returning id into v_id'))
  for (const secret of ['v_phone', 'v_ref', 'v_channel', 'v_note']) {
    assert.ok(!reviewInsert.includes(secret), `${secret} is not written to the review`)
  }
  assert.match(FN, /insert into public\.product_review_contacts\s+\(review_id, email, phone, order_ref, channel, note, import_batch\)/)
})

/* ---------------------------------------------------------------------------
 * 2. The name a review is shown under
 * ------------------------------------------------------------------------- */

test('a review with no name never says "Verified" until the owner has verified it', () => {
  assert.deepEqual(reviewerLabel({ customer_name: 'Priya S.', reviewer_city: 'Hyderabad', reviewer_state: 'Telangana' }),
    { name: 'Priya S.', place: 'Hyderabad, Telangana', named: true })
  assert.deepEqual(reviewerLabel({ customer_name: null, reviewer_city: 'Hyderabad', reviewer_state: 'Telangana', verified: true }),
    { name: 'Verified Buyer', place: 'Hyderabad, Telangana', named: false })
  assert.deepEqual(reviewerLabel({ customer_name: '', reviewer_city: 'Hyderabad', reviewer_state: 'Telangana', verified: false }),
    { name: 'Shopper from Hyderabad', place: 'Telangana', named: false }, 'the city is not repeated')
  assert.deepEqual(reviewerLabel({ customer_name: '  ', reviewer_state: 'Kerala' }),
    { name: 'Ruhi Shopper', place: 'Kerala', named: false })
  assert.equal(reviewerLabel({}).name, 'Ruhi Shopper')
})

test('the product page and the admin panel show the label, never a raw empty name', () => {
  const page = read('src/components/ReviewsSection.jsx')
  assert.match(page, /reviewerLabel\(r\)/)
  assert.doesNotMatch(page, /\{r\.customer_name\}/)
  assert.match(page, /r\.size_bought/)
  assert.match(page, /r\.title &&/)
  const panel = read('src/admin/ReviewsPanel.jsx')
  assert.doesNotMatch(panel, /\{r\.customer_name\}|\$\{review\.customer_name\}/)
  assert.match(panel, /Upload from sheet/)
})

/* ---------------------------------------------------------------------------
 * 3. Reading a cell
 * ------------------------------------------------------------------------- */

test('stars: a whole number from 1 to 5, however it was written', () => {
  for (const [v, want] of [['5', 5], [4, 4], ['4 stars', 4], ['5/5', 5], ['3.0', 3], ['★★★', 3], ['⭐⭐⭐⭐⭐', 5], ['1 star', 1]]) {
    assert.equal(parseStars(v), want, String(v))
  }
  for (const v of ['', '0', '6', '4.5', 'good', '★★★★★★']) assert.equal(parseStars(v), null, String(v))
})

test('dates: Excel day numbers, day-first Indian dates, ISO and month names', () => {
  assert.equal(parseSheetDate(''), '')
  assert.equal(parseSheetDate('46329'), '2026-11-03', 'an Excel day number')
  assert.equal(parseSheetDate('03/11/2026'), '2026-11-03', 'day first')
  assert.equal(parseSheetDate('3-11-26'), '2026-11-03')
  assert.equal(parseSheetDate('3.11.2026'), '2026-11-03')
  assert.equal(parseSheetDate('11/23/2026'), '2026-11-23', 'cannot be day-first, so month-first')
  assert.equal(parseSheetDate('2026-11-03'), '2026-11-03')
  assert.equal(parseSheetDate('2026-11-03T00:00:00'), '2026-11-03')
  assert.equal(parseSheetDate('3 Nov 2026'), '2026-11-03')
  assert.equal(parseSheetDate('3rd November 2026'), '2026-11-03')
  assert.equal(parseSheetDate('3-Nov-26'), '2026-11-03')
  assert.equal(parseSheetDate('Nov 3, 2026'), '2026-11-03')
  for (const v of ['31/02/2026', 'yesterday', '99', '13/13/2026']) assert.equal(parseSheetDate(v), null, v)
})

test('mobiles: Indian numbers to 10 digits, Excel number formats, and "NA" as empty', () => {
  assert.deepEqual(parsePhone('+91 98765 43210'), { digits: '9876543210', problem: '' })
  assert.deepEqual(parsePhone('919876543210'), { digits: '9876543210', problem: '' })
  assert.deepEqual(parsePhone('09876543210'), { digits: '9876543210', problem: '' })
  assert.deepEqual(parsePhone('9.87654321E+9'), { digits: '9876543210', problem: '' })
  assert.deepEqual(parsePhone('+44 7700 900123'), { digits: '447700900123', problem: '' }, 'a number abroad is kept')
  assert.deepEqual(parsePhone('NA'), { digits: '', problem: '' })
  assert.deepEqual(parsePhone(''), { digits: '', problem: '' })
  assert.ok(parsePhone('12345').problem)
  assert.ok(parsePhone('1234567890').problem, 'ten digits must be an Indian mobile')
})

test('received via: loose words to the known channels', () => {
  assert.deepEqual(parseChannel('WhatsApp msg'), { channel: 'whatsapp', unknown: false })
  assert.deepEqual(parseChannel('Insta DM'), { channel: 'instagram', unknown: false })
  assert.deepEqual(parseChannel('Phone call'), { channel: 'phone', unknown: false })
  assert.deepEqual(parseChannel('in store'), { channel: 'in_store', unknown: false })
  assert.deepEqual(parseChannel('offline'), { channel: 'in_store', unknown: false })
  assert.deepEqual(parseChannel('Email'), { channel: 'email', unknown: false })
  assert.deepEqual(parseChannel(''), { channel: '', unknown: false })
  assert.deepEqual(parseChannel('carrier pigeon'), { channel: 'other', unknown: true })
})

test('sizes written as words become the shop’s letters', () => {
  assert.equal(normaliseSize('medium'), 'M')
  assert.equal(normaliseSize(' Extra Large '), 'XL')
  assert.equal(normaliseSize('2XL'), 'XXL')
  assert.equal(normaliseSize('32'), '32')
})

/* ---------------------------------------------------------------------------
 * 4. Headings and products
 * ------------------------------------------------------------------------- */

test('the template’s own headings map to every column, with nothing ignored', () => {
  const { columns, ignored, missing } = mapHeaders(HEAD)
  assert.deepEqual(Object.keys(columns).sort(), SHEET_COLUMNS.map((c) => c.key).sort())
  assert.deepEqual(ignored, [])
  assert.deepEqual(missing, [])
})

test('her own headings work too; extra columns are ignored and listed', () => {
  const { columns, ignored, missing } = mapHeaders(['Customer Name', 'Phone', 'Product URL', 'Rating', 'Review', 'Location', 'Date', 'Called by'])
  assert.deepEqual(missing, [])
  assert.equal(columns.name, 0)
  assert.equal(columns.phone, 1)
  assert.equal(columns.product, 2)
  assert.equal(columns.location, 5)
  assert.deepEqual(ignored, ['Called by'])
  assert.equal(headerKey('Stars (1–5) *'), 'stars')
  assert.deepEqual(mapHeaders(['Name', 'Review']).missing, ['Product link or ID', 'Stars'])
})

test('a product is found by its link, its Product ID or its full title', () => {
  const cat = indexCatalogue(PRODUCTS)
  assert.equal(findProduct(cat, 'https://www.ruhi-collections.com/product/denim-shirt-blue?size=M')?.id, 'denim-shirt-blue')
  assert.equal(findProduct(cat, 'http://localhost:5173/product/denim-shirt-blue/')?.id, 'denim-shirt-blue')
  assert.equal(findProduct(cat, 'www.ruhi-collections.com/product/DENIM-SHIRT-BLUE#reviews')?.id, 'denim-shirt-blue')
  assert.equal(findProduct(cat, '0101bl')?.id, 'denim-shirt-black')
  assert.equal(findProduct(cat, 'panda-tshirt-white')?.id, 'panda-tshirt-white')
  assert.equal(findProduct(cat, 'Panda Tshirt - White')?.id, 'panda-tshirt-white')
  assert.equal(findProduct(cat, 'Denim Shirt'), null, 'a design name alone does not say which colour')
  assert.equal(findProduct(cat, ''), null)
})

/* ---------------------------------------------------------------------------
 * 5. Checking a whole sheet
 * ------------------------------------------------------------------------- */

const checkOf = (rows, extra = {}) =>
  checkSheet({ rows: [HEAD, ...rows], products: PRODUCTS, today: '2026-11-08', ...extra })

test('a complete row is ready, and its payload is exactly what the function takes', () => {
  const out = checkOf([row({
    product: '0101BL', rating: '5', body: 'Lovely fabric and a perfect fit.', title: 'Perfect', name: 'Priya S.',
    city: 'Hyderabad', state: 'Telangana', size: 'm', date: '03/11/2026', phone: '+91 98765 43210',
    orderRef: '0311 2601', channel: 'WhatsApp', note: 'sent a photo too',
  })])
  assert.equal(out.ready, 1)
  const [r] = out.rows
  assert.equal(r.state, 'ready')
  assert.deepEqual(r.payload, {
    row: 2, product_id: 'denim-shirt-black', rating: 5, body: 'Lovely fabric and a perfect fit.', title: 'Perfect',
    name: 'Priya S.', city: 'Hyderabad', state: 'Telangana', size: 'M', written_on: '2026-11-03',
    phone: '9876543210', order_ref: '0311 2601', channel: 'whatsapp', note: 'sent a photo too',
  })
  // Every key the function reads, and none it does not.
  for (const key of Object.keys(r.payload)) assert.ok(FN.includes(`'${key}'`), `import_reviews reads ${key}`)
})

test('no name is fine: the row says how it will be shown', () => {
  const out = checkOf([row({ product: '0101BL', rating: '4', body: 'Nice and comfortable.', name: 'NA', city: 'Pune' })])
  const [r] = out.rows
  assert.equal(r.state, 'ready')
  assert.equal(r.payload.name, null)
  assert.ok(r.notes.some((n) => n.includes('Shopper from Pune') && n.includes('Verified Buyer')))
})

test('rows that need a look are still added; rows that cannot be added are left out', () => {
  const out = checkOf([
    row({ product: '0101BL', rating: '5', body: 'Colour column picks the blue one.', colour: 'blue' }),
    row({ product: '0101BL', rating: '5', body: 'A size the shirt does not come in.', size: 'XXL' }),
    row({ product: 'korean-pants-maroon', rating: '3', body: 'Hidden product, still saved.' }),
    row({ product: 'nope', rating: '5', body: 'No such product anywhere.' }),
    row({ product: '0101BL', rating: '', body: 'No stars given here.' }),
    row({ product: '0101BL', rating: '5', body: 'short' }),
    row({ product: '0101BL', rating: '5', body: 'Comes from the future.', date: '10/11/2026' }),
    row({ product: '0101BL', rating: '5', body: 'Bad mobile number.', phone: '12345' }),
    row({ product: '0104WH', rating: '2', body: 'Lovely, but shrank.', channel: 'pigeon' }),
  ])
  const states = out.rows.map((r) => r.state)
  assert.deepEqual(states, ['warn', 'warn', 'warn', 'error', 'error', 'error', 'error', 'error', 'warn'])
  assert.equal(out.rows[0].payload.product_id, 'denim-shirt-blue', 'the colour column switched to the blue row')
  assert.equal(out.rows[8].payload.channel, 'other')
  assert.equal(out.rows[8].payload.rating, 2, 'low ratings go in like any other')
  assert.equal(importable(out).length, 4)
  assert.ok(out.rows.filter((r) => r.state === 'error').every((r) => r.payload === null && r.problems.length))
})

test('the same review twice is caught, in the sheet and against the Reviews list', () => {
  const out = checkOf([
    row({ product: '0101BL', rating: '5', body: 'Great shirt, great fit!' }),
    row({ product: '0102BU', rating: '5', body: 'great shirt great fit' }),
    row({ product: '0104WH', rating: '4', body: 'Already uploaded earlier.' }),
  ], { existing: [{ product_id: 'panda-tshirt-white', body: 'Already uploaded earlier' }] })
  assert.deepEqual(out.rows.map((r) => r.state), ['ready', 'error', 'error'])
  assert.match(out.rows[1].problems.join(' '), /Same review as row 2/, 'another colour of the same design counts')
  assert.match(out.rows[2].problems.join(' '), /already in your Reviews list/)
})

test('a mobile that matches a paid website order is pointed out; test orders are not', () => {
  const orders = [
    { reference: '0311 2601', phone: '+91 98765 43210', is_test: false, paid: true },
    { reference: 'TEST', phone: '9876543211', is_test: true, paid: true },
  ]
  const out = checkOf([
    row({ product: '0101BL', rating: '5', body: 'Matches an order.', phone: '9876543210' }),
    row({ product: '0101BL', rating: '5', body: 'Matches a test order.', phone: '9876543211' }),
  ], { orders, isPaid: (o) => o.paid })
  assert.ok(out.rows[0].notes.some((n) => n.includes('0311 2601')))
  assert.ok(!out.rows[1].notes.some((n) => n.includes('TEST')))
})

test('empty rows are skipped, and a sheet without the three needed columns adds nothing', () => {
  const out = checkOf([HEAD.map(() => ''), row({ product: '0101BL', rating: '5', body: 'Only real row.' })])
  assert.equal(out.rows.length, 1)
  assert.equal(out.rows[0].row, 3, 'row numbers are the sheet’s own')
  const none = checkSheet({ rows: [['Name', 'Review'], ['A', 'Lovely dress indeed']], products: PRODUCTS })
  assert.deepEqual(none.header.missing, ['Product link or ID', 'Stars'])
  assert.equal(none.rows.length, 0)
})

test(`more than ${MAX_ROWS} reviews in one upload is refused`, () => {
  const many = Array.from({ length: MAX_ROWS + 1 }, (_, i) => row({ product: '0101BL', rating: '5', body: `Review number ${i} is fine.` }))
  assert.equal(checkOf(many).tooMany, true)
  assert.equal(checkOf(many.slice(0, MAX_ROWS)).tooMany, false)
})

test('India’s date, for "not in the future"', () => {
  assert.equal(indiaToday(new Date('2026-11-08T19:00:00Z')), '2026-11-09', 'after 18:30 UTC it is tomorrow in India')
  assert.equal(indiaToday(new Date('2026-11-08T18:00:00Z')), '2026-11-08')
})

/* ---------------------------------------------------------------------------
 * 6. Reading files
 * ------------------------------------------------------------------------- */

test('the template opens and reads back: headings, products to copy from, and instructions', async () => {
  const sheets = await readXlsx(reviewTemplateWorkbook(PRODUCTS))
  assert.deepEqual(sheets.map((s) => s.name), ['Reviews', 'Products', 'How to fill'])
  assert.deepEqual(sheets[0].rows[0], HEAD)
  assert.equal(pickSheet(sheets).name, 'Reviews')
  const cat = indexCatalogue(PRODUCTS)
  for (const [sku, link] of sheets[1].rows.slice(1)) {
    assert.equal(findProduct(cat, link)?.sku, sku, `${link} leads back to ${sku}`)
    assert.equal(findProduct(cat, sku)?.sku, sku)
  }
  assert.ok(sheets[2].rows.some((r) => r[0] === 'Customer mobile (private)' && r[2] === 'No, private'))
})

test('a workbook written by openpyxl (inline text, a real date cell, a number mobile) is read and checked', async () => {
  const sheets = await readSpreadsheet(bytes('tests/fixtures/review-sheet-openpyxl.xlsx'), 'notes.xlsx')
  const sheet = pickSheet(sheets)
  assert.equal(sheet.name, 'Call notes')
  const out = checkSheet({ rows: sheet.rows, products: PRODUCTS, today: '2026-11-08' })
  assert.deepEqual(out.header.ignored, ['Called by'])
  assert.equal(out.rows.length, 3, 'the empty row is skipped')
  const [a, b, c] = out.rows
  assert.equal(a.payload.product_id, 'denim-shirt-black')
  assert.equal(a.payload.body, 'Loved the fit & the fabric — बहुत अच्छा 😊')
  assert.equal(a.payload.phone, '9876543210')
  assert.equal(a.payload.written_on, '2026-11-03', 'a date cell arrives as a day number')
  assert.equal(a.payload.city, 'Hyderabad')
  assert.equal(a.payload.state, 'Telangana')
  assert.equal(b.payload.product_id, 'denim-shirt-blue')
  assert.equal(b.payload.rating, 4)
  assert.equal(b.payload.body, 'Soft cotton, true to size.\nWould buy again.', 'rich text keeps its words and line break')
  assert.equal(b.payload.written_on, '2026-11-05')
  assert.equal(b.payload.name, null)
  assert.equal(c.payload.product_id, 'panda-tshirt-white', 'found by its title')
  assert.equal(c.payload.rating, 3)
  assert.equal(c.payload.phone, null)
})

test('an Excel-style workbook (shared strings, rich text, odd cells) is read exactly', async () => {
  const sheets = await readXlsx(bytes('tests/fixtures/review-sheet-shared-strings.xlsx'))
  assert.deepEqual(sheets.map((s) => s.name), ['Notes', 'Reviews'], 'in the workbook’s order, not the files’')
  const reviews = pickSheet(sheets)
  assert.equal(reviews.name, 'Reviews')
  assert.deepEqual(reviews.rows[0], ['Product link or ID', 'Stars', 'Review', 'Reviewer name', 'Extra'])
  assert.deepEqual(reviews.rows[1], [], 'a missing row is an empty row')
  assert.deepEqual(reviews.rows[2], ['denim-shirt-blue', '4', 'Lovely & soft\r\nline two', 'Meera "M" K.', 'TRUE', '', ''])
  assert.deepEqual(reviews.rows[3], ['denim-shirt-blue', '2', ''], 'cells with no reference follow each other')
  const out = checkSheet({ rows: reviews.rows, products: PRODUCTS, today: '2026-11-08' })
  assert.equal(out.rows[0].payload.body, 'Lovely & soft\nline two')
  assert.equal(out.rows[1].state, 'error', 'no review text')
})

test('CSV: quotes, commas, line breaks, a BOM and semicolons', async () => {
  assert.deepEqual(readCsv('﻿a,b,c\r\n1,"x, y","say ""hi""\nthere"\n'), [['a', 'b', 'c'], ['1', 'x, y', 'say "hi"\nthere']])
  assert.deepEqual(readCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']])
  const [sheet] = await readSpreadsheet(new TextEncoder().encode('Product link,Stars,Review\n0101BL,5,"Fits well, soft"\n'), 'r.csv')
  assert.equal(sheet.name, 'r')
  assert.deepEqual(sheet.rows[1], ['0101BL', '5', 'Fits well, soft'])
})

test('old .xls files and damaged files are refused with a way forward', async () => {
  const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])
  await assert.rejects(readSpreadsheet(xls, 'old.xls'), /Save As → Excel Workbook \(\.xlsx\)/)
  await assert.rejects(readXlsx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])), /could not be opened/)
})

test('XML text: entities, character references and Excel’s _x000D_ escapes', () => {
  assert.equal(xmlUnescape('a &amp; b &lt;c&gt; &#233; &#x1F60A; _x000D_'), 'a & b <c> é 😊 \r')
})

test('the writer still makes a one-sheet workbook for the order export, and now several', async () => {
  const two = await readXlsx(buildWorkbook({ sheets: [{ name: 'A', columns: ['x'], rows: [['1']] }, { name: 'B', columns: ['y'], rows: [[2]] }] }))
  assert.deepEqual(two, [{ name: 'A', rows: [['x'], ['1']] }, { name: 'B', rows: [['y'], ['2']] }])
})

/* ---------------------------------------------------------------------------
 * 7. The admin screen
 * ------------------------------------------------------------------------- */

test('the upload screen saves only checked rows, and only through import_reviews()', () => {
  const screen = read('src/admin/ReviewImport.jsx')
  assert.match(screen, /importReviews\(rows\)/)
  assert.match(screen, /const rows = importable\(checked\)/)
  assert.doesNotMatch(screen, /from\('product_reviews'\)|setReviewStatus|setReviewVerified/, 'it cannot publish or verify')
  const store = read('src/lib/reviewStore.js')
  assert.match(store, /supabase\.rpc\('import_reviews', \{ p_rows: list \}\)/)
  // Undo removes only what is not published.
  assert.match(store, /\.delete\(\)\s+\.in\('id', chunk\)\s+\.neq\('status', 'approved'\)/)
})

/* ---------------------------------------------------------------------------
 * 8. Which product: the link wins; a name is the last resort
 * ------------------------------------------------------------------------- */

const SHOP = [
  ...PRODUCTS,
  { id: 'floral-printed-fit-flare-midi-dress-white', sku: '0310WH', title: 'Floral Printed Fit & Flare Midi Dress - White', colour: 'White', sizes: ['S', 'M', 'L'], design_id: '03-FPFF-01', is_active: true },
  { id: 'floral-printed-fit-flare-midi-dress-pink', sku: '0311PI', title: 'Floral Printed Fit & Flare Midi Dress - Pink', colour: 'Pink', sizes: ['S', 'M', 'L'], design_id: '03-FPFF-01', is_active: true },
  // Two designs that share a name, as two "Embroidery coord set"s do on the site.
  { id: 'embroidery-coord-set-blue', sku: '0214BU', title: 'Embroidery coord set - Blue', colour: 'Blue', design_id: '02-ECS-01' },
  { id: 'embroidery-coord-set-orange', sku: '0215OR', title: 'Embroidery coord set - Orange', colour: 'Orange', design_id: '02-ECS-01' },
  { id: 'embroidery-coord-set-blue-2', sku: '0251BU', title: 'Embroidery Coord set - Blue', colour: 'Blue', design_id: '02-ECS-02' },
  { id: 'embroidery-coord-set-pista-green', sku: '0260PS', title: 'Embroidery Coord set - Pista green', colour: 'Pista green', design_id: '02-ECS-02' },
]

test('her sheet: a name column and a link column — the link wins, the name column is not "ignored"', () => {
  const head = ['Review ID', 'Product (style)', 'design_id', 'variant_id', 'Colour bought', 'Rating', 'Review text', 'Product URL']
  const { columns, ignored, products } = mapHeaders(head)
  assert.deepEqual(products.map((p) => [p.header, p.kind]), [
    ['Product URL', 'link'], ['variant_id', 'id'], ['design_id', 'design'], ['Product (style)', 'name'],
  ])
  assert.equal(columns.product, 7)
  assert.deepEqual(ignored, ['Review ID'])
  const out = checkSheet({
    rows: [head, ['R1', 'Floral printed fit & flare midi dress', '03-FPFF-01', '', 'White', '5', 'Fits beautifully, lovely print.',
      'https://www.ruhi-collections.com/product/floral-printed-fit-flare-midi-dress-white']],
    products: SHOP,
    today: '2026-11-08',
  })
  assert.equal(out.rows[0].state, 'ready', out.rows[0].problems.join(' '))
  assert.equal(out.rows[0].payload.product_id, 'floral-printed-fit-flare-midi-dress-white')
})

const byNames = (rows) => checkSheet({ rows: [['Product', 'Colour', 'Stars', 'Review'], ...rows], products: SHOP, today: '2026-11-08' })

test('with only a name: the design’s exact name plus the colour column finds the row', () => {
  const out = byNames([
    ['Floral printed fit & flare midi dress', 'Pink', '5', 'Lovely print, fits well.'],
    ['floral printed fit and flare midi dress white', '', '4', 'Colour named in the product.'],
    ['Floral Printed Fit & Flare Midi Dress - White', '', '4', 'The full title works too.'],
  ])
  assert.deepEqual(out.rows.map((r) => r.payload?.product_id), [
    'floral-printed-fit-flare-midi-dress-pink', 'floral-printed-fit-flare-midi-dress-white', 'floral-printed-fit-flare-midi-dress-white',
  ])
  assert.ok(out.rows.every((r) => r.state === 'ready'))
})

test('a name a customer made up is matched loosely and flagged for a check', () => {
  const out = byNames([['the floral midi dress', 'white', '5', 'Customer’s own words for it.']])
  assert.equal(out.rows[0].state, 'warn')
  assert.equal(out.rows[0].payload.product_id, 'floral-printed-fit-flare-midi-dress-white')
  assert.match(out.rows[0].warnings.join(' '), /by its name\. Check it is the right product/)
})

test('a design in several colours with no colour given asks for the colour', () => {
  const out = byNames([['Floral printed fit & flare midi dress', '', '5', 'Which colour was it though?']])
  assert.equal(out.rows[0].state, 'error')
  assert.match(out.rows[0].problems[0], /comes in White, Pink\. Add the colour bought, or the product link/)
})

test('two designs with one name: the colour tells them apart, or the row says which IDs to pick from', () => {
  const out = byNames([
    ['Embroidery coord set', 'Pista green', '5', 'Only one design has this colour.'],
    ['Embroidery coord set', 'Orange', '5', 'Only the other design has this one.'],
    ['Embroidery coord set', 'Blue', '5', 'Both designs come in blue.'],
  ])
  assert.equal(out.rows[0].payload.product_id, 'embroidery-coord-set-pista-green')
  assert.equal(out.rows[1].payload.product_id, 'embroidery-coord-set-orange')
  assert.equal(out.rows[2].state, 'error')
  assert.match(out.rows[2].problems[0], /Blue is more than one product on the site \(Product IDs 0214BU, 0251BU\)/)
})

test('a link that matches nothing falls back to the name, with a warning; nothing at all says what was tried', () => {
  const head = ['Product URL', 'Product name', 'Stars', 'Review']
  const out = checkSheet({
    rows: [head,
      ['https://www.ruhi-collections.com/product/old-deleted-dress', 'Panda Tshirt - White', '5', 'Link is out of date.'],
      ['https://www.ruhi-collections.com/product/old-deleted-dress', 'mystery outfit', '5', 'Nothing matches here.'],
      ['', '', '5', 'No product given at all.']],
    products: SHOP,
    today: '2026-11-08',
  })
  assert.equal(out.rows[0].state, 'warn')
  assert.equal(out.rows[0].payload.product_id, 'panda-tshirt-white')
  assert.match(out.rows[0].warnings[0], /The Product URL “https:\/\/www\.ruhi-collections\.com\/product\/old-deleted-dress” matches no product, so the Product name column was used/)
  assert.match(out.rows[1].problems[0], /No product matches the Product URL “.*” or the Product name “mystery outfit”/)
  assert.match(out.rows[2].problems[0], /No product link, Product ID or product name/)
})

test('a link pasted with words around it still counts', () => {
  const cat = indexCatalogue(SHOP)
  assert.equal(findProduct(cat, 'she bought https://www.ruhi-collections.com/product/denim-shirt-blue?size=M in blue')?.id, 'denim-shirt-blue')
})

test('a loose name picks the product that has all of her words, and never guesses between near-equals', () => {
  const shop = [...SHOP, { id: 'floral-maxi-dress-red', sku: '0312RE', title: 'Floral Maxi dress - Red', colour: 'Red', design_id: '03-FMD-01' }]
  const out = checkSheet({
    rows: [['Product', 'Colour', 'Stars', 'Review'],
      ['the floral midi dress', 'White', '5', 'Midi is in only one name.'],
      ['floral dress', 'White', '5', 'Fits both floral dresses.'],
      ['dress', '', '5', 'Fits every dress.']],
    products: shop,
    today: '2026-11-08',
  })
  assert.equal(out.rows[0].state, 'warn')
  assert.equal(out.rows[0].payload.product_id, 'floral-printed-fit-flare-midi-dress-white')
  assert.equal(out.rows[1].state, 'error')
  assert.match(out.rows[1].problems[0], /Closest: /)
  assert.equal(out.rows[2].state, 'error')
})
