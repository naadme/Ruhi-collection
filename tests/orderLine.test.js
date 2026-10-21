// The facts shown for an ordered line: its colour, its size, its quantity and
// its Product ID — and the promise that the customer's side of the shop and
// the server's side (the emails and the spreadsheet) say the same thing.
//
// src/lib/orderLine.js is a mirror of supabase/functions/_shared/
// orderItems.mjs: one of them writes the email and the row in the sheet, the
// other writes the confirmation page and the customer's account. If the two
// ever disagree, a customer reads "Blue" on screen and "Navy" in her mail —
// so the last test here runs the SAME titles through BOTH and requires the
// same answer from each.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { orderLineColour, orderLineDetail, orderLineName, orderLineSku } from '../src/lib/orderLine.js'
// The server module is plain ES with no imports, so it loads in Node as it
// loads in the function — no Deno shim, no copying of its logic into here.
import { orderItemColour, orderItemSku } from '../supabase/functions/_shared/orderItems.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

/** Every title the two sides are asked about. Deliberately awkward. */
const TITLES = [
  'Solid Shirt and Denim pant Combo - Black',
  'Cotton Dress',
  'Mulmul Cotton Trousers - White',
  'Kurta Set - Light Blue',
  'Shirt - 2024',          // a year, not a colour
  'Shirt - Extra-Large',   // a size, not a colour
  'Shirt - ',              // nothing at all after the dash
  '  ',
  '',
  null,
  undefined,
  'A Very Long Suffix That Goes On And On And Is Not A Colour At All',
  'Kurta - Off White',
  'Dupatta - Red and Gold',
]

test('the colour is read back out of the title the order snapshotted', () => {
  assert.equal(orderLineColour('Solid Shirt and Denim pant Combo - Black'), 'Black')
  assert.equal(orderLineColour('Kurta Set - Light Blue'), 'Light Blue')
  assert.equal(orderLineColour('Cotton Dress'), '', 'no colour was recorded, so none is guessed')
  assert.equal(orderLineColour('Shirt - 2024'), '', 'a year is not a colour')
  assert.equal(orderLineColour('Shirt - Extra-Large'), '', 'a size is not a colour')
  assert.equal(orderLineColour('Shirt - '), '', 'nothing follows the dash')
  assert.equal(orderLineColour('A Very Long Suffix That Goes On And On And Is Not A Colour At All'), '',
    'a suffix this long is part of the name')
  assert.equal(orderLineColour('Dupatta - Red and Gold'), 'Red and Gold')
  assert.equal(orderLineColour(null), '', 'a line with no title never throws')
  assert.equal(orderLineColour(undefined), '')
})

test('the design keeps its name when the colour comes off', () => {
  assert.equal(orderLineName('Solid Shirt and Denim pant Combo - Black'), 'Solid Shirt and Denim pant Combo')
  assert.equal(orderLineName('Cotton Dress'), 'Cotton Dress', 'nothing is stripped when there is no colour')
  assert.equal(orderLineName('Shirt - 2024'), 'Shirt - 2024', 'and nothing is stripped when the suffix is not a colour')
  assert.equal(orderLineName(null), '')
})

test('the Product ID is the line’s own snapshot, and is never invented', () => {
  assert.equal(orderLineSku({ sku: '0101BL' }), '0101BL')
  assert.equal(orderLineSku({ sku: '  0101BL  ' }), '0101BL', 'trimmed, but otherwise untouched')
  // A line placed before the column existed has none: the page must show the
  // line's own facts and stop there, rather than borrow another product's ID.
  assert.equal(orderLineSku({}), '')
  assert.equal(orderLineSku(null), '')
  assert.equal(orderLineSku({ product_id: 'some-product' }), '', 'a product id is not a Product ID')
})

test('the detail line shows what was ordered, and only what was ordered', () => {
  assert.equal(
    orderLineDetail({ title: 'Mulmul Cotton Trousers - White', size: 'M', qty: 2, sku: '0101WH' }),
    'White · Size M · ×2 · 0101WH',
  )
  assert.equal(
    orderLineDetail({ title: 'Cotton Dress', sku: '0202DR' }),
    '0202DR',
    'no colour and no size recorded → just the Product ID',
  )
  assert.equal(
    orderLineDetail({ title: 'Cotton Dress' }),
    '',
    'nothing known about a line → nothing shown (never "Size  · ×")',
  )
  assert.equal(orderLineDetail(null), '', 'never a throw on a missing row')
  // A quantity of 0 is not a quantity; a size of '' is not a size.
  assert.equal(orderLineDetail({ title: 'Cotton Dress', size: '', qty: 0, sku: '' }), '')
})

test('the client and the server give every title the same answer', () => {
  for (const title of TITLES) {
    assert.equal(
      orderLineColour(title),
      orderItemColour(title),
      `colour of ${JSON.stringify(title)} differs between the page and the email`,
    )
    const item = { title, sku: '  0101BL  ' }
    assert.equal(
      orderLineSku(item),
      orderItemSku(item),
      `Product ID of ${JSON.stringify(title)} differs between the page and the email`,
    )
  }
})

test('the pages report orders on the shop’s own clock, in the line’s own words', () => {
  // The date beside an order must be the date the Order ID names — the shop's
  // day — not whatever day the browser happens to be in.
  for (const file of ['src/pages/OrderConfirmation.jsx', 'src/pages/Account.jsx']) {
    const code = read(file)
    assert.match(code, /formatShopDateTime\(/, `${file} dates an order with the shop clock`)
    assert.match(code, /orderLineDetail\(/, `${file} shows the line's colour · size · qty · Product ID`)
    assert.match(code, /orderLineName\(/, `${file} names the design without its colour suffix`)
  }
  const admin = read('src/admin/OrdersPanel.jsx')
  assert.match(admin, /formatShopDateTime\(/, 'the admin panel uses the same clock')
})
