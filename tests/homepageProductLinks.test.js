// Every product card on the homepage opens ITS OWN product.
//
// The bug this pins down: the storefront built a card from TWO different rows
// of the same design. The photograph, the gallery and the sizes came from the
// group's FIRST row, while the id and the price came from the CHEAPEST row —
// so a design whose colours cost different amounts showed one colour's
// photograph and opened another. The live "Denim Shirt" card showed the black
// shirt and opened the blue one, and the price on the card was the blue
// shirt's.
//
// The rule now lives in one place:
//
//   * src/lib/productGrouping.js  — one row speaks for the whole card;
//   * src/lib/productLinks.js     — the canonical route for a product;
//   * src/lib/productLookup.js    — which product a link names.
//
// Run with `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { groupedCards, variantFor } from '../src/lib/productGrouping.js'
import { productHref, productId } from '../src/lib/productLinks.js'
import { indexProducts, findProduct, findVariant } from '../src/lib/productLookup.js'
import { derivedBestsellers } from '../src/lib/bestsellerRules.js'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

// A row in the shape ProductsContext.toProduct produces.
const row = (id, type, title, extra = {}) => ({
  id,
  type,
  title,
  price: 900,
  compare: null,
  image: `/images/products/${id}.jpg`,
  hover: null,
  gallery: [`/images/products/${id}.jpg`],
  badge: null,
  sizes: ['S', 'M', 'L', 'XL'],
  desc: '',
  colour: title.includes(' - ') ? title.slice(title.lastIndexOf(' - ') + 3) : null,
  is_active: true,
  ...extra,
})

// ---- the card and the product it opens are the same product ----------------

test('a card opens exactly the product it shows', () => {
  // The live Denim Shirt: the black shirt costs more than the blue one.
  const [card] = groupedCards([
    row('denim-shirt-black', 'tops', 'Denim Shirt - Black', { price: 2010, image: '/black.jpg' }),
    row('denim-shirt-blue', 'tops', 'Denim Shirt - Blue', { price: 900, image: '/blue.jpg' }),
  ])

  assert.equal(card.id, 'denim-shirt-blue', 'the card still opens the cheapest colour')
  assert.equal(card.price, 900)

  // The photograph on the card is the photograph of the row it opens.
  const opened = variantFor(card.colors, card.id)
  assert.equal(opened.id, card.id)
  assert.equal(card.image, opened.image, 'the card shows the photo of the row it opens')
  assert.equal(card.price, opened.price, 'and the price it shows is that row’s price')
  assert.deepEqual(card.sizes, opened.sizes, 'and the sizes it shows are that row’s sizes')
})

test('the card’s gallery and hover image belong to the row it opens too', () => {
  const [card] = groupedCards([
    row('a-black', 'tops', 'Blouse - Black', { price: 1200, image: '/black.jpg', hover: '/black-2.jpg', gallery: ['/black.jpg', '/black-2.jpg'], sizes: ['S', 'M'] }),
    row('a-white', 'tops', 'Blouse - White', { price: 800, image: '/white.jpg', hover: '/white-2.jpg', gallery: ['/white.jpg', '/white-2.jpg'], sizes: ['L', 'XL'] }),
  ])

  const opened = variantFor(card.colors, card.id)
  assert.equal(card.id, 'a-white')
  assert.equal(card.image, '/white.jpg')
  assert.equal(card.hover, '/white-2.jpg')
  assert.deepEqual(card.gallery, ['/white.jpg', '/white-2.jpg'])
  assert.deepEqual(card.sizes, ['L', 'XL'])
  assert.equal(opened.image, card.image)
  assert.deepEqual(opened.sizes, card.sizes)
})

test('every card names a real row of its own design', () => {
  const cards = groupedCards([
    row('x-black', 'tops', 'Blouse - Black', { price: 1200 }),
    row('x-white', 'tops', 'Blouse - White', { price: 800 }),
    row('solo', 'dress', 'Denim Dress'),
  ])
  for (const card of cards) {
    const ids = (card.colors || []).map((c) => c.id)
    if (!ids.length) {
      // A design with one row (or no colour at all) is the row itself.
      assert.ok(card.id, 'a card always carries an id')
      continue
    }
    assert.ok(ids.includes(card.id), `${card.id} is one of its own rows`)
  }
})

test('a design’s badge survives whichever row speaks for the card', () => {
  const [card] = groupedCards([
    row('b-black', 'tops', 'Blouse - Black', { price: 1200, badge: 'Bestseller' }),
    row('b-white', 'tops', 'Blouse - White', { price: 800 }),
  ])
  assert.equal(card.badge, 'Bestseller')
})

// ---- the link ---------------------------------------------------------------

test('a product links to its own canonical route', () => {
  const [card] = groupedCards([
    row('denim-shirt-black', 'tops', 'Denim Shirt - Black', { price: 2010 }),
    row('denim-shirt-blue', 'tops', 'Denim Shirt - Blue', { price: 900 }),
  ])
  assert.equal(productHref(card), '/product/denim-shirt-blue')
  assert.equal(productId(card), 'denim-shirt-blue')
})

test('a product with no id has no page of its own — it never points at another product', () => {
  assert.equal(productHref({ id: '' }), '/shop')
  assert.equal(productHref(null), '/shop')
  assert.equal(productHref(undefined), '/shop')
  assert.equal(productId({}), '')
})

// ---- which product a link names --------------------------------------------

test('a link names a design, and a colour row opens that colour', () => {
  const cards = groupedCards([
    row('shirt-black', 'tops', 'Denim Shirt - Black', { price: 1200, image: '/black.jpg' }),
    row('shirt-blue', 'tops', 'Denim Shirt - Blue', { price: 900, image: '/blue.jpg' }),
  ])
  const index = indexProducts(cards)

  assert.equal(findProduct(index, 'shirt-blue').id, 'shirt-blue')
  assert.equal(findVariant(index, 'shirt-blue').image, '/blue.jpg', 'the blue row, not the first one')
  assert.equal(findVariant(index, 'shirt-black').image, '/black.jpg')
})

test('a deleted or hidden product resolves to NOTHING — never to another product', () => {
  const cards = groupedCards([
    row('shirt-black', 'tops', 'Denim Shirt - Black'),
    row('shirt-blue', 'tops', 'Denim Shirt - Blue'),
  ])
  const index = indexProducts(cards)

  // A colour row that has since been deleted: neither the row nor a design
  // under that name is in the catalogue any more.
  assert.equal(findProduct(index, 'shirt-green'), null, 'an id that is gone resolves to nothing')
  assert.equal(findVariant(index, 'shirt-green'), null)
  assert.equal(findProduct(index, ''), null)
  assert.equal(findProduct(index, undefined), null)
})

test('the product page says “not found” instead of opening a different product', () => {
  const src = read('src/pages/Product.jsx')
  assert.match(src, /Product not found/, 'a product that cannot be resolved is reported')
  assert.match(src, /if \(!p\)/, 'and the page stops there')
  // The page must never fall back to "the first product in the list".
  assert.doesNotMatch(src, /products\[0\]/, 'no product is ever substituted for a missing one')
})

// ---- the homepage's own rows ----------------------------------------------

test('every product the homepage shows opens its own product', () => {
  // A miniature of the live catalogue: several categories, several colours,
  // and one design whose colours cost different amounts.
  const rows = [
    row('denim-shirt-black', 'tops', 'Denim Shirt - Black', { price: 2010 }),
    row('denim-shirt-blue', 'tops', 'Denim Shirt - Blue', { price: 900 }),
    row('stripes-dress-blue', 'dress', 'Stripes Dress - Blue'),
    row('stripes-dress-pink', 'dress', 'Stripes Dress - Pink'),
    row('pants-black', 'trousers', 'Korean Cargos - Black'),
    row('set-red', 'coord', 'Shirt pant coord set - Red'),
  ]
  const cards = groupedCards(rows)
  const index = indexProducts(cards)

  const homepage = derivedBestsellers(cards, ['tops', 'dress', 'trousers', 'coord'])
  assert.ok(homepage.length > 1, 'the homepage row has products in it')

  for (const card of homepage) {
    const href = productHref(card)
    assert.match(href, /^\/product\//, 'a homepage card links to a product page')

    // The link names the very product the card shows.
    const opened = findProduct(index, card.id)
    assert.ok(opened, `${card.id} resolves to a product`)
    assert.equal(opened.id, card.id)
    assert.equal(opened.title, card.title, 'the same design, not another one')
    assert.equal(opened.image, card.image, 'the same photograph')
    assert.equal(opened.price, card.price, 'the same price')

    // And the page it opens shows that product's own sizes and colour.
    const variant = variantFor(opened.colors || [], opened.id)
    if (variant) {
      assert.deepEqual(variant.sizes, opened.sizes)
      assert.equal(variant.price, opened.price)
    }
  }
})

test('two different homepage products never share a link', () => {
  const cards = groupedCards([
    row('denim-shirt-black', 'tops', 'Denim Shirt - Black', { price: 2010 }),
    row('denim-shirt-blue', 'tops', 'Denim Shirt - Blue', { price: 900 }),
    row('stripes-dress-blue', 'dress', 'Stripes Dress - Blue'),
    row('pants-black', 'trousers', 'Korean Cargos - Black'),
  ])
  const links = cards.map((c) => productHref(c))
  assert.equal(new Set(links).size, links.length, 'every card has its own address')
})

// ---- the components use that one rule --------------------------------------

test('every product link on the site is built by the shared rule', () => {
  for (const file of ['src/components/ProductCard.jsx', 'src/components/Sections.jsx', 'src/components/SearchBar.jsx']) {
    const src = read(file)
    assert.match(src, /productHref/, `${file} links through src/lib/productLinks.js`)
    assert.doesNotMatch(src, /`\/product\/\$\{/, `${file} builds no link of its own`)
  }
})

test('the homepage’s product grids all use the same card', () => {
  const sections = read('src/components/Sections.jsx')
  // The Best Sellers row and the review cards both render catalogue cards.
  assert.match(sections, /<ProductGrid/, 'the Best Sellers row renders the shared card grid')
  assert.match(sections, /productHref\(shown\)/, 'a review card links to the product it shows')
})
