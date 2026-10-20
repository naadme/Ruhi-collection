// Storefront search (requirement: "make search actually work").
//
// The rule lives in src/lib/productSearch.js and is shared by the results
// page and the header's live search, so these tests are the contract both
// screens now obey.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { matchesProduct, searchForms, searchWords } from '../src/lib/productSearch.js'
import { groupedCards } from '../src/lib/productGrouping.js'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

const LABELS = { tops: 'Tops & T-shirts', coord: 'Co-ord Sets', dress: 'Dresses', trousers: 'Trousers & Pants' }
const typeLabel = (k) => LABELS[k] || k

const product = (o) => ({
  id: 'x', type: 'tops', title: 'Shirt', desc: '', colour: null, badge: null, ...o,
})

test('an empty search matches everything — that is what restores the listing', () => {
  const p = product({ title: 'Denim Dress' })
  for (const q of ['', '   ', null, undefined]) {
    assert.equal(matchesProduct(p, q, typeLabel), true)
  }
})

test('a colour is found however it was spelled, in any category', () => {
  // A single row whose title carries no " - Colour" suffix has no `colors`
  // array at all, so its colour only exists in the column. Searching for it
  // used to return nothing — which is exactly the "searching blue must show
  // all blue products" requirement.
  const plain = product({ id: 'pista-top', type: 'tops', title: 'Pista Green Top', colour: 'Pista green' })
  assert.equal(matchesProduct(plain, 'blue', typeLabel), false)
  assert.equal(matchesProduct(plain, 'green', typeLabel), true, 'the colour column is searched')
  assert.equal(matchesProduct(plain, 'PISTA', typeLabel), true, 'case-insensitive')

  const blueTops = product({ id: 'blue-top', type: 'tops', title: 'Classic Top', colour: 'Dark Navy Blue' })
  const blueDress = product({ id: 'blue-dress', type: 'dress', title: 'Summer Dress', colour: 'Sky Blue' })
  assert.equal(matchesProduct(blueTops, 'blue', typeLabel), true, 'across categories')
  assert.equal(matchesProduct(blueDress, 'blue', typeLabel), true, 'across categories')
})

test('the two spellings of one colour find each other', () => {
  const p = product({ id: 'r', type: 'coord', title: 'Shirt pant coord set', colour: 'Royalblue' })
  assert.equal(matchesProduct(p, 'royalblue', typeLabel), true)
  assert.equal(matchesProduct(p, 'Royal Blue', typeLabel), true, 'a space never hides the product')

  const spaced = product({ id: 'r2', type: 'coord', title: 'Set', colour: 'Royal Blue' })
  assert.equal(matchesProduct(spaced, 'royalblue', typeLabel), true)
  assert.equal(matchesProduct(spaced, 'royal blue', typeLabel), true)
})

test('a grouped design is matched by ANY of its colours and is never listed twice', () => {
  const cards = groupedCards([
    { id: 'dress-blue', type: 'dress', title: 'Stripes Dress - Blue', price: 900, colour: null },
    { id: 'dress-pink', type: 'dress', title: 'Stripes Dress - Pink', price: 900, colour: null },
  ])
  assert.equal(cards.length, 1, 'one design, one card')

  const card = cards[0]
  assert.equal(matchesProduct(card, 'blue', typeLabel), true)
  assert.equal(matchesProduct(card, 'pink', typeLabel), true)
  assert.equal(matchesProduct(card, 'dress', typeLabel), true, 'the category label is searched')
  assert.equal(matchesProduct(card, 'denim', typeLabel), false)
})

test('every word must match, so a longer query narrows the results', () => {
  const p = product({ id: 'c', type: 'coord', title: 'Shirt pant coord set', colour: 'Neon Green' })
  assert.equal(matchesProduct(p, 'coord green', typeLabel), true)
  assert.equal(matchesProduct(p, 'coord purple', typeLabel), false)
})

test('the description of EVERY colour is searchable, not only the lead row', () => {
  const cards = groupedCards([
    {
      id: 'a', type: 'dress', title: 'Wrap Dress - Blue', price: 800, colour: 'Blue',
      description: 'Belted waist with a flattering drape',
    },
    {
      id: 'b', type: 'dress', title: 'Wrap Dress - Red', price: 800, colour: 'Red',
      description: 'Fully lined bodice',
    },
  ])
  assert.equal(cards.length, 1)
  assert.equal(matchesProduct(cards[0], 'lined', typeLabel), true, 'the second colour’s description')
  assert.equal(matchesProduct(cards[0], 'drape', typeLabel), true, 'the first colour’s description')
})

test('the id and the SKU are both searchable', () => {
  const p = product({ id: 'denim-shirt-black', sku: '0104BK' })
  assert.equal(matchesProduct(p, 'denim-shirt-black', typeLabel), true)
  assert.equal(matchesProduct(p, '0104BK', typeLabel), true)
})

test('a wrong word still finds nothing — matching is not fuzzy', () => {
  const p = product({ title: 'Denim Dress', type: 'dress', colour: 'Blue' })
  assert.equal(matchesProduct(p, 'blouse', typeLabel), false)
  assert.equal(matchesProduct(p, 'drss', typeLabel), false)
})

test('searchWords and searchForms expose what is searchable', () => {
  const p = product({ id: 'i', sku: '0301RE', title: 'Denim Dress - Red', colour: 'Red', desc: 'Lined' })
  const words = searchWords(p)
  assert.match(words, /Denim Dress/)
  assert.match(words, /0301RE/)
  assert.match(words, /Red/)
  assert.match(words, /Lined/)
  assert.equal(searchForms(p, typeLabel).flat.includes('tops'), true, 'the category key')
  assert.equal(searchForms(p, typeLabel).flat.includes('t shirts'), true, 'and the live category label')
})

// ---- the two screens must not disagree ------------------------------------

test('the results page and the header search use the SAME matcher', () => {
  const shop = read('src/pages/Shop.jsx')
  const bar = read('src/components/SearchBar.jsx')
  assert.match(shop, /matchesProduct/, 'Shop filters through the shared rule')
  assert.match(bar, /matchesProduct/, 'SearchBar filters through the shared rule')
  for (const file of [shop, bar]) {
    assert.doesNotMatch(file, /join\(' '\)\.toLowerCase\(\)\.includes/,
      'no screen keeps a private whole-string matcher any more')
  }
})

test('the header search still updates as the shopper types', () => {
  const bar = read('src/components/SearchBar.jsx')
  assert.match(bar, /onChange=\{\(e\) => setQ\(e\.target\.value\)\}/, 'live input')
  assert.match(bar, /value=\{q\}/, 'controlled')
  assert.match(bar, /term && !res\.length/, 'an empty search shows no results list')
})
