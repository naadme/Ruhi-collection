// Issue 1 — "Colour is getting added to product name now."
//
// The catalogue stores a colour INSIDE the product's title, as a
// " - Colour" suffix ("Maxi dress - Brown"), because a design's colour rows
// are tied together by their shared design name (see src/lib/productGrouping.js
// and `buildTitle` in src/lib/productForm.js). That suffix is storage, not
// prose: the name the shopper, the search box, the cart and the owner's own
// product list read must be the design's name — "Maxi dress" — with the
// colour living in the colour field instead.
//
// For years the suffix was only decoded when a design had SEVERAL colour rows
// to choose between, so a design photographed in a single colour printed its
// colour after its name everywhere the card was rendered. These tests pin the
// rule at its source (the one shared grouping module) and the two lists that
// render it, so a lone colour row can never print its colour as a name again.
//
// Run with `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { groupedCards, groupRows, partsOf, splitColour } from '../src/lib/productGrouping.js'
import { buildTitle, nameOf } from '../src/lib/productForm.js'
import { productColours } from '../src/lib/productSearch.js'
import { orderLineName } from '../src/lib/orderLine.js'

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8')

// A row shaped exactly like ProductsContext.toProduct produces it.
const row = (id, type, title, extra = {}) => ({
  id,
  type,
  title,
  price: 900,
  compare: null,
  image: `/images/products/${id}.jpg`,
  hover: null,
  gallery: [`/images/products/${id}.jpg`],
  colour: title.includes(' - ') ? title.slice(title.lastIndexOf(' - ') + 3) : null,
  is_active: true,
  ...extra,
})

// The client's own example, in the catalogue's own words.
const maxiDress = () => [row('floral-maxi-dress-black', 'dress', 'Floral Maxi dress - Black')]

// ---- the name a shopper reads ---------------------------------------------

test('a single-colour design shows the design name, never "Design - Colour"', () => {
  const [card] = groupedCards(maxiDress())
  assert.equal(card.title, 'Floral Maxi dress', 'the colour leaves the name')
  assert.equal(card.id, 'floral-maxi-dress-black', 'the card still opens the product it shows')
})

test('the rule holds for EVERY design the catalogue can build, however the colour was written', () => {
  // Three ways a row can carry its colour: the `colour` column, a title suffix
  // this catalogue knows, and a title suffix it does NOT know (which only the
  // column can decode). All three must come out with the same clean name.
  const cases = [
    ['maxi-dress-brown', 'dress', 'Maxi dress - Brown', { colour: 'Brown' }],
    ['zebra-maxi', 'dress', 'Zebra pattern Maxi dress - Black and White', { colour: 'Black and White' }],
    ['checks-maxi', 'dress', 'Maxi dress - Checks - Black & White', { colour: 'Black & White' }],
    ['denim-shirt-blue', 'tops', 'Denim Shirt - Blue', { colour: null }],
    ['stripes-dress', 'dress', 'Stripes Dress', { colour: null }],
  ]
  const expected = [
    'Maxi dress',
    'Zebra pattern Maxi dress',
    'Maxi dress - Checks',
    'Denim Shirt',
    'Stripes Dress',
  ]
  const cards = groupedCards(cases.map(([id, type, title, extra]) => row(id, type, title, extra)))
  assert.deepEqual(cards.map((c) => c.title), expected)
  // And the source of the leak — a suffix a shopper would read as a colour —
  // is gone from every one of them.
  for (const card of cards) {
    assert.equal(splitColour(card.title), null, `${JSON.stringify(card.title)} still carries a colour suffix`)
  }
})

test('a colour word that is part of the name is never mistaken for a colour', () => {
  const [card] = groupedCards([row('korean-pants', 'tops', 'Korean Pants- Biege')])
  assert.equal(card.title, 'Korean Pants- Biege', 'no " - " means there is nothing to decode')
  const [checks] = groupedCards([
    row('checks', 'dress', 'Maxi dress - Checks - Black & White', { colour: 'Black & White' }),
  ])
  assert.equal(checks.title, 'Maxi dress - Checks', 'the design is "Maxi dress - Checks"; only its colour left')
})

// ---- the colour is kept, just not printed ---------------------------------

test('the colour leaves the name and stays on the card', () => {
  const [card] = groupedCards(maxiDress())
  assert.equal(card.colour, 'Black', 'the colour is still on the card')
  assert.deepEqual(productColours(card), ['Black'], 'and the colour search still finds it')
})

test('a colour that exists only in the title suffix survives losing it from the name', () => {
  // The bundled catalogue predates the `colour` column: a row can carry its
  // colour nowhere but the title. Stripping the suffix must not take the only
  // copy of it with it.
  const [card] = groupedCards([
    row('solid-coord-set-red', 'coord', 'Solid Coord set - Red', { colour: null }),
  ])
  assert.equal(card.title, 'Solid Coord set')
  assert.equal(card.colour, 'Red')
  assert.deepEqual(productColours(card), ['Red'])
})

test('the colour selector is still offered exactly where there is a choice', () => {
  const [multi] = groupedCards([
    row('a', 'tops', 'Denim Shirt - Black'),
    row('b', 'tops', 'Denim Shirt - Blue'),
  ])
  const [single] = groupedCards(maxiDress())
  assert.equal(multi.colors.length, 2, 'two colours, two choices')
  assert.equal('colors' in single, false, 'one colour offers nothing to choose between')
})

// ---- nothing else moves ----------------------------------------------------

test('a name with no colour in it is left exactly as stored', () => {
  const [card] = groupedCards([row('denim-dress', 'dress', 'Denim Dress')])
  assert.equal(card.title, 'Denim Dress')
  assert.equal(card.colour, null, 'nothing is invented for a product with no colour')
})

test('stripping a colour never merges two different designs', () => {
  const cards = groupedCards([
    row('classic-shirt-black', 'tops', 'Classic Shirt - Black'),
    row('classic-tee-black', 'tops', 'Classic Tee - Black'),
    row('stripes-dress-black', 'dress', 'Stripes Dress - Black'),
  ])
  assert.equal(cards.length, 3, 'a shared colour pools nothing')
  assert.deepEqual(cards.map((c) => c.id), ['classic-shirt-black', 'classic-tee-black', 'stripes-dress-black'])
})

test('the storefront card and the owner\'s product list give ONE name', () => {
  // Both read the same rule (src/lib/productGrouping.js): if the dashboard
  // said "Floral Maxi dress" while the shop said "Floral Maxi dress - Black"
  // — or the other way round — the owner would be reading two names for one
  // product.
  const rows = [
    row('floral-maxi-dress-black', 'dress', 'Floral Maxi dress - Black'),
    row('maxi-dress-brown', 'dress', 'Maxi dress - Brown'),
    row('denim-dress', 'dress', 'Denim Dress'),
    row('a', 'tops', 'Denim Shirt - Black'),
    row('b', 'tops', 'Denim Shirt - Blue'),
  ]
  const cards = groupedCards(rows)
  for (const g of groupRows(rows)) {
    const card = cards.find((c) => c.id === g.rows[0].id || c.colors?.some((x) => x.id === g.rows[0].id))
    assert.ok(card, `${g.name} has a card`)
    assert.equal(card.title, g.name, `${g.name}: the list and the shop agree`)
  }
})

test('the name is the stored title minus its colour — nothing is renamed', () => {
  // The editor's own round trip: the name the owner typed is what comes back
  // out, and what comes back out is what the card shows.
  assert.equal(buildTitle('Maxi Dress', 'Black'), 'Maxi Dress - Black')
  assert.equal(nameOf({ title: 'Maxi Dress - Black', colour: 'Black' }), 'Maxi Dress')
  const [card] = groupedCards([row('maxi-dress-black', 'dress', buildTitle('Maxi Dress', 'Black'), { colour: 'Black' })])
  assert.equal(card.title, 'Maxi Dress')
})

// ---- the surfaces the client listed ----------------------------------------

test('the surfaces that print a product name print the grouped card\'s name', () => {
  // Every one of these renders the card `groupedCards` builds — none of them
  // reaches for a raw `products` row, which is where the suffix lives.
  for (const file of [
    'src/components/ProductCard.jsx',
    'src/components/SearchBar.jsx',
    'src/pages/Product.jsx',
    'src/pages/Cart.jsx',
    'src/pages/Checkout.jsx',
    'src/components/CartDrawer.jsx',
    'src/admin/BestsellerPanel.jsx',
  ]) {
    const code = read(file)
    assert.match(code, /\.title\b/, `${file} renders a product title`)
    assert.doesNotMatch(
      code,
      /lastIndexOf\(['"] - ['"]\)|splitColour\(|slice\(0,\s*.*lastIndexOf/,
      `${file} must not decode titles itself — it reads the grouped name`,
    )
  }
})

test('the owner’s product list prints the design name, not the raw row title', () => {
  // The list has TWO render paths: a design with one colour row, and a design
  // with several. Both must print the group's design name. The single-colour
  // path was the one that printed "Maxi dress - Brown" for years, because the
  // row was handed straight to the row component instead of the group's name.
  const dashboard = read('src/admin/Dashboard.jsx')
  const list = read('src/admin/ProductList.jsx')

  // EVERY call site, not merely the first one a pattern happens to find: a
  // second <ProductRow> added later without the prop would be the same bug.
  const calls = [...dashboard.matchAll(/<ProductRow\b[\s\S]*?\/>/g)].map((m) => m[0])
  assert.ok(calls.length >= 1, 'the list renders rows')
  for (const call of calls) {
    assert.match(call, /name=\{g\.name\}/, 'every ProductRow is given the group’s design name')
  }
  assert.match(dashboard, /groupRows\(all\)/, 'the dashboard groups through the one shared rule')
  assert.match(dashboard, /<GroupCard[\s\S]{0,120}?\bg=\{g\}/, 'the multi-colour card is given the group')

  // The name must actually be what is printed, not a prop that goes unused.
  assert.match(list, /const title = String\(name \|\| ''\)\.trim\(\) \|\| p\.title/,
    'the row falls back to its own title only when it has no design name')
  assert.match(list, /\{title\}/, 'the row prints the resolved name')
  assert.match(list, /\{g\.name\}/, 'and the multi-colour card prints the group name')
  assert.doesNotMatch(list, /<p[^>]*>\{p\.title\}/, 'neither path prints the raw stored title')
})

test('an order summary names the design without its colour suffix', () => {
  // Order lines snapshot the stored title, so the summaries have to decode
  // it — which they do, through the one shared rule.
  assert.equal(orderLineName('Floral Maxi dress - Black'), 'Floral Maxi dress')
  for (const file of ['src/pages/OrderConfirmation.jsx', 'src/pages/Account.jsx']) {
    assert.match(read(file), /orderLineName\(/, `${file} names the design without its colour suffix`)
  }
})

test('the grouping module is still the only place a title is decoded', () => {
  // `partsOf` is the one rule; if a second copy appears somewhere else the
  // two will drift and the colour will come back in a name.
  const code = read('src/lib/productGrouping.js')
  assert.match(code, /export const partsOf = /, 'the one rule is exported')
  const users = ['src/lib/productForm.js', 'src/lib/orderLine.js', 'src/admin/orderExport.js']
  for (const file of users) {
    const src = read(file)
    assert.ok(
      !src.includes('COLOUR_WORDS'),
      `${file} re-implements the colour list instead of reading the shared rule`,
    )
  }
  assert.ok(partsOf(row('x', 'dress', 'Maxi dress - Brown', { colour: 'Brown' })).name === 'Maxi dress')
})
