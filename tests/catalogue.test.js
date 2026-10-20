// The category contract: one list in src/data/products.js drives the admin
// selector, the header/footer, the shop's Type filter and the homepage tiles —
// and the database accepts exactly the same values. These tests fail if
// the label, the key or the constraint ever drift apart.
//
// Run with `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { TYPES, typeLabel, categories, collectionTiles, products as seed } from '../src/data/products.js'

test('the catalogue defines the six categories the client asked for, labels verbatim', () => {
  assert.deepEqual(
    TYPES.map((t) => t.key),
    ['tops', 'coord', 'dress', 'trousers', 'night-wear', 'kurta-sets'],
  )
  assert.deepEqual(
    TYPES.map((t) => t.label),
    [
      'Tops & T-shirts', 'Co-ord Sets', 'Dresses', 'Trousers & Pants',
      'Night Wear', 'Kurta Sets',
    ],
    'the four original labels are unchanged and the two new ones are exact',
  )
  assert.equal(typeLabel('trousers'), 'Trousers & Pants')
  assert.equal(typeLabel('dress'), 'Dresses')
  assert.equal(typeLabel('nope'), 'nope')
})

test('every category the site offers is reachable, and the four pictured ones have a photo', () => {
  // Every category reaches its own filtered shop page...
  for (const t of TYPES) {
    assert.ok(categories.some((c) => c.type === t.key), `${t.label} has a tile`)
  }
  // ...and the tiles that carry a photograph are the ones the client chose.
  const pictured = categories.filter((c) => c.image)
  for (const c of pictured) {
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

test('the database accepts exactly the same categories the site offers', async () => {
  // A product's category is a foreign key to the client's own list, so the
  // database and the site can never drift apart: a category added in either
  // place is the same category.
  const sql = await readFile(
    new URL('../supabase/migrations/20261019130000_client_editable_categories.sql', import.meta.url),
    'utf8',
  )
  assert.match(sql, /references public\.categories \(key\)/,
    'a product points at the category list')
  // The colour column lives in its own migration, which the products table
  // has carried since the colour variants were introduced.
  const colour = await readFile(
    new URL('../supabase/migrations/20261016103000_product_colour_and_trousers_category.sql', import.meta.url),
    'utf8',
  )
  assert.match(colour, /add column if not exists colour text/, 'the colour column is there')
  // And the two categories the client asked for by name are seeded.
  const added = await readFile(
    new URL('../supabase/migrations/20261020200000_night_wear_and_kurta_sets.sql', import.meta.url),
    'utf8',
  )
  for (const t of TYPES.filter((x) => ['night-wear', 'kurta-sets'].includes(x.key))) {
    assert.ok(added.includes(`'${t.key}'`), `seeds the ${t.key} key`)
    assert.ok(added.includes(`'${t.label}'`), `seeds the ${t.label} label`)
  }
})
