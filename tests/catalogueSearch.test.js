// Searching spans the WHOLE catalogue.
//
// The bug this pins down: the results page filtered by the category the page
// happened to be showing AND by the search words at the same time, so a
// shopper who searched "red" while a category was selected was shown the red
// products of that one category — and who searched from a category link was
// told the shop had nothing else. The client asked for a search: "red" must
// return every product that genuinely matches red, in every category and in
// every size it is stocked in.
//
// The rule lives in src/lib/productSearch.js:
//
//   * matchesProduct  — does THIS product match these words;
//   * matchesProducts — which products the catalogue shows for a search and
//     for a category;
//   * searchPath      — the address a new search goes to (the category is
//     dropped, the sort is kept).
//
// Run with `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { matchesProduct, matchesProducts, searchPath } from '../src/lib/productSearch.js'
import { groupedCards } from '../src/lib/productGrouping.js'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

const LABELS = {
  tops: 'Tops & T-shirts', coord: 'Co-ord Sets', dress: 'Dresses',
  trousers: 'Trousers & Pants', 'night-wear': 'Night Wear',
}
const typeLabel = (k) => LABELS[k] || k

const product = (o) => ({
  id: 'x', type: 'tops', title: 'Shirt', desc: '', colour: null, badge: null,
  sizes: ['S', 'M', 'L', 'XL'], ...o,
})

// A miniature of the live catalogue: red in three categories and in different
// sizes, blue in two, and a product that merely mentions red in its text.
const CATALOGUE = [
  product({ id: 'red-top', type: 'tops', title: 'Classic Top', colour: 'Red', sizes: ['S', 'M'] }),
  product({ id: 'red-dress', type: 'dress', title: 'Summer Dress', colour: 'Bright Red', sizes: ['M', 'L'] }),
  product({ id: 'red-trouser', type: 'trousers', title: 'Everyday Trousers', colour: 'Wine Red', sizes: ['L', 'XL'] }),
  product({ id: 'blue-top', type: 'tops', title: 'Denim Shirt', colour: 'Blue' }),
  product({ id: 'blue-coord', type: 'coord', title: 'Shirt pant coord set', colour: 'Sky Blue' }),
  product({ id: 'green-dress', type: 'dress', title: 'Cotton Dress', colour: 'Green' }),
  product({ id: 'talks-about-red', type: 'tops', title: 'Everyday Shirt', colour: 'Black', desc: 'A soft red shirt for summer.' }),
]

const ids = (list) => list.map((p) => p.id).sort()

// ---- a colour search finds every product that really is that colour --------

test('searching red finds every red product, in every category and size', () => {
  const found = matchesProducts(CATALOGUE, { q: 'red', typeLabel })
  assert.deepEqual(ids(found), ['red-dress', 'red-top', 'red-trouser'],
    'red in Tops, in Dresses and in Trousers — every one of them')
})

test('the category the page is showing never hides a search result', () => {
  // The same search, from inside a category, must return the same products.
  const everywhere = matchesProducts(CATALOGUE, { q: 'red', typeLabel })
  const fromTops = matchesProducts(CATALOGUE, { q: 'red', type: 'tops', typeLabel })
  const fromDress = matchesProducts(CATALOGUE, { q: 'red', type: 'dress', typeLabel })
  assert.deepEqual(ids(fromTops), ids(everywhere), 'a search is not narrowed by the category')
  assert.deepEqual(ids(fromDress), ids(everywhere))
})

test('searching blue finds every blue product across the categories', () => {
  const found = matchesProducts(CATALOGUE, { q: 'blue', typeLabel })
  assert.deepEqual(ids(found), ['blue-coord', 'blue-top'])
})

test('a word that matches nothing returns nothing', () => {
  assert.deepEqual(matchesProducts(CATALOGUE, { q: 'chartreuse', typeLabel }), [])
  assert.deepEqual(matchesProducts(CATALOGUE, { q: 'zzz nothing', typeLabel }), [])
})

test('a product is not a colour because the word appears in its description', () => {
  const found = matchesProducts(CATALOGUE, { q: 'red', typeLabel })
  assert.ok(!ids(found).includes('talks-about-red'),
    'a black shirt that mentions red in its description is not a red shirt')
  assert.equal(matchesProduct(CATALOGUE[6], 'red', typeLabel), false)
})

test('a design is found by any of the colours it comes in', () => {
  const cards = groupedCards([
    product({ id: 'wrap-blue', type: 'dress', title: 'Wrap Dress - Blue', colour: 'Blue' }),
    product({ id: 'wrap-red', type: 'dress', title: 'Wrap Dress - Red', colour: 'Red' }),
  ])
  assert.equal(cards.length, 1, 'one design, one card')
  assert.equal(matchesProduct(cards[0], 'red', typeLabel), true)
  assert.equal(matchesProduct(cards[0], 'blue', typeLabel), true)
  assert.equal(matchesProduct(cards[0], 'green', typeLabel), false)
})

// ---- the ordinary words still work -----------------------------------------

test('the search is case-insensitive and ignores stray spaces', () => {
  assert.deepEqual(ids(matchesProducts(CATALOGUE, { q: '  RED  ', typeLabel })), ['red-dress', 'red-top', 'red-trouser'])
  assert.deepEqual(ids(matchesProducts(CATALOGUE, { q: 'Red', typeLabel })), ['red-dress', 'red-top', 'red-trouser'])
  assert.deepEqual(ids(matchesProducts(CATALOGUE, { q: 'rEd', typeLabel })), ['red-dress', 'red-top', 'red-trouser'])
})

test('an ordinary word still searches the name and the description', () => {
  const found = matchesProducts(CATALOGUE, { q: 'summer', typeLabel })
  assert.deepEqual(ids(found), ['red-dress', 'talks-about-red'])
})

test('the sizes a product is stocked in are searchable', () => {
  // Only the trouser comes in XL.
  const found = matchesProducts(CATALOGUE, { q: 'xl', typeLabel })
  assert.ok(ids(found).includes('red-trouser'))
})

test('the category still filters the catalogue when there is no search', () => {
  const tops = matchesProducts(CATALOGUE, { type: 'tops', typeLabel })
  assert.deepEqual(ids(tops), ['blue-top', 'red-top', 'talks-about-red'])
  assert.equal(matchesProducts(CATALOGUE, { typeLabel }).length, CATALOGUE.length, 'no filter, no catalogue')
})

test('an empty search shows the whole catalogue again', () => {
  assert.equal(matchesProducts(CATALOGUE, { q: '   ', typeLabel }).length, CATALOGUE.length)
  assert.equal(matchesProducts(CATALOGUE, { q: '', typeLabel }).length, CATALOGUE.length)
})

// ---- a new search resets the filters it cannot keep ------------------------

test('a new search leaves the category filter behind and keeps the sort', () => {
  assert.equal(searchPath('red'), '/shop?q=red')
  assert.equal(searchPath('  red  '), '/shop?q=red')
  assert.equal(searchPath('red', { sort: 'low' }), '/shop?q=red&sort=low')
  // The category is never carried into a new search — it would hide results.
  assert.equal(searchPath('red', { type: 'coord' }), '/shop?q=red')
  assert.equal(searchPath(''), '/shop')
})

// ---- the two screens agree --------------------------------------------------

test('the results page and the header search use the same rule', () => {
  const shop = read('src/pages/Shop.jsx')
  const bar = read('src/components/SearchBar.jsx')
  for (const file of [shop, bar]) {
    assert.match(file, /matchesProduct/, 'both screens filter through the shared rule')
    assert.doesNotMatch(file, /join\(' '\)\.toLowerCase\(\)\.includes/,
      'no screen keeps a private whole-string matcher any more')
  }
  assert.match(shop, /matchesProducts/, 'the results page asks the shared catalogue rule')
})

test('the results page does not narrow a search by the category', () => {
  const shop = read('src/pages/Shop.jsx')
  // The filter must be the shared rule, not a hand-written category test
  // wrapped around the search.
  assert.doesNotMatch(shop, /\(!t \|\| p\.type === t\) && \(!q \|\| matchesProduct/,
    'the category is not applied on top of the search any more')
  assert.match(shop, /value=\{searching \? '' : t\}/,
    'the Type box shows that every category is being searched')
})
