// The two identifiers, and only two: the Order ID and the Product ID.
//
// This file pins the identity system end to end:
//
//   * there is no "Product Code" anywhere — no label, no field, no helper
//     text, no helper function, in the admin panel, the storefront, the
//     order details, the emails, the spreadsheet or the documentation;
//   * the Product ID is the six characters CCPPCL — the category's number,
//     the product's number and the colour's two letters;
//   * every colour of a design is a product of its own and carries its own
//     Product ID;
//   * a web address is a link, and is never shown where the Product ID
//     belongs.
//
// Run with `npm test`.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { productId, orderLineProductId, isProductId, productIdParts } from '../src/lib/productIdentity.js'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

/** Every source file the shop is built from. */
const sourceFiles = (dir = 'src') => {
  const out = []
  const walk = (d) => {
    for (const entry of fs.readdirSync(path.join(process.cwd(), d), { withFileTypes: true })) {
      const rel = path.join(d, entry.name)
      if (entry.isDirectory()) walk(rel)
      else if (/\.(jsx?|tsx?|mjs)$/.test(entry.name)) out.push(rel)
    }
  }
  walk(dir)
  return out
}

// ---------------------------------------------------------------------------
// 1. There is no Product Code
// ---------------------------------------------------------------------------

test('no source file anywhere mentions a Product Code', () => {
  const offenders = []
  for (const file of [...sourceFiles('src'), ...sourceFiles('supabase/functions')]) {
    const text = read(file)
    if (/product[ _-]?code/i.test(text)) offenders.push(file)
  }
  assert.deepEqual(offenders, [], 'nothing calls the Product ID a "Product Code"')
})

test('no source file anywhere has a product_code field or a productCode helper', () => {
  const offenders = []
  for (const file of [...sourceFiles('src'), ...sourceFiles('supabase/functions'), ...sourceFiles('scripts')]) {
    const text = read(file)
    if (/product_code|productCode/.test(text)) offenders.push(file)
  }
  assert.deepEqual(offenders, [], 'there is no product_code column and no productCode helper')
})

test('the admin product editor has no "Product code" field', () => {
  const editor = read('src/admin/ProductEditor.jsx')
  assert.doesNotMatch(editor, /Product code/i, 'the field is gone')
  // What is left is the Product ID, shown and never typed, and the web
  // address, which is a link and is labelled as one.
  assert.match(editor, />Product ID</, 'the Product ID is shown')
  assert.match(editor, />Web address</, 'and the link is labelled for what it is')
  assert.doesNotMatch(editor, />Product ID<\/span>\s*<input/, 'the Product ID is never an input')
})

test('the Product ID is shown wherever a product is', () => {
  // The admin list, the admin editor, the storefront product page, the admin
  // order details, the order confirmation page, the Excel download, the
  // Google Sheet and both emails.
  assert.match(read('src/admin/ProductList.jsx'), /productId\(/, 'the admin product list')
  assert.match(read('src/admin/ProductEditor.jsx'), /Product ID/, 'the admin product editor')
  assert.match(read('src/pages/Product.jsx'), /Product ID/, 'the storefront product page')
  assert.match(read('src/admin/OrdersPanel.jsx'), /Product ID/, 'the admin order details')
  assert.match(read('src/pages/OrderConfirmation.jsx'), /Product ID/, 'the customer’s order page')
  assert.match(read('src/admin/orderExport.js'), /'Product ID'/, 'the Excel download')
  assert.match(read('supabase/functions/_shared/sheetRows.mjs'), /'Product ID'/, 'the Google Sheet')
  assert.match(read('supabase/functions/_shared/orderEmail.mjs'), /Product ID/, 'the customer’s email')
  assert.match(read('supabase/functions/_shared/ownerNotification.ts'), /sku/, 'the owner’s notification')
})

// ---------------------------------------------------------------------------
// 2. The Product ID is CCPPCL
// ---------------------------------------------------------------------------

test('the Product ID is six characters: two numbers, two numbers, two letters', () => {
  assert.equal(productId({ sku: '0101BU' }), '0101BU')
  assert.equal(isProductId('0101BU'), true)
  assert.equal(isProductId('0101bu'), false, 'the letters are upper case')
  assert.equal(isProductId('0101B'), false, 'and there are two of them')
  assert.equal(isProductId('0101BU1'), false, 'and six of them altogether')
  assert.equal(isProductId(''), false)
  assert.equal(isProductId(null), false)

  const parts = productIdParts('0205RE')
  assert.deepEqual(parts, { category: '02', product: '05', colour: 'RE', valid: true })
  assert.equal(productIdParts('nope').valid, false)
})

test('a product with no Product ID has none — a web address is not one', () => {
  assert.equal(productId({ id: 'solid-shirts-blue' }), '')
  assert.equal(productId(null), '')
  assert.equal(orderLineProductId({ id: 'x', sku: null }), '')
  assert.equal(orderLineProductId({ sku: ' 0101BU ' }), '0101BU')
})

test('the Product ID is read from the SKU and from nothing else', () => {
  const identity = read('src/lib/productIdentity.js')
  assert.match(identity, /p\?\.sku/, 'the Product ID of a product is its sku')
  assert.doesNotMatch(identity, /p\?\.id/, 'and never its web address')
})

test('the admin list shows the Product ID and never a web address in its place', () => {
  const list = read('src/admin/ProductList.jsx')
  assert.doesNotMatch(list, /sku \|\| /, 'no fallback to another identifier')
  assert.match(list, /import \{ productId \} from '\.\.\/lib\/productIdentity'/, 'through the one helper that knows the rule')
})

test('every colour of a design is a product with a Product ID of its own', () => {
  const list = read('src/admin/ProductList.jsx')
  // The group card lists the colourways; each one shows the Product ID it
  // carries, rather than the design showing one ID for all of them.
  assert.match(list, /productId\(r\) \? <span[^>]*>\{productId\(r\)\}<\/span>/,
    'each colourway carries its own Product ID')
  assert.doesNotMatch(list, /lead\.sku/, 'and the design does not show one ID for all of them')
})

// ---------------------------------------------------------------------------
// 3. The rule that decides the colour letters
// ---------------------------------------------------------------------------

test('the colour letters are the first free pair of the colour’s own letters', () => {
  // The rule lives in the database (public.sku_colour_code): a colour already
  // on file keeps its letters, and a new one takes the first pair of its
  // letters that nobody holds — Blue would take BL, then BU.
  const sql = read('supabase/migrations/20261020120000_product_skus.sql')
  assert.match(sql, /select c\.code into cand from public\.colour_codes c where c\.colour = key/,
    'first: what we already know')
  assert.match(sql, /insert into public\.colour_codes \(colour, label, code\)/,
    'then: the new answer is written down at once')
  assert.match(sql, /on conflict \(colour\) do nothing/, 'and re-running never rewrites it')
  assert.match(sql, /'blue',\s*'Blue',\s*'BU'/, 'Blue keeps BU')
  assert.match(sql, /'black',\s*'Black',\s*'BL'/, 'and Black keeps the letters Blue would otherwise have taken')
  assert.match(sql, /return 'XX'/, 'a missing colour is a documented placeholder')
})

test('the rule is written down where the next maintainer will read it', () => {
  const readme = read('README.md')
  // The README is markdown, so its emphasis marks are stripped before it is
  // matched — the words matter, not the punctuation around them.
  const plain = readme.replace(/[*`]/g, '')
  assert.match(plain, /When two colours want the same letters/,
    'the collision rule is documented')
  assert.match(plain, /first pair of its own letters that nobody\s+holds/,
    'and the rule itself is stated')
  assert.match(plain, /keeps BL and "Blue"\s*keeps BU/,
    'with the answer that has already been given')
  assert.doesNotMatch(readme, /Product Code/i, 'and no Product Code anywhere')
})

// ---------------------------------------------------------------------------
// 4. The Order ID stays its own thing
// ---------------------------------------------------------------------------

test('the Order ID is still DDMMYYNN and is a different thing entirely', () => {
  const readme = read('README.md').replace(/[*`]/g, '')
  assert.match(readme, /## Order IDs/, 'the Order IDs have their own section')
  assert.match(readme, /DDMMYYNN/, 'in the format they always had')
  assert.match(readme, /exactly two identifiers/, 'and the shop says it has two, not three')
  // The two systems never share a column, a function or a table.
  const orders = read('supabase/migrations/20260928181500_orders_and_checkout.sql')
  assert.match(orders, /reference\s+text not null unique/, 'the Order ID lives on the order')
  const identity = read('src/lib/productIdentity.js')
  assert.doesNotMatch(identity, /reference/, 'and the Product ID knows nothing of it')
})
