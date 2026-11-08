// The ratings every buying touchpoint shows — cards, the product photo and
// title, the quote beside the buy buttons, the phone buy bar, the cart and the
// checkout — come from published reviews only (src/lib/ratingSummary.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  designIds, designRating, highlightReview, quoteText, ratingAria, ratingText, ratingTotals,
  reviewCountText, shopRating, shortCount, starFills, topRatedFirst,
} from '../src/lib/ratingSummary.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const rows = [
  { product_id: 'dress-pink', rating: 5 },
  { product_id: 'dress-pink', rating: 4 },
  { product_id: 'dress-blue', rating: 5 },
  { product_id: 'top-black', rating: 4 },
  { product_id: 'top-black', rating: 4 },
  { product_id: '', rating: 5 }, // no product: ignored
  { product_id: 'top-black', rating: 0 }, // not a rating: ignored
  { product_id: 'top-black', rating: 9 }, // not a rating: ignored
  null,
]
const totals = ratingTotals(rows)
const dress = { id: 'dress-pink', colors: [{ id: 'dress-pink' }, { id: 'dress-blue' }] }
const top = { id: 'top-black' }
const skirt = { id: 'skirt-new' }

test('a design is rated across all of its colours', () => {
  assert.deepEqual(designIds(dress), ['dress-pink', 'dress-blue'])
  assert.deepEqual(designIds(top), ['top-black'])
  const r = designRating(totals, dress)
  assert.equal(r.count, 3)
  assert.equal(ratingText(r.average), '4.7')
})

test('a design with no published review shows nothing, never "0.0 (0)"', () => {
  assert.equal(designRating(totals, skirt), null)
  assert.equal(designRating(null, dress), null)
})

test('bad rows never move a rating', () => {
  assert.deepEqual(totals.get('top-black'), { sum: 8, count: 2 })
  assert.equal(totals.has(''), false)
})

test('the shop rating is every published review together', () => {
  const s = shopRating(totals)
  assert.equal(s.count, 5)
  assert.equal(ratingText(s.average), '4.4')
  assert.equal(shopRating(new Map()), null)
})

test('numbers read the way shoppers expect', () => {
  assert.equal(ratingText(4.96), '5.0')
  assert.equal(ratingText(7), '5.0')
  assert.equal(reviewCountText(1), '1 review')
  assert.equal(reviewCountText(12), '12 reviews')
  assert.equal(reviewCountText(1500), '1,500 reviews')
  assert.equal(shortCount(999), '999')
  assert.equal(shortCount(1200), '1.2k')
  assert.equal(shortCount(1000), '1k')
  assert.equal(shortCount(15400), '15k')
  assert.equal(ratingAria({ average: 4.75, count: 8 }), 'Rated 4.8 out of 5 from 8 reviews')
})

test('stars fill to the tenth of a star', () => {
  assert.deepEqual(starFills(4.8), [1, 1, 1, 1, 0.8])
  assert.deepEqual(starFills(5), [1, 1, 1, 1, 1])
  assert.deepEqual(starFills(3.25), [1, 1, 1, 0.3, 0])
  assert.deepEqual(starFills(0), [0, 0, 0, 0, 0])
})

test('"Top rated" puts the best-rated first and unrated designs last, in order', () => {
  const unrated2 = { id: 'other' }
  const sorted = topRatedFirst([skirt, top, unrated2, dress], totals)
  assert.deepEqual(sorted.map((p) => p.id), ['dress-pink', 'top-black', 'skirt-new', 'other'])
})

test('equal averages are ranked by more reviews', () => {
  const t = ratingTotals([
    { product_id: 'a', rating: 5 },
    { product_id: 'b', rating: 5 }, { product_id: 'b', rating: 5 },
  ])
  assert.deepEqual(topRatedFirst([{ id: 'a' }, { id: 'b' }], t).map((p) => p.id), ['b', 'a'])
})

test('the quote beside the buttons: highest rating, then verified, then readable, then newest', () => {
  const long = 'x '.repeat(200)
  const reviews = [
    { id: 1, rating: 4, verified: true, body: 'Nice fabric and a good fit overall.', created_at: '2026-11-08' },
    { id: 2, rating: 5, verified: false, body: 'Loved it, beautiful colour and fit.', created_at: '2026-11-08' },
    { id: 3, rating: 5, verified: true, body: long, created_at: '2026-11-07' },
    { id: 4, rating: 5, verified: true, body: 'Soft fabric, true to size, so many compliments.', created_at: '2026-11-06' },
    { id: 5, rating: 5, verified: true, body: '   ', created_at: '2026-11-09' },
  ]
  assert.equal(highlightReview(reviews).id, 4)
  assert.equal(highlightReview([]), null)
  assert.equal(highlightReview([{ rating: 5, body: '' }]), null)
})

test('a long review is cut at a word, with an ellipsis only when cut', () => {
  assert.equal(quoteText('Short and sweet.'), 'Short and sweet.')
  assert.equal(quoteText('Line one\nline two'), 'Line one line two')
  const cut = quoteText('The fabric is soft and breathable, the fit is lovely and the colour is exactly as shown in the photos online', 60)
  assert.ok(cut.endsWith('…'))
  assert.ok(cut.length <= 61)
  assert.ok(!/\s…$/.test(cut))
})

test('no touchpoint reads the numbers typed into the product editor', () => {
  for (const file of ['src/components/ProductCard.jsx', 'src/pages/Product.jsx', 'src/pages/Shop.jsx', 'src/components/StickyBuyBar.jsx']) {
    const src = read(file)
    assert.doesNotMatch(src, /\bp\.rating\b|\bp\.reviews\b|\bb\.rating\b|\ba\.rating\b/, file)
  }
})

test('every buying touchpoint draws the published rating', () => {
  assert.match(read('src/components/ProductCard.jsx'), /useRatings\(\)\.ratingFor\(p\)/)
  const product = read('src/pages/Product.jsx')
  assert.match(product, /<Gallery[^>]*rating=\{rating\}/)
  assert.match(product, /<RatingLine rating=\{rating\}/)
  assert.match(product, /<ReviewHighlight /)
  assert.match(product, /rating=\{rating\}\s+onRating=\{toReviews\}/)
  for (const file of ['src/components/CartDrawer.jsx', 'src/pages/Cart.jsx', 'src/pages/Checkout.jsx']) {
    assert.match(read(file), /<ShopRatingNote /, file)
  }
  assert.match(read('src/components/ReviewsSection.jsx'), /id="reviews"/)
  assert.match(read('src/main.jsx'), /<RatingsProvider>/)
})

test('the ratings read asks for published reviews only, product and stars', () => {
  const store = read('src/lib/reviewStore.js')
  const fn = store.slice(store.indexOf('export async function fetchRatingRows'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))
  assert.match(body, /\.select\('product_id, rating'\)/)
  assert.match(body, /\.eq\('status', 'approved'\)/)
})
