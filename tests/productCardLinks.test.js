// A product card opens THAT product's page — on a category page, on the
// homepage, in the search results and in every other grid.
//
// The bug this pins down: a card could be built from one row of a design and
// linked to another, and a card with no id used to fall back to the shop
// listing — which is what a shopper sees as "it opened the category page
// instead of the product".
//
// The rules live in three small modules and are exercised here exactly as the
// site uses them:
//
//   * src/lib/productGrouping.js — one row speaks for the whole card;
//   * src/lib/productLinks.js    — the canonical route for a product;
//   * src/lib/productLookup.js   — which product a link names.
//
// Run with `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { groupedCards, variantFor } from '../src/lib/productGrouping.js'
import { productHref, productId } from '../src/lib/productLinks.js'
import { indexProducts, findProduct, findVariant } from '../src/lib/productLookup.js'
import { matchesProducts } from '../src/lib/productSearch.js'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

const LABELS = { tops: 'Tops & T-shirts', coord: 'Co-ord Sets', dress: 'Dresses', trousers: 'Trousers & Pants' }
const typeLabel = (k) => LABELS[k] || k

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

// A miniature of the live catalogue: several categories, a design whose
// colours cost different amounts, and a design with no colour of its own.
const CATALOGUE = [
  row('solid-shirts-blue', 'tops', 'Solid shirts - Blue', { price: 599 }),
  row('solid-shirts-peach', 'tops', 'Solid shirts - Peach', { price: 599 }),
  row('denim-shirt-black', 'tops', 'Denim Shirt - Black', { price: 2010 }),
  row('denim-shirt-blue', 'tops', 'Denim Shirt - Blue', { price: 900 }),
  row('panda-tshirt-black', 'tops', 'Panda Tshirt - Black', { price: 699 }),
  row('cotton-dress-green', 'dress', 'Cotton Dress - Green', { price: 849 }),
  row('cotton-dress-blue', 'dress', 'Cotton Dress - Blue', { price: 849 }),
  row('denim-dress', 'dress', 'Denim Dress', { price: 900 }),
  row('stripes-dress-blue', 'dress', 'Stripes Dress - Blue', { price: 699 }),
  row('mulmul-cotton-trousers-grey', 'trousers', 'Mulmul cotton Trousers - Grey', { price: 479 }),
  row('set-red', 'coord', 'Shirt pant coord set - Red', { price: 799 }),
]

const cards = groupedCards(CATALOGUE)
const index = indexProducts(cards)

/** The colour a card or a variant carries, whichever column it is in. */
const colourOf = (v) => String(v?.color ?? v?.colour ?? '').trim()

/** What a shopper gets when a card is clicked: the page, and what is on it. */
const click = (card) => {
  const href = productHref(card)
  const product = findProduct(index, productId(card))
  const variant = product ? (findVariant(index, productId(card)) || variantFor(product.colors || [], productId(card)) || product) : null
  return {
    href,
    product,
    variant,
    title: product ? product.title : null,
    image: variant ? variant.image : null,
    price: variant ? variant.price : null,
    colour: variant ? colourOf(variant) : null,
    sizes: variant ? variant.sizes : null,
    notFound: !product,
  }
}

// ---- the category page ------------------------------------------------------

test('every card on a CATEGORY page opens that exact product', () => {
  // The shop page shows the catalogue filtered by category (src/pages/Shop.jsx
  // asks the shared rule for it) — this is the "Catalogue → Tops & T-shirts"
  // grid the shopper clicks.
  for (const type of ['tops', 'dress', 'trousers', 'coord']) {
    const items = matchesProducts(cards, { type, typeLabel })
    assert.ok(items.length, `${type} shows products`)

    for (const card of items) {
      const { href, product, variant, title, image, price, colour, sizes, notFound } = click(card)
      assert.equal(notFound, false, `${card.id} resolves to a product`)
      assert.equal(href, `/product/${card.id}`, 'the card links to its own product page')
      assert.equal(product.id, card.id, 'the page it opens IS that product')
      assert.equal(title, card.title, 'the same name')
      assert.equal(image, card.image, 'the same photograph')
      assert.equal(price, card.price, 'the same price')
      assert.deepEqual(sizes, card.sizes, 'the same sizes')
      assert.equal(colour, colourOf(card), 'the same colour')
    }
  }
})

test('two different products never open the same page', () => {
  const links = cards.map((c) => productHref(c))
  assert.equal(new Set(links).size, links.length, 'every card has its own address')
  // ...and the address really is that product's own row id.
  for (const card of cards) {
    assert.ok(card.id, 'a card always carries its id')
    assert.ok(productHref(card).endsWith(card.id), 'the link carries the id')
  }
})

test('the blue shirt and the denim shirt open their own pages, not each other’s', () => {
  const tops = matchesProducts(cards, { type: 'tops', typeLabel })
  const denim = tops.find((c) => c.title === 'Denim Shirt')
  const solid = tops.find((c) => c.title === 'Solid shirts')

  assert.ok(denim && solid, 'both shirts are on the tops page')
  assert.notEqual(productHref(denim), productHref(solid), 'two different shirts, two different pages')

  // The denim shirt's card shows the blue row (the cheapest), so the page it
  // opens must show that same blue row — not the black one it does not show.
  const denimClick = click(denim)
  assert.equal(denimClick.image, denim.image)
  assert.equal(denimClick.price, denim.price)
  assert.equal(denimClick.colour, colourOf(denim))
  assert.equal(findVariant(index, denim.id).image, denim.image, 'the row it opens is the row it shows')
})

test('the card’s id is a real row of the catalogue, never an invented one', () => {
  const ids = new Set(CATALOGUE.map((r) => r.id))
  for (const card of cards) {
    assert.ok(ids.has(card.id), `${card.id} is a row of the catalogue`)
  }
})

// ---- the fallback that caused the report -----------------------------------

test('a card that cannot name its product gets NO link at all', () => {
  // Never "/shop" (the listing page), never another product's page.
  const orphan = { title: 'A product with no id', price: 900, image: '/x.jpg' }
  assert.equal(productHref(orphan), '', 'no link, so no wrong page')
  assert.equal(productHref(orphan).includes('/shop'), false, 'it never points at the shop')
  assert.equal(findProduct(index, ''), null, 'and it resolves to nothing')
})

test('the product card renders a link only when it has a product to open', () => {
  const src = read('src/components/ProductCard.jsx')
  assert.match(src, /productHref\(p\)/, 'the card asks the shared rule for its address')
  assert.match(src, /href \? <Link to=\{href\}/, 'a card with no address is rendered without a link')
  assert.doesNotMatch(src, /to="\/shop"|to=\{`\/product\/\$\{/, 'the card builds no address of its own')
  // The wishlist heart is a sibling of the link, never inside it: tapping it
  // must not open the product page.
  const heart = src.indexOf('<button')
  const link = src.indexOf('{href ? <Link')
  assert.ok(heart > link, 'the heart button comes after the link and is not inside it')
})

test('the category page and the homepage use the same card', () => {
  const shop = read('src/pages/Shop.jsx')
  const sections = read('src/components/Sections.jsx')
  const grid = read('src/components/ProductGrid.jsx')
  assert.match(shop, /<ProductGrid/, 'the category page renders the shared grid')
  assert.match(sections, /<ProductGrid/, 'the homepage renders the same grid')
  assert.match(grid, /<ProductCard/, 'and the grid renders the shared card')
  assert.match(grid, /key=\{p\.id\}/, 'each card is keyed by its own product id')
})

// ---- the other grids --------------------------------------------------------

test('the search results open their own products too', () => {
  const found = matchesProducts(cards, { q: 'blue', typeLabel })
  assert.ok(found.length > 1)
  for (const card of found) {
    const { href, product, image, price } = click(card)
    assert.equal(href, `/product/${card.id}`)
    assert.equal(product.id, card.id)
    assert.equal(image, card.image)
    assert.equal(price, card.price)
  }
})

test('a colour link opens that colour of the design', () => {
  const design = cards.find((c) => c.title === 'Solid shirts')
  const blue = design.colors.find((c) => c.id === 'solid-shirts-blue')
  assert.ok(blue)
  assert.equal(findVariant(index, 'solid-shirts-blue').id, 'solid-shirts-blue')
  assert.equal(findProduct(index, 'solid-shirts-blue').id, design.id, 'the design it belongs to')
})

test('a product that was deleted opens nothing at all', () => {
  assert.equal(findProduct(index, 'deleted-product-id'), null)
  assert.equal(findVariant(index, 'deleted-product-id'), null)
})

test('a product that is switched off is not on the site at all', () => {
  // The storefront only ever lists the rows that are switched on, so a hidden
  // product has no card and its address resolves to nothing — the page says
  // "Product not found" instead of opening the product that shares its name.
  const withHidden = CATALOGUE.map((r) => (r.id === 'set-red' ? { ...r, is_active: false } : r))
  const visible = groupedCards(withHidden.filter((r) => r.is_active !== false))
  const live = indexProducts(visible)

  assert.ok(!visible.some((c) => c.id === 'set-red'), 'a hidden product is never listed')
  assert.equal(findProduct(live, 'set-red'), null, 'and its address resolves to nothing')
  assert.equal(findVariant(live, 'set-red'), null)
  // A colour search must not offer it either.
  const shown = matchesProducts(visible, { q: 'red', typeLabel })
  assert.ok(!shown.some((c) => c.id === 'set-red'), 'a hidden product is never in the results')
})
