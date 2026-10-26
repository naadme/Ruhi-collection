// Issue 3 — a colour’s framing travels with its photographs and is written
// only when it really changed.
// Run with `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { blankVariant, createPayload, updatePayload, variantFromRow } from '../src/lib/productForm.js'

const row = (id, extra = {}) => ({
  id,
  title: 'Shirt - Blue',
  type: 'tops',
  price: 900,
  compare: null,
  rating: 0,
  reviews: 0,
  badge: '',
  sizes: ['S', 'M'],
  description: 'A shirt.',
  image: '/images/products/shirt-blue.jpg',
  hover: null,
  colour: 'Blue',
  is_active: true,
  image_framing: null,
  ...extra,
})

test('a brand-new colour arrives without any framing', () => {
  const v = blankVariant('v1')
  assert.deepEqual(v.framing, {})
})

test('a stored row loads its framing, keyed by photograph', () => {
  const v = variantFromRow({ ...row('p1'), image_framing: { '/images/products/shirt-blue.jpg': { x: 30, y: 60, zoom: 1.3 } } }, 'p1')
  assert.deepEqual(v.framing, { '/images/products/shirt-blue.jpg': { x: 30, y: 60, zoom: 1.3 } })
  assert.deepEqual(v.photos, ['/images/products/shirt-blue.jpg'])
})

test('a row saved before framing existed loads as unframed', () => {
  const v = variantFromRow(row('p2'), 'p2')
  assert.deepEqual(v.framing, {})
})

test('creating a colour writes its framings once', () => {
  const v = { ...blankVariant('v1'), colour: 'Blue', photos: ['/images/products/a.jpg'], framing: { '/images/products/a.jpg': { x: 10, y: 20, zoom: 1.4 } } }
  const payload = createPayload({ name: 'Shirt', type: 'tops', desc: '', sizes: ['S'], badge: '', rating: 0, reviews: 0 }, v)
  assert.equal(payload.image_framing['/images/products/a.jpg'].x, 10)
  assert.equal(payload.image_framing['/images/products/a.jpg'].y, 20)
  assert.equal(payload.image_framing['/images/products/a.jpg'].zoom, 1.4)
})

test('an unframed new colour writes no framing column at all', () => {
  const v = { ...blankVariant('v1'), colour: 'Blue', photos: ['/images/products/a.jpg'] }
  const payload = createPayload({ name: 'Shirt', type: 'tops', desc: '', sizes: ['S'], badge: '', rating: 0, reviews: 0 }, v)
  assert.ok(!('image_framing' in payload))
})

test('reframing a photograph writes image_framing and nothing else', () => {
  const stored = row('p1', { image_framing: {} })
  const next = { ...stored, id: 'p1', original: stored, framing: { '/images/products/shirt-blue.jpg': { x: 10, y: 20, zoom: 1.1 } } }
  const out = updatePayload({ name: 'Shirt', type: 'tops', desc: '', sizes: ['S'], badge: '', rating: 0, reviews: 0 }, {}, next)
  assert.deepEqual(out, { id: 'p1', image_framing: { '/images/products/shirt-blue.jpg': { x: 10, y: 20, zoom: 1.1 } } })
})

test('an untouched colour writes no framing column', () => {
  const stored = row('p1', { image_framing: { '/images/products/shirt-blue.jpg': { x: 50, y: 50, zoom: 1 } } })
  const next = { ...stored, id: 'p1', original: stored, photos: [stored.image], framing: stored.image_framing }
  const out = updatePayload({ name: 'Shirt', type: 'tops', desc: '', sizes: ['S'], badge: '', rating: 0, reviews: 0 }, {}, next)
  assert.deepEqual(out, { id: 'p1' })
})

test('clearing every framing writes image_framing as null', () => {
  const stored = row('p1', { image_framing: { '/images/products/shirt-blue.jpg': { x: 10, y: 20 } } })
  const next = { ...stored, id: 'p1', original: stored, framing: {} }
  const out = updatePayload({ name: 'Shirt', type: 'tops', desc: '', sizes: ['S'], badge: '', rating: 0, reviews: 0 }, {}, next)
  assert.equal(out.image_framing, null)
})
