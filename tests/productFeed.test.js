// The product feed (tracking brief, Section 5): one item per colour and size,
// Google's product data format, and the same IDs as GTM's events.

import test from 'node:test'
import assert from 'node:assert/strict'

import { absoluteUrl, feedItems, feedXml } from '../src/lib/productFeed.js'
import { BRAND, viewedItem } from '../src/lib/trackingItems.js'

const site = 'https://www.ruhi-collections.com'
const row = (fields) => ({
  type: 'dress', gender: null, is_active: true, sizes: ['S', 'M'], compare: null, description: '',
  image: 'https://xhsjwhzutalckeektluj.supabase.co/storage/v1/object/public/p/a.jpg', gallery: [], hover: null,
  ...fields,
})
const rows = [
  row({ id: 'stripes-dress-blue', sku: '0101BU', title: 'Stripes Dress - Blue', colour: 'Blue', price: 849, compare: 999, description: 'Soft cotton & breezy.', gallery: ['/images/products/stripes-dress-blue-2.jpg'] }),
  row({ id: 'stripes-dress-brown', sku: '0102BR', title: 'Stripes Dress - Brown', colour: 'Brown', price: 849, sizes: ['M'] }),
  row({ id: 'plain-top', sku: '0201WH', title: 'Plain Top', colour: null, type: 'tops', price: 599 }),
  // Not on sale, not the shop's, or not sellable: never in the feed.
  row({ id: 'hidden', sku: '0103RE', title: 'Hidden - Red', price: 500, is_active: false }),
  row({ id: 'mens-shirt', sku: '0301BL', title: 'Mens Shirt', price: 500, gender: 'men' }),
  row({ id: 'no-price', sku: '0104BL', title: 'Draft - Black', price: 0 }),
  row({ id: 'no-sku', sku: '', title: 'New - Black', price: 700 }),
]

const items = feedItems(rows, { site })

test('one item per colour and size, and only what the shop sells', () => {
  assert.deepEqual(items.map((i) => i.id), ['0101BU_S', '0101BU_M', '0102BR_M', '0201WH_S', '0201WH_M'])
})

test('the feed’s IDs are exactly the IDs the events send (brief Section 7, rule 6)', () => {
  const design = {
    ...rows[0], title: 'Stripes Dress',
    colors: [{ ...rows[0], color: 'Blue' }, { ...rows[1], color: 'Brown' }],
  }
  const viewed = viewedItem(design, 'stripes-dress-blue', 'M', { category: 'Dresses' })
  const fed = items.find((i) => i.id === viewed.item_id)
  assert.ok(fed)
  assert.equal(fed.item_group_id, viewed.item_group_id)
  assert.equal(fed.brand, viewed.item_brand)
})

test('a full item, in Google’s formats', () => {
  assert.deepEqual(items[1], {
    id: '0101BU_M',
    item_group_id: 'dress_stripes-dress-a3e698ed',
    title: 'Stripes Dress - Blue',
    description: 'Soft cotton & breezy.',
    link: `${site}/product/stripes-dress-blue?size=M`,
    image_link: 'https://xhsjwhzutalckeektluj.supabase.co/storage/v1/object/public/p/a.jpg',
    additional_image_link: [`${site}/images/products/stripes-dress-blue-2.jpg`],
    price: '999.00 INR',
    sale_price: '849.00 INR',
    availability: 'in_stock',
    brand: BRAND,
    condition: 'new',
    identifier_exists: 'no',
    color: 'Blue',
    size: 'M',
    gender: 'female',
    age_group: 'adult',
  })
})

test('every colour of a design shares one item_group_id; a row with no colour keeps its Product ID', () => {
  const group = (id) => items.find((i) => i.id === id).item_group_id
  assert.equal(group('0101BU_S'), 'dress_stripes-dress-a3e698ed')
  assert.equal(group('0102BR_M'), group('0101BU_S'))
  assert.equal(group('0201WH_S'), '0201WH')
})

test('the stored design ID is the feed’s item_group_id, the same one the events send', () => {
  const stored = feedItems([
    row({ id: 'cotton-dress-pink', sku: '0306PI', title: 'Cotton Dress - Pink', colour: 'Pink', price: 849, design_id: '03-CD-01' }),
    row({ id: 'cotton-dress-blue', sku: '0309BU', title: 'Cotton Dress - Blue', colour: 'Blue', price: 849, design_id: '03-CD-01' }),
  ], { site })
  assert.deepEqual([...new Set(stored.map((i) => i.item_group_id))], ['03-CD-01'])
})

test('a design’s description covers every colour; with none written, the name stands in', () => {
  assert.equal(items.find((i) => i.id === '0102BR_M').description, 'Soft cotton & breezy.')
  assert.equal(items.find((i) => i.id === '0201WH_S').description, 'Plain Top')
})

test('no struck-through price means no sale price', () => {
  const plain = items.find((i) => i.id === '0102BR_M')
  assert.equal(plain.price, '849.00 INR')
  assert.equal(plain.sale_price, undefined)
})

test('photos kept as site paths become full addresses', () => {
  assert.equal(absoluteUrl('/images/products/a.jpg', site), `${site}/images/products/a.jpg`)
  assert.equal(absoluteUrl('https://cdn.example/a.jpg', site), 'https://cdn.example/a.jpg')
  assert.equal(absoluteUrl('', site), '')
})

test('the XML escapes text and leaves out empty fields', () => {
  const xml = feedXml(items.slice(0, 1), { site })
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0" xmlns:g="http:\/\/base.google.com\/ns\/1.0">/)
  assert.match(xml, /<g:description>Soft cotton &amp; breezy.<\/g:description>/)
  assert.match(xml, /<g:link>https:\/\/www.ruhi-collections.com\/product\/stripes-dress-blue\?size=S<\/g:link>/)
  assert.match(xml, /<g:additional_image_link>https:\/\/www.ruhi-collections.com\/images\/products\/stripes-dress-blue-2.jpg<\/g:additional_image_link>/)
  assert.equal((xml.match(/<item>/g) || []).length, 1)
  const noSale = feedXml([items[2]], { site })
  assert.doesNotMatch(noSale, /sale_price/)
})
