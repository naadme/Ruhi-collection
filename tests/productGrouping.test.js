// The grouping rule that both the storefront and the admin dashboard read.
// Run with `npm test` (node --test). These tests pin down two promises:
//
//   1. Rows written the old way (colour only in the title) group EXACTLY as
//      they always have — same designs, same order, same lead row — so the
//      storefront's behaviour is preserved bit for bit.
//   2. An explicit colour never merges two different designs, and two designs
//      that merely share a colour never merge.

import test from 'node:test'
import assert from 'node:assert/strict'
import { COLOUR_WORDS, splitColour, splitTitle, partsOf, groupRows } from '../src/lib/productGrouping.js'

const row = (id, type, title, extra = {}) => ({ id, type, title, ...extra })

test('splitColour keeps the legacy title parsing', () => {
  assert.deepEqual(splitColour('Stripes Dress - Pink'), { name: 'Stripes Dress', colour: 'Pink' })
  assert.deepEqual(splitColour('Shirt pant coord set - Neon Green'), { name: 'Shirt pant coord set', colour: 'Neon Green' })
  assert.equal(splitColour('Denim Dress'), null)
  assert.equal(splitColour('Korean Pants- Biege'), null, 'no " - " separator, no colour')
  assert.equal(splitColour('Tshirt - Lavender'), null, 'an unknown suffix is not a colour word')
  assert.equal(splitColour('Limited Edition'), null)
  assert.ok(COLOUR_WORDS.has('Olive Green'))
})

test('splitTitle accepts any suffix, but only for loading titles back', () => {
  assert.deepEqual(splitTitle('Tshirt - Lavender'), { name: 'Tshirt', colour: 'Lavender' })
  assert.deepEqual(splitTitle('Shirt - Pant - Black'), { name: 'Shirt - Pant', colour: 'Black' })
  assert.equal(splitTitle('Korean Pants- Biege'), null)
  assert.equal(splitTitle('Denim Dress'), null)
})

test('old catalogue rows group exactly as the storefront always grouped them', () => {
  const rows = [
    row('stripes-dress-yellow', 'dress', 'Stripes Dress - Yellow'),
    row('denim-shirt-black', 'tops', 'Denim Shirt - Black'),
    row('denim-shirt-blue', 'tops', 'Denim Shirt - Blue'),
    row('denim-dress', 'dress', 'Denim Dress'),
    row('korean-pants-biege-jpg', 'tops', 'Korean Pants- Biege'),
  ]
  const groups = groupRows(rows)

  assert.equal(groups.length, 4, 'Denim Shirt groups; the other three stand alone')
  assert.equal(groups[0].rows[0].id, 'stripes-dress-yellow', 'catalogue order is preserved')
  assert.equal(groups[1].name, 'Denim Shirt')
  assert.deepEqual(groups[1].rows.map((r) => r.id), ['denim-shirt-black', 'denim-shirt-blue'])
  assert.equal(groups[1].parts.colour, 'Black', 'the lead colour is the first row’s')
  assert.equal(groups[2].rows[0].id, 'denim-dress')
  assert.equal(groups[2].name, 'Denim Dress', 'a colourless title is kept whole')
  assert.equal(groups[3].name, 'Korean Pants- Biege')
  assert.equal(groups[3].parts, null)
})

test('designs never merge across categories, even with identical names', () => {
  const groups = groupRows([
    row('shirt-black', 'tops', 'Classic Shirt - Black'),
    row('dress-black', 'dress', 'Classic Shirt - Black'),
  ])
  assert.equal(groups.length, 2)
  assert.equal(groups[0].rows[0].id, 'shirt-black')
  assert.equal(groups[1].rows[0].id, 'dress-black')
})

test('a shared colour alone never merges two designs', () => {
  const groups = groupRows([
    row('shirt-black', 'tops', 'Classic Shirt - Black'),
    row('tee-black', 'tops', 'Classic Tee - Black'),
  ])
  assert.equal(groups.length, 2)
})

test('unknown title suffixes never merge (storefront behaviour preserved)', () => {
  const groups = groupRows([
    row('t-lavender', 'tops', 'Tshirt - Lavender'),
    row('t-mint', 'tops', 'Tshirt - Mint'),
  ])
  assert.equal(groups.length, 2)
})

test('an explicit colour column groups, even for colours the title list does not know', () => {
  const groups = groupRows([
    row('classic-shirt-pastel-pink', 'tops', 'Classic Shirt - Pastel Pink', { colour: 'Pastel Pink' }),
    row('classic-shirt-sky', 'tops', 'Classic Shirt - Sky', { colour: 'Sky' }),
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].name, 'Classic Shirt')
  assert.deepEqual(groups[0].rows.map((r) => r.id), ['classic-shirt-pastel-pink', 'classic-shirt-sky'])
})

test('rows sharing only a colour column group without losing their titles', () => {
  const groups = groupRows([
    row('classic-shirt-black', 'tops', 'Classic Shirt', { colour: 'Black' }),
    row('classic-shirt-white', 'tops', 'Classic Shirt', { colour: 'White' }),
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].name, 'Classic Shirt')
  assert.equal(groups[0].rows.length, 2)
})

test('a colour column that contradicts the title keeps the row on its own', () => {
  const groups = groupRows([
    row('a', 'tops', 'Shirt - Blue', { colour: 'Black' }),
    row('b', 'tops', 'Shirt - Red', { colour: 'Black' }),
  ])
  assert.equal(groups.length, 2, 'nothing is pooled on a contradiction')
  assert.equal(groups[0].rows[0].id, 'a')
})

test('partsOf prefers the colour column and strips the matching suffix only', () => {
  assert.deepEqual(partsOf(row('a', 'tops', 'Denim Shirt - Black', { colour: 'Black' })), { name: 'Denim Shirt', colour: 'Black' })
  assert.deepEqual(partsOf(row('a', 'tops', 'Denim Shirt - Black')), { name: 'Denim Shirt', colour: 'Black' })
  assert.deepEqual(partsOf(row('a', 'tops', 'Denim Shirt', { colour: 'Wine Red' })), { name: 'Denim Shirt', colour: 'Wine Red' })
  assert.equal(partsOf(row('a', 'tops', 'Denim Dress')), null)
  assert.equal(partsOf(row('a', 'tops', 'Denim Dress', { colour: '  ' })), null, 'a blank colour is no colour')
})
