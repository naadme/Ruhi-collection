// Issue 3 — "the homepage carousel image must open the exact matching product."
//
// The hero slides two kinds of photograph: the banners the owner saved, each
// with the destination she chose for it, and — still on the END of the list so
// the arrows never disappear — the category photographs the store has always
// slid between (src/lib/heroSlider.js).
//
// A category photograph is very often a product's photograph. What it must
// never do is GUESS which product. The rule this pins down: a slide is sent to
// a product only when some row of the catalogue OWNS the photograph, and
// otherwise it keeps the destination the tile already had — the category page.
// It used to fall back to "the first product in the category", which invented
// a destination out of catalogue order: four of the five slides on the live
// shop pointed at a product that had nothing to do with the picture clicked.
//
// Run with `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { heroFallbackSlides, photoIndex, photoKey } from '../src/lib/heroLinks.js'
import { heroSlides } from '../src/lib/heroSlider.js'
import { productHref } from '../src/lib/productLinks.js'
import { groupedCards } from '../src/lib/productGrouping.js'
import { stockedCategoryTiles } from '../src/lib/categoryTiles.js'
import { missingImports } from './helpers/imports.mjs'

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8')
const HERO = read('src/components/Sections.jsx')
const RULES = read('src/lib/heroLinks.js')

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
  colour: title.includes(' - ') ? title.slice(title.lastIndexOf(' - ') + 3) : null,
  is_active: true,
  ...extra,
})

// A tile in the shape categoryTiles produces: the category's own page.
const tile = (key, image) => ({ key, label: key, image, to: `/shop?type=${key}` })

// A miniature of the live shop: two categories, one design with two colours,
// and one product with a second photograph in its gallery.
const catalogue = () => groupedCards([
  row('denim-shirt-black', 'tops', 'Denim Shirt - Black', { price: 1200, image: '/shirt-black.jpg', hover: '/shirt-black-2.jpg', gallery: ['/shirt-black.jpg', '/shirt-black-2.jpg'] }),
  row('denim-shirt-blue', 'tops', 'Denim Shirt - Blue', { price: 900, image: '/shirt-blue.jpg', gallery: ['/shirt-blue.jpg'] }),
  row('stripes-dress-pink', 'dress', 'Stripes Dress - Pink', { image: '/dress-pink.jpg', gallery: ['/dress-pink.jpg'] }),
  row('stripes-dress-blue', 'dress', 'Stripes Dress - Blue', { price: 1200, image: '/dress-blue.jpg', gallery: ['/dress-blue.jpg'] }),
])

// ---- which photograph belongs to which row ----------------------------------

test('every photograph a product owns is indexed, not just its main image', () => {
  // The old rule only asked for the card's main image and its colours' main
  // images. The SECOND photograph of a gallery resolved to nothing, and the
  // slide then fell through to the guess.
  const index = photoIndex(catalogue())
  assert.equal(index.get('/shirt-black.jpg').row.id, 'denim-shirt-black')
  assert.equal(index.get('/shirt-black-2.jpg').row.id, 'denim-shirt-black',
    'a hover image is a photograph of that product too')
  assert.equal(index.get('/shirt-blue.jpg').row.id, 'denim-shirt-blue')
  assert.equal(index.size, 5, 'five photographs across four colour rows')
})

test('the key two photographs are compared by is forgiving, never invented', () => {
  assert.equal(photoKey('/a b.jpg'), '/a b.jpg')
  assert.equal(photoKey('  /a.jpg  '), '/a.jpg')
  assert.equal(photoKey('/a.jpg?width=200'), '/a.jpg', 'a query string is not a different photograph')
  assert.equal(photoKey('/a.jpg#top'), '/a.jpg')
  assert.equal(photoKey('/a%20b.jpg'), '/a b.jpg', 'and the same file written two ways is one file')
  assert.equal(photoKey(''), '', 'an empty photograph matches nothing')
  assert.equal(photoKey(null), '')
  assert.equal(photoKey(undefined), '')
  assert.equal(photoKey(42), '')
})

test('a photograph two products somehow share always resolves the same way', () => {
  const cards = groupedCards([
    row('a', 'tops', 'Shirt - Black', { image: '/same.jpg' }),
    row('b', 'dress', 'Dress - Black', { image: '/same.jpg' }),
  ])
  const index = photoIndex(cards)
  assert.equal(index.get('/same.jpg').product.id, 'a', 'the first owner wins, every time')
})

// ---- a slide points at the product it shows ---------------------------------

test('a slide whose photograph is a product’s own opens that product', () => {
  const cards = catalogue()
  const [slide] = heroFallbackSlides([tile('tops', '/shirt-black.jpg')], cards)
  assert.equal(slide.to, productHref({ id: 'denim-shirt-black' }))
  assert.equal(slide.to, '/product/denim-shirt-black')
})

test('a slide whose photograph is a COLOUR’s opens that colour', () => {
  // The design card speaks for both shirts, and its id opens the cheapest
  // one — the blue. But the photograph clicked was the black one, so the
  // slide must open the black one, on its own row.
  const cards = catalogue()
  assert.equal(cards[0].id, 'denim-shirt-blue', 'the card speaks for the cheaper colour')
  const [slide] = heroFallbackSlides([tile('tops', '/shirt-black.jpg')], cards)
  assert.equal(slide.to, '/product/denim-shirt-black', 'not the card — the colour that was photographed')
  const [other] = heroFallbackSlides([tile('dress', '/dress-blue.jpg')], cards)
  assert.equal(other.to, '/product/stripes-dress-blue', 'the other colour of the other design')
})

test('a slide never picks the first product in a category', () => {
  // The photograph is the blue dress's, but the category's first product is
  // the pink one. It used to open the pink one.
  const cards = catalogue()
  const first = cards.find((p) => p.type === 'dress')
  assert.equal(first.id, 'stripes-dress-pink', 'catalogue order really does put the pink dress first')
  const [slide] = heroFallbackSlides([tile('dress', '/dress-blue.jpg')], cards)
  assert.notEqual(slide.to, productHref(first), 'and the slide does not go there')
  assert.equal(slide.to, '/product/stripes-dress-blue')
})

test('a photograph that belongs to no product keeps the category page', () => {
  // The owner uploaded her own picture for Tops — it is not any product's
  // photograph, and there is no honest way to guess which product it shows.
  // So the slide stays where the tile always pointed: the category page.
  const cards = catalogue()
  const [slide] = heroFallbackSlides([tile('tops', '/owner-own-tops-photo.jpg')], cards)
  assert.equal(slide.to, '/shop?type=tops')
  assert.equal(slide.key, 'tops')
  assert.equal(slide.label, 'tops', 'the tile is otherwise untouched')
  assert.equal(slide.image, '/owner-own-tops-photo.jpg')
})

test('the live shop’s four custom category photographs land on their categories', () => {
  // Reproduced from the catalogue the client actually has: four categories
  // with photographs she uploaded herself, which belong to no product row.
  const cards = catalogue()
  const tiles = [
    tile('tops', '/category/owner-tops.jpg'),
    tile('dress', '/category/owner-dress.jpg'),
    tile('trousers', '/category/owner-trousers.jpg'),
    tile('coord', '/category/owner-coord.jpg'),
  ]
  const slides = heroFallbackSlides(tiles, cards)
  assert.deepEqual(slides.map((s) => s.to), [
    '/shop?type=tops', '/shop?type=dress', '/shop?type=trousers', '/shop?type=coord',
  ])
})

test('a category with no photograph of its own still opens its product', () => {
  // `winter-wear` has no uploaded photograph, so its tile falls back to the
  // first product photo in the category — and that photograph DOES belong to a
  // product, so the slide opens it. This is the one case where the old rule
  // and the new one agree, and it must stay working.
  const cards = groupedCards([
    row('furr-nightsuit-dark-brown', 'winter-wear', 'Furr Nightsuit', { image: '/furr.jpg', gallery: ['/furr.jpg'] }),
  ])
  const tiles = [tile('winter-wear', '/furr.jpg')]
  const [slide] = heroFallbackSlides(tiles, cards)
  assert.equal(slide.to, '/product/furr-nightsuit-dark-brown')
})

// ---- what must never happen -------------------------------------------------

test('a slide always names a product a shopper can actually open', () => {
  // Whatever the photograph, the destination is either a product route built
  // from a real row's own id, or the category page. Never a product invented
  // from catalogue order, and never a blank link.
  const cards = catalogue()
  const tiles = [
    tile('tops', '/shirt-black.jpg'),
    tile('tops', '/shirt-blue.jpg'),
    tile('dress', '/dress-pink.jpg'),
    tile('dress', '/dress-blue.jpg'),
    tile('dress', '/not-anywhere.jpg'),
    { key: 'coord', label: 'coord', image: null, to: '/shop?type=coord' },
    { key: 'trousers', label: 'trousers', image: undefined, to: '/shop?type=trousers' },
  ]
  for (const slide of heroFallbackSlides(tiles, cards)) {
    assert.ok(slide.to, `${slide.key} has a destination`)
    if (slide.to.startsWith('/product/')) {
      const id = slide.to.slice('/product/'.length)
      assert.ok(cards.some((p) => p.id === id || (p.colors || []).some((c) => c.id === id)),
        `${slide.to} names a product the catalogue really holds`)
    } else {
      assert.match(slide.to, /^\/shop\?type=/, `${slide.to} is the category page`)
    }
  }
})

test('a missing catalogue or a missing tile is never a crash', () => {
  assert.deepEqual(
    heroFallbackSlides([tile('tops', '/shirt-black.jpg')], []),
    [{ key: 'tops', image: '/shirt-black.jpg', to: '/shop?type=tops', label: 'tops' }],
    'no products: no owner, so the tile keeps the category page',
  )
  assert.deepEqual(heroFallbackSlides(undefined, catalogue()), [])
  assert.deepEqual(heroFallbackSlides([null, undefined], catalogue()), [])
  assert.deepEqual(photoIndex(undefined).size, 0)
  assert.deepEqual(photoIndex([]).size, 0)
  assert.deepEqual(heroFallbackSlides([{ key: 'x', image: '/shirt-black.jpg' }], catalogue())[0].to,
    '/product/denim-shirt-black', 'a tile with no `to` is still rescued by a real owner')
})

test('the guess is gone from the rule itself', () => {
  // The exact line that invented a destination — "if the photograph matches
  // nothing, take the first product in the category" — must not come back.
  assert.doesNotMatch(RULES, /p\?\.type === /, 'no category-order lookup')
  assert.doesNotMatch(RULES, /find\(\(p\) => p\?\.type/, 'no "first product in the category"')
  assert.doesNotMatch(RULES, /\[0\]/, 'nothing takes the first of anything')
  // And the component that used to hold a copy of the rule no longer does.
  assert.doesNotMatch(HERO, /products\.find\(/, 'Sections.jsx resolves nothing on its own')
  assert.doesNotMatch(HERO, /p\?\.type === c\.key/, 'and keeps no category guess of its own')
})

// ---- the whole hero, end to end ---------------------------------------------

test('every slide of the real homepage resolves to a page that exists', () => {
  // The live shop's own shape, put through the same two functions the
  // homepage runs: tiles → slides → heroSlides.
  const categories = [
    { key: 'tops', label: 'Tops', image: '/category/owner-tops.jpg', image_active: true },
    { key: 'dress', label: 'Dress', image: '/dress-blue.jpg', image_active: true },
    { key: 'winter-wear', label: 'Winter Wear', image: null, image_active: true },
    { key: 'coord', label: 'Coord', image: '/category/owner-coord.jpg', image_active: true },
  ]
  const products = groupedCards([
    ...catalogue().flatMap((p) => p.colors || [p]),
    row('furr-nightsuit-dark-brown', 'winter-wear', 'Furr Nightsuit', { image: '/furr.jpg', gallery: ['/furr.jpg'] }),
    row('acid-wash-coord-set-brown', 'coord', 'Acid wash coord set', { image: '/acid.jpg', gallery: ['/acid.jpg'] }),
  ])
  // `coord` has a photograph the owner uploaded herself — it belongs to no
  // product, and there are coord products in the catalogue to wrongly guess
  // at. That is exactly the shape of the bug.
  const tiles = stockedCategoryTiles(categories, products)
  const banners = [
    { id: 'b1', image: '/banner-1.jpg', link: '/shop?type=dress', is_active: true },
    { id: 'b2', image: '/banner-2.jpg', link: '/product/denim-shirt-blue', is_active: true },
    { id: 'b3', image: '/banner-3.jpg', link: '', is_active: false },
  ]
  const slides = heroSlides(banners, heroFallbackSlides(tiles, products))

  assert.equal(slides.length, 6, 'two banners plus four categories, so the arrows always have somewhere to go')
  assert.deepEqual(slides.map((s) => s.to), [
    '/shop?type=dress',                    // the owner's own destination, kept
    '/product/denim-shirt-blue',           // the owner's own destination, kept
    '/shop?type=tops',                     // her own Tops photograph: the category page
    '/product/stripes-dress-blue',         // the Dress tile shows the BLUE dress, so the blue dress
    '/product/furr-nightsuit-dark-brown',  // Winter Wear has no photograph, so its product's
    '/shop?type=coord',                    // her own Coord photograph: NOT the acid wash set
  ])
  // The hidden banner is not a slide, and every slide opens somewhere real.
  for (const slide of slides) {
    assert.ok(slide.to, 'every slide opens somewhere')
  }
})

test('the hero resolves its slides through the shared rule and nothing else', () => {
  assert.match(HERO, /heroFallbackSlides\(/, 'Sections.jsx asks src/lib/heroLinks.js')
  assert.match(HERO, /heroSlides\(/, 'and src/lib/heroSlider.js for the order')
  assert.doesNotMatch(HERO, /productHref\(product\)/, 'it names no product of its own')
})

test('the hero imports every name it uses', () => {
  // A missing import builds cleanly — a bundler reads an unknown identifier as
  // a global — and passes any test that only greps for the CALL. The homepage
  // then dies behind its error boundary, with the build green and the tests
  // green. This is how `heroFallbackSlides` once shipped without its import.
  const missing = missingImports(HERO, [
    'heroFallbackSlides', 'heroSlides', 'bannerPositionStyle',
    'stockedCategoryTiles', 'fetchHomeBanners',
  ])
  assert.deepEqual(missing, [], `Sections.jsx uses but does not import: ${missing.join(', ')}`)
})

test('the import check itself catches a missing import, and nothing else', () => {
  // The check above is only worth as much as this: it must fire on the exact
  // mistake that shipped, and stay quiet on the two things that look like uses
  // but are not — a comment naming the module, and an import path.
  const good = HERO
  const broken = HERO.replace("import { heroFallbackSlides } from '../lib/heroLinks'\n", '')
  assert.deepEqual(missingImports(broken, ['heroFallbackSlides']), ['heroFallbackSlides'],
    'the original bug is caught')
  assert.deepEqual(missingImports(good, ['heroFallbackSlides']), [],
    'and the fix is not reported')

  const commented = `// the rule lives in src/lib/heroLinks.js\nconsole.log(1)\n`
  assert.deepEqual(missingImports(commented, ['heroLinks']), [],
    'a comment that names a module is not a use of it')

  const imported = `import { a } from './b.js'\nimport c from './c.js'\nuse(a, c)\n`
  assert.deepEqual(missingImports(imported, ['a', 'c']), [],
    'both named and default imports are seen')

  const template = 'const s = `heroFallbackSlides here`\n'
  assert.deepEqual(missingImports(template, ['heroFallbackSlides']), [],
    'a name inside a string is not code')
})
