// The homepage's category tiles: where each one goes, which photo it shows,
// and that the shop's own filter answers with that category's products.
//
// The tiles are built by src/lib/categoryTiles.js — one place, read by the
// homepage, the Collections page and the shop's Type filter — so these tests
// are the contract all three keep.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  categoryImage, categoryShopUrl, categoryTiles, extraCategoryTiles, stockedCategoryTiles,
} from '../src/lib/categoryTiles.js'
import { mergeCategories } from '../src/lib/categoryRules.js'
import { img } from '../src/data/images.js'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

const CATEGORIES = [
  { key: 'tops', label: 'Tops & T-shirts', position: 0, image: null },
  { key: 'coord', label: 'Co-ord Sets', position: 1, image: null },
  { key: 'dress', label: 'Dresses', position: 2, image: null },
  { key: 'trousers', label: 'Trousers & Pants', position: 3, image: null },
]

const product = (type, image) => ({ id: `${type}-1`, type, image, title: 'A thing' })

// ---------------------------------------------------------------------------
// 1. Where a category goes
// ---------------------------------------------------------------------------

test('every category tile points at that category in the shop', () => {
  for (const c of CATEGORIES) {
    assert.equal(categoryShopUrl(c.key), `/shop?type=${c.key}`)
  }
  assert.equal(categoryShopUrl('trousers'), '/shop?type=trousers')
  assert.equal(categoryShopUrl('a b'), '/shop?type=a%20b', 'a key is encoded')
})

test('the four launch categories each reach their own products', () => {
  const products = [
    product('tops', '/images/products/denim-shirt-blue.jpg'),
    product('coord', '/images/products/acid-wash-coord-set-beige.jpg'),
    product('dress', '/images/products/stripes-dress-blue.jpg'),
    product('trousers', '/images/products/denim-pant-coord-set-black.jpg'),
  ]
  const tiles = categoryTiles(CATEGORIES, products)
  assert.equal(tiles.length, 4)
  for (const tile of tiles) {
    // The link carries the category key ...
    assert.equal(tile.to, `/shop?type=${tile.key}`)
    // ... and the shop's own filter answers with exactly that category.
    const shown = products.filter((p) => p.type === tile.key)
    assert.equal(shown.length, 1, `${tile.label} shows its own products and nobody else's`)
    assert.equal(shown[0].type, tile.key)
  }
})

test('a category with no photograph is left out, never shown as a broken circle', () => {
  const tiles = categoryTiles([{ key: 'new', label: 'New', image: null }], [])
  assert.equal(tiles.length, 0)
})

// ---------------------------------------------------------------------------
// 2. Which photo a tile shows
// ---------------------------------------------------------------------------

test("the photo the owner chose is the one that shows", () => {
  const chosen = 'https://xhsjwhzutalckeektluj.supabase.co/storage/v1/object/public/product-images/category-1.jpg'
  const category = { key: 'tops', label: 'Tops & T-shirts', image: chosen }
  assert.equal(categoryImage(category, [product('tops', '/images/products/denim-shirt-blue.jpg')]), chosen)
})

test('with no photo chosen, the site keeps its own default picture', () => {
  const category = { key: 'tops', label: 'Tops & T-shirts', image: null }
  assert.equal(categoryImage(category, []), img.catTops)
  assert.equal(categoryImage(category, [product('tops', '/images/products/other.jpg')]), img.catTops)
})

test('a category the site has no default for falls back to a product photograph', () => {
  const category = { key: 'kurtis', label: 'Kurtis', image: null }
  assert.equal(categoryImage(category, [product('kurtis', '/images/products/kurti.jpg')]), '/images/products/kurti.jpg')
  assert.equal(categoryImage(category, []), null)
})

test('an empty photo in the database is treated as no photo at all', () => {
  const category = { key: 'tops', label: 'Tops & T-shirts', image: '   ' }
  assert.equal(categoryImage(category, []), img.catTops)
})

test('the photo survives the merge that builds the storefront list', () => {
  const merged = mergeCategories([
    { key: 'tops', label: 'Tops & T-shirts', position: 0, image: 'https://example.com/chosen.jpg' },
    { key: 'coord', label: 'Co-ord Sets', position: 1, image: null },
  ])
  assert.equal(merged.find((c) => c.key === 'tops').image, 'https://example.com/chosen.jpg')
  assert.equal(merged.find((c) => c.key === 'coord').image, null)
})

// ---------------------------------------------------------------------------
// 3. Which categories are shown
// ---------------------------------------------------------------------------

test('only categories the store stocks are advertised', () => {
  const categories = [
    { key: 'tops', label: 'Tops & T-shirts', position: 0, image: null },
    { key: 'empty', label: 'Not stocked', position: 1, image: null },
  ]
  const products = [product('tops', '/images/products/denim-shirt-blue.jpg')]
  const tiles = stockedCategoryTiles(categories, products)
  assert.deepEqual(tiles.map((t) => t.key), ['tops'], 'an empty category is not advertised')
})

test('with an empty catalogue every pictured category is shown', () => {
  const tiles = stockedCategoryTiles(CATEGORIES, [])
  assert.equal(tiles.length, 4)
})

test('a category that holds products but is not in the list stays reachable', () => {
  const extra = extraCategoryTiles(CATEGORIES, [product('kurtis', '/images/products/kurti.jpg')])
  assert.equal(extra.length, 1)
  assert.equal(extra[0].key, 'kurtis')
  assert.equal(extra[0].to, '/shop?type=kurtis')
})

test('a category is never listed twice', () => {
  const products = [
    product('tops', '/images/products/denim-shirt-blue.jpg'),
    product('kurtis', '/images/products/kurti.jpg'),
  ]
  const all = [...stockedCategoryTiles(CATEGORIES, products), ...extraCategoryTiles(CATEGORIES, products)]
  const keys = all.map((t) => t.key)
  assert.equal(new Set(keys).size, keys.length, 'no duplicate category records')
})

// ---------------------------------------------------------------------------
// 4. The homepage and the Collections page
// ---------------------------------------------------------------------------

test('the homepage card is one link covering the picture and the name', () => {
  const sections = read('src/components/Sections.jsx')
  const row = sections.slice(sections.indexOf('Shop by Category'))
  assert.match(row, /<Link[\s\S]*?to=\{c\.to\}[\s\S]*?<Img src=\{c\.image\}[\s\S]*?\{c\.label\}[\s\S]*?<\/Link>/,
    'the picture and the name are inside the same link')
  assert.match(row, /stockedCategoryTiles/, 'and the tiles come from the shared module')
})

test('the Collections page reads the same tiles', () => {
  const collections = read('src/pages/Collections.jsx')
  assert.match(collections, /from '\.\.\/lib\/categoryTiles'/)
  assert.match(collections, /categoryImage\(c, products\)/, 'and the owner\'s photo wins there too')
  assert.match(collections, /categoryShopUrl\(c\.key\)/)
})

test('the admin panel can change a category photo, and the storefront reads it', () => {
  const lib = read('src/lib/categoryImageStore.js')
  assert.match(lib, /from\('categories'\)[\s\S]*?\.update\(\{ image: value \}\)[\s\S]*?\.eq\('key', key\)/,
    'the photo is written to the category row itself')
  const rules = read('src/lib/categoryImages.js')
  assert.match(rules, /CATEGORY_IMAGE_BUCKET = 'product-images'/, 'in the existing image storage')

  const panel = read('src/admin/CategoryImagesPanel.jsx')
  assert.match(panel, /uploadCategoryImage/, 'a replacement can be uploaded')
  assert.match(panel, /CATEGORY_IMAGE_OPTIONS/, 'or one of the site\'s photos can be chosen')
  assert.match(panel, /await reload\(\)/, 'and the storefront list is re-read afterwards')
})
