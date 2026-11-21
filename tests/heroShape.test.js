// The homepage hero's one photo shape, and what the admin tells the owner
// about a photo that doesn't fit it (src/lib/heroShape.js).
import test from 'node:test'
import assert from 'node:assert/strict'
import { HERO_MIN_SIZE, HERO_RATIO, HERO_RATIO_VALUE, heroPhotoNote } from '../src/lib/heroShape.js'

test('the hero is 3:4, the shape of an upright phone photo', () => {
  assert.equal(HERO_RATIO, '3 / 4')
  assert.equal(HERO_RATIO_VALUE, 0.75)
  assert.equal(HERO_MIN_SIZE.width / HERO_MIN_SIZE.height, HERO_RATIO_VALUE)
})

test('a 3:4 photo of a good size gets no note', () => {
  assert.equal(heroPhotoNote(1200, 1600), null)
  assert.equal(heroPhotoNote(3024, 4032), null, 'a phone photo, upright')
  assert.equal(heroPhotoNote(1080, 1350 * 1.0), null, 'Instagram 4:5 is close enough (6% at the sides)')
})

test('a taller photo is told how much of its height is cut', () => {
  // A Story (9:16) shown at 3:4 keeps 75% of its height.
  assert.match(heroPhotoNote(1080, 1920), /taller than 3:4, so about 25% of its height is cut/)
})

test('a wider photo is told how much of its width is cut', () => {
  // A landscape 4:3 photo shown at 3:4 keeps 56% of its width.
  assert.match(heroPhotoNote(1600, 1200), /wider than 3:4, so about 44% of its width is cut/)
})

test('a small photo is told it may look soft', () => {
  assert.match(heroPhotoNote(600, 800), /only 600 px wide/)
  assert.equal(heroPhotoNote(900, 1200), null, 'three quarters of the guideline is still fine')
})

test('no size, no note', () => {
  assert.equal(heroPhotoNote(0, 0), null)
  assert.equal(heroPhotoNote(undefined, 1600), null)
})
