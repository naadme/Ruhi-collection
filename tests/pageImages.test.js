// Issue 1 & 5 — page photographs: the About hero, the Contact banner, the
// homepage story and the two About pictures, each with its own framing, read
// from the same `banners` table the homepage banners use under a slot of
// their own.
// Run with `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { PAGE_IMAGES, PAGE_IMAGE_SLOTS, pageImage, pageImageFor } from '../src/lib/pageImages.js'

test('every known slot has a fallback photograph and a framing', () => {
  for (const def of PAGE_IMAGES) {
    assert.ok(def.fallback.image, `${def.slot} has a fallback photograph`)
    assert.ok(def.fallback.image, `${def.slot} fallback carries an image`)
    assert.ok(def.desktop && def.phone, `${def.slot} previews both page shapes`)
  }
  assert.equal(PAGE_IMAGE_SLOTS.length, PAGE_IMAGES.length)
  assert.ok(PAGE_IMAGE_SLOTS.includes('about_hero'))
  assert.ok(PAGE_IMAGE_SLOTS.includes('contact_hero'))
  assert.ok(PAGE_IMAGE_SLOTS.includes('story'))
  assert.ok(PAGE_IMAGE_SLOTS.includes('about_a'))
  assert.ok(PAGE_IMAGE_SLOTS.includes('about_b'))
})

test('pageImage returns the definition for a known slot', () => {
  const hero = pageImage('about_hero')
  assert.ok(hero)
  assert.equal(hero.label, 'About page — hero')
  assert.equal(pageImage('no-such-slot'), undefined)
})

test('with no saved row the page keeps its fallback photograph and framing', () => {
  const seen = pageImageFor('story', new Map())
  assert.ok(seen.image)
  // object-position plus an optional scale about the framed point
  assert.ok('objectPosition' in seen.style)
  assert.equal(seen.fromDatabase, false)
})

test('a saved row wins over the fallback and carries its own framing', () => {
  const rows = new Map([['contact_hero', { slot: 'contact_hero', image: '/images/products/chosen.jpg', focus_x: 10, focus_y: 20, zoom: 1.4 }]])
  const seen = pageImageFor('contact_hero', rows)
  assert.equal(seen.image, '/images/products/chosen.jpg')
  assert.equal(seen.style.objectPosition, '10% 20%')
  assert.equal(seen.style.transform, 'scale(1.4)')
  assert.equal(seen.fromDatabase, true)
})
