// Searching by colour.
//
// The client asked for a colour FILTER: searching "blue" must find the
// products that are actually blue — and only those. The old rule matched the
// word anywhere, so a product whose description merely mentioned "blue" came
// back for a colour search.
//
// The colour is the SAVED colour: the row's `colour` column, the colour of any
// of the design's variants, or the " - Colour" suffix of the title. Nothing is
// guessed from a file name.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  COLOUR_WORDS,
  isColourWord,
  matchesProduct,
  productColours,
  queryColours,
  queryTerms,
} from '../src/lib/productSearch.js'

const typeLabel = (key) => ({
  tops: 'Tops & T-shirts', coord: 'Co-ord Sets', dress: 'Dresses', trousers: 'Trousers & Pants',
}[key] || key)

const product = (over = {}) => ({
  id: 'p1',
  type: 'tops',
  title: 'Denim Shirt',
  price: 900,
  colour: 'Blue',
  desc: '',
  ...over,
})

test('a colour word is recognised', () => {
  assert.equal(isColourWord('blue'), true)
  assert.equal(isColourWord('BLUE'), true)
  assert.equal(isColourWord('royal blue'), true)
  assert.equal(isColourWord('denim'), false)
  assert.ok(COLOUR_WORDS.includes('black'))
})

test('searching a colour finds the products that are that colour', () => {
  const blue = product({ colour: 'Blue' })
  const black = product({ colour: 'Black' })
  assert.equal(matchesProduct(blue, 'blue', typeLabel), true)
  assert.equal(matchesProduct(black, 'blue', typeLabel), false)
})

test('the match does not care how the colour is written', () => {
  const blue = product({ colour: 'Blue' })
  assert.equal(matchesProduct(blue, 'BLUE', typeLabel), true)
  assert.equal(matchesProduct(blue, 'Blue', typeLabel), true)
  assert.equal(matchesProduct(blue, 'bLuE', typeLabel), true)
})

test('a colour that only appears in the description is not a colour', () => {
  // The product is not blue; its description happens to say so.
  const notBlue = product({ colour: 'Black', desc: 'A soft blue shirt for summer.' })
  assert.equal(matchesProduct(notBlue, 'blue', typeLabel), false,
    'the description must not turn a black product blue')
})

test('a product with no colour at all is not found by a colour search', () => {
  const none = product({ colour: null, title: 'Cotton Dress', desc: 'A lovely blue dress.' })
  assert.equal(matchesProduct(none, 'blue', typeLabel), false)
})

test('the colour of every variant of a design is searched', () => {
  const design = product({
    title: 'Wrap Dress',
    colour: '',
    colors: [
      { id: 'c1', color: 'Blue', title: 'Wrap Dress - Blue' },
      { id: 'c2', color: 'Red', title: 'Wrap Dress - Red' },
    ],
  })
  assert.equal(matchesProduct(design, 'blue', typeLabel), true)
  assert.equal(matchesProduct(design, 'red', typeLabel), true)
  assert.equal(matchesProduct(design, 'green', typeLabel), false)
})

test('a colour named in the title is found even without the colour column', () => {
  const row = product({ title: 'Denim Shirt - Black', colour: null })
  assert.equal(matchesProduct(row, 'black', typeLabel), true)
  assert.equal(matchesProduct(row, 'blue', typeLabel), false)
})

test('a product whose NAME names the colour is not a colour match', () => {
  // A colour word is matched against the SAVED colour and nothing else: the
  // row's own colour, the colours of its variants, or the " - Colour" suffix
  // of its title. A design merely CALLED "Denim Blue Shirt" is not a blue
  // product — the client asked for a colour filter, not a word search, so
  // a name cannot make a product blue.
  const named = product({ title: 'Denim Blue Shirt', colour: null })
  assert.equal(matchesProduct(named, 'blue', typeLabel), false)
})

test('a two-word colour is one term, not two words', () => {
  const royal = product({ colour: 'Royalblue' })
  const brown = product({ colour: 'Brown', desc: 'A royal-looking brown shirt.' })
  assert.equal(matchesProduct(royal, 'royal blue', typeLabel), true)
  assert.equal(matchesProduct(brown, 'royal blue', typeLabel), false,
    'the description must not satisfy a colour')
  assert.deepEqual(queryTerms('royal blue'), [{ text: 'royal blue', colour: true }])
})

test('a colour search and an ordinary search still work together', () => {
  const blueDress = product({ type: 'dress', title: 'Wrap Dress', colour: 'Blue' })
  assert.equal(matchesProduct(blueDress, 'blue dress', typeLabel), true)
  assert.equal(matchesProduct(blueDress, 'blue shirt', typeLabel), false)
})

test('an ordinary word still searches the description', () => {
  const p = product({ desc: 'Fully lined bodice with a soft drape.' })
  assert.equal(matchesProduct(p, 'lined', typeLabel), true)
  assert.equal(matchesProduct(p, 'drape', typeLabel), true)
})

test('the Product ID is still searchable', () => {
  const p = product({ id: 'denim-shirt-black', sku: '0104BK', title: 'Denim Shirt - Black', colour: 'Black' })
  assert.equal(matchesProduct(p, '0104BK', typeLabel), true)
  assert.equal(matchesProduct(p, 'denim-shirt-black', typeLabel), true)
})

test('a wrong word still finds nothing', () => {
  const p = product({ title: 'Denim Dress', type: 'dress', colour: 'Blue' })
  assert.equal(matchesProduct(p, 'blouse', typeLabel), false)
  assert.equal(matchesProduct(p, 'drss', typeLabel), false)
})

test('the colours a query is asking for can be named', () => {
  assert.deepEqual(queryColours('blue dress'), ['blue'])
  assert.deepEqual(queryColours('denim shirt'), [])
  assert.deepEqual(queryColours('royal blue'), ['royal blue'])
})

test('the saved colours of a product can be read', () => {
  const design = product({
    title: 'Wrap Dress',
    colour: '',
    colors: [{ id: 'c1', color: 'Blue' }, { id: 'c2', color: 'Red' }],
  })
  assert.deepEqual(productColours(design).sort(), ['Blue', 'Red'])
})
