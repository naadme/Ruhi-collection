// Issue 3 & 5 — one framing per photograph, keyed by its address.
// Run with `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  imageFramingOf, imageFramingStyle, framingEqual, BANNER_POSITION,
} from '../src/lib/imageFraming.js'

test('a photograph with no framing entry is centred and un-zoomed', () => {
  assert.deepEqual(imageFramingOf({}, '/images/products/foo.jpg'), BANNER_POSITION)
  assert.deepEqual(imageFramingOf(undefined, '/images/products/foo.jpg'), BANNER_POSITION)
})

test('a photograph keeps its own framing from the map', () => {
  const map = {
    '/images/products/a.jpg': { x: 20, y: 80, zoom: 1.5 },
    '/images/products/b.jpg': { x: 50, y: 50, zoom: 1 },
  }
  assert.deepEqual(imageFramingOf(map, '/images/products/a.jpg'), { x: 20, y: 80, zoom: 1.5 })
  // A different photograph is not affected by this one's framing.
  assert.deepEqual(imageFramingOf(map, '/images/products/b.jpg'), BANNER_POSITION)
  // A photograph that has been replaced has no framing yet.
  assert.deepEqual(imageFramingOf(map, '/images/products/c.jpg'), BANNER_POSITION)
})

test('the framing map compares equal whatever order its keys arrived in', () => {
  const first = { '/a.jpg': { x: 10, y: 20, zoom: 1.2 }, '/b.jpg': { x: 90, y: 10, zoom: 1 } }
  const second = { '/b.jpg': { x: 90, y: 10, zoom: 1 }, '/a.jpg': { x: 10, y: 20, zoom: 1.2 } }
  assert.ok(framingEqual(first, second))
  assert.ok(!framingEqual(first, { '/a.jpg': { x: 10, y: 20, zoom: 1.3 } }))
  assert.ok(framingEqual({}, {}))
})

test('imageFramingStyle applies object-position and a scale about the framed point', () => {
  const map = { '/x.jpg': { x: 25, y: 75, zoom: 1.5 } }
  const style = imageFramingStyle(map, '/x.jpg')
  assert.equal(style.objectPosition, '25% 75%')
  assert.equal(style.transform, 'scale(1.5)')
  assert.equal(style.transformOrigin, '25% 75%')

  const plain = imageFramingStyle({}, '/x.jpg')
  assert.equal(plain.objectPosition, '50% 50%')
  assert.ok(!('transform' in plain))
})
