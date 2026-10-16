// The category contract: one list in src/data/products.js drives the admin
// selector, the header/footer, the shop's Type filter and the homepage tiles —
// and the database accepts exactly the same four values. These tests fail if
// the label, the key or the constraint ever drift apart.
//
// Run with `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { TYPES, typeLabel, categories, collectionTiles, products as seed } from '../src/data/products.js'

test('the catalogue defines exactly four categories, labels verbatim', () => {
  assert.deepEqual(
    TYPES.map((t) => t.key),
    ['tops', 'coord', 'dress', 'trousers'],
  )
  assert.deepEqual(
    TYPES.map((t) => t.label),
    ['Tops & T-shirts', 'Co-ord Sets', 'Dresses', 'Trousers & Pants'],
    'the three original labels are unchanged and the new one is exact',
  )
  assert.equal(typeLabel('trousers'), 'Trousers & Pants')
  assert.equal(typeLabel('dress'), 'Dresses')
  assert.equal(typeLabel('nope'), 'nope')
})

test('every category the site offers is reachable and pictured', () => {
  assert.equal(categories.length, 4)
  for (const c of categories) {
    assert.ok(c.image, `${c.label} tile has an image`)
    assert.equal(c.to, `/shop?type=${c.type}`, `${c.label} links to its own Type filter`)
    assert.ok(TYPES.some((t) => t.key === c.type))
  }
  const trousers = categories.find((c) => c.type === 'trousers')
  assert.equal(trousers.label, 'Trousers & Pants')
})

test('the seed catalogue only uses categories the database allows', () => {
  const keys = new Set(TYPES.map((t) => t.key))
  for (const p of seed) assert.ok(keys.has(p.type), `${p.id} has a valid type (${p.type})`)
  // The original three keep working exactly as before.
  for (const key of ['tops', 'coord', 'dress']) {
    assert.ok(seed.some((p) => p.type === key), `${key} still has products`)
  }
})

test('the collections page has a Trousers & Pants tile beside the original three', () => {
  const tiles = collectionTiles.map((t) => t.to)
  assert.deepEqual(tiles, ['/shop?type=tops', '/shop?type=coord', '/shop?type=dress', '/shop?type=trousers'])
  const trousers = collectionTiles.find((t) => t.to.includes('trousers'))
  assert.equal(trousers.title, 'Trousers & Pants')
  assert.ok(trousers.image, 'the tile falls back to a real photo even before trousers are stocked')
})

test('the database check constraint accepts exactly the same four values', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/20261016103000_product_colour_and_trousers_category.sql', import.meta.url),
    'utf8',
  )
  const allowed = TYPES.map((t) => `'${t.key}'`).join(',\\s*')
  assert.match(
    sql,
    new RegExp(`type in \\(\\s*${allowed}\\s*\\)`),
    'app category keys and the products_type_check constraint must match one another',
  )
  assert.match(sql, /add column if not exists colour text/, 'the colour column is part of the same migration')
})
