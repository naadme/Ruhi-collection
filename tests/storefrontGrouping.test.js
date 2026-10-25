// The storefront half of the colour work, as pure functions: how a set of
// colour rows becomes ONE product card, how a colour choice resolves, which
// image each variant shows, and which id the cart receives.
//
// These test `groupedCards` and `variantFor` from src/lib/productGrouping.js —
// the exact functions src/context/ProductsContext.jsx and
// src/pages/Product.jsx call — so the behaviour pinned here is the behaviour
// the live site runs.
//
// Run with `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { groupedCards, variantFor } from '../src/lib/productGrouping.js'

// A row in the shape ProductsContext.toProduct produces (id, type, title and
// the per-variant display fields the card and product page read).
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

const denimShirt = () => [
  row('denim-shirt-black', 'tops', 'Denim Shirt - Black'),
  row('denim-shirt-blue', 'tops', 'Denim Shirt - Blue'),
  row('denim-shirt-white', 'tops', 'Denim Shirt - White'),
]

// ---- one design, one card --------------------------------------------------

test('three colourways of one design become ONE card with all colours selectable', () => {
  const cards = groupedCards(denimShirt())

  assert.equal(cards.length, 1, 'one design, one listing')
  assert.equal(cards[0].title, 'Denim Shirt', 'the " - Colour" suffix leaves the card title')
  assert.deepEqual(
    cards[0].colors.map((c) => c.color),
    ['Black', 'Blue', 'White'],
    'the shopper can pick every colour the catalogue actually shoots',
  )
  assert.deepEqual(
    cards[0].colors.map((c) => c.id),
    ['denim-shirt-black', 'denim-shirt-blue', 'denim-shirt-white'],
    'existing product ids are preserved verbatim',
  )
})

test('every colour variant keeps its own image, hover and gallery', () => {
  const [card] = groupedCards([
    row('denim-shirt-black', 'tops', 'Denim Shirt - Black', { image: '/black.jpg', hover: '/black-2.jpg', gallery: ['/black.jpg', '/black-2.jpg'] }),
    row('denim-shirt-blue', 'tops', 'Denim Shirt - Blue', { image: '/blue.jpg', hover: '/blue-2.jpg', gallery: ['/blue.jpg', '/blue-2.jpg'] }),
  ])
  const [black, blue] = card.colors

  assert.equal(black.image, '/black.jpg', 'the black variant shows the black photo')
  assert.equal(blue.image, '/blue.jpg', 'the blue variant shows the blue photo')
  assert.equal(black.hover, '/black-2.jpg')
  assert.equal(blue.hover, '/blue-2.jpg')
  assert.deepEqual(blue.gallery, ['/blue.jpg', '/blue-2.jpg'], 'galleries never cross variants')
  assert.equal(card.image, '/black.jpg', 'the card shows the first colour, as it always has')
})

test('selecting a colour resolves to exactly that variant — and only that one', () => {
  const [card] = groupedCards(denimShirt())

  const blue = variantFor(card.colors, 'denim-shirt-blue')
  assert.equal(blue.id, 'denim-shirt-blue')
  assert.equal(blue.image, '/images/products/denim-shirt-blue.jpg', 'the chosen colour drives the image')

  const black = variantFor(card.colors, 'denim-shirt-black')
  assert.equal(black.id, 'denim-shirt-black')
  assert.notEqual(black.image, blue.image)

  // A stale or invented id must never pick an arbitrary colour.
  assert.equal(variantFor(card.colors, 'does-not-exist').id, 'denim-shirt-black', 'unknown ids fall back to the first colour')
})

test('the card ids the cart depends on are unique and all resolve', () => {
  const [card] = groupedCards(denimShirt())
  const ids = card.colors.map((c) => c.id)

  assert.equal(new Set(ids).size, ids.length, 'each colour is its own cart line (id + size keys a line)')
  assert.ok(ids.includes(card.id), 'the card names a real colour row — what the cart adds')

  // The id -> product index ProductsContext builds for the cart must resolve
  // every colour row, so a line saved against any variant finds its product.
  const index = new Map(card.colors.map((c) => [c.id, card]))
  for (const id of ids) assert.equal(index.get(id), card)
})

test("the card advertises the cheapest colour's price and id", () => {
  const cards = groupedCards([
    row('denim-shirt-black', 'tops', 'Denim Shirt - Black', { price: 900 }),
    row('denim-shirt-blue', 'tops', 'Denim Shirt - Blue', { price: 800, compare: 990 }),
  ])
  assert.equal(cards[0].id, 'denim-shirt-blue', 'the card opens on, and carts, the row whose price it shows')
  assert.equal(cards[0].price, 800)
  assert.equal(cards[0].compare, 990)
})

test('when every colour costs the same the first row keeps id and price (as before)', () => {
  const rows = denimShirt()
  const [card] = groupedCards(rows)
  assert.equal(card.id, rows[0].id)
  assert.equal(card.price, rows[0].price)
})

// ---- safety rules ----------------------------------------------------------

test('unrelated designs that share a colour never become one listing', () => {
  const cards = groupedCards([
    row('classic-shirt-black', 'tops', 'Classic Shirt - Black'),
    row('classic-tee-black', 'tops', 'Classic Tee - Black'),
    row('stripes-dress-black', 'dress', 'Stripes Dress - Black'),
  ])
  assert.equal(cards.length, 3, 'a shared colour pools nothing — three designs, three cards')
  // Each lone row still names its own DESIGN: the " - Black" suffix is the
  // catalogue's way of storing the colour, not part of the name the shopper
  // reads, and it never made these three the same product.
  assert.deepEqual(
    cards.map((c) => c.title),
    ['Classic Shirt', 'Classic Tee', 'Stripes Dress'],
  )
  assert.deepEqual(
    cards.map((c) => c.colour),
    ['Black', 'Black', 'Black'],
    'each card still knows which colour it is',
  )
})

test('a single-colourway product shows the design name and still knows its colour', () => {
  const dress = row('denim-dress', 'dress', 'Denim Dress')
  const solo = row('solid-coord-set-red', 'coord', 'Solid Coord set - Red')

  const cards = groupedCards([dress, solo])
  assert.equal(cards.length, 2)
  assert.equal(cards[0].title, 'Denim Dress', 'no colour means no suffix to strip')
  assert.equal(cards[1].title, 'Solid Coord set', 'a lone coloured row still shows the design, not "… - Red"')
  assert.equal(cards[1].colour, 'Red', 'the colour is kept, just not printed after the name')
  assert.equal('colors' in cards[0], false, 'no selector is offered when there is nothing to choose')
  assert.equal('colors' in cards[1], false)
  assert.equal(variantFor(undefined, 'denim-dress'), null, 'the product page then falls back to the product itself')
})

test('a colour that only exists in the title suffix still survives the name losing it', () => {
  // The bundled catalogue predates the `colour` column, so a row can carry its
  // colour nowhere but the title. Stripping the suffix must not take the only
  // copy of it with it — the colour search reads `card.colour`.
  const cards = groupedCards([
    row('solid-coord-set-red', 'coord', 'Solid Coord set - Red', { colour: null }),
  ])
  assert.equal(cards[0].title, 'Solid Coord set')
  assert.equal(cards[0].colour, 'Red')
})

test('products with no colour are never pooled with anything', () => {
  const cards = groupedCards([
    row('korean-pants-biege-jpg', 'tops', 'Korean Pants- Biege'),
    row('denim-dress', 'dress', 'Denim Dress'),
  ])
  assert.equal(cards.length, 2, 'both stay exactly as stored')
  assert.equal(cards[0].title, 'Korean Pants- Biege')
})
