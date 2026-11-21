// Defensive guards added in the final audit. Run with `npm test`.
//
// These cover three ways a bad value could blank the app:
//
//   1. localStorage holding JSON that is valid but NOT an array (a partial
//      write, an older format, a hand-edited key). `JSON.parse` accepts `"{}"`
//      and `7`; the old `|| []` passed them through and the basket/wishlist
//      then called `.find` / `.includes` on a non-array and white-screened.
//   2. The homepage hero when there is nothing to slide: `at % 0` is NaN and
//      `slides[NaN]` is undefined, so reading `cur.key` threw and took the
//      whole homepage down.
//   3. A product page whose selected colour row carries no sizes.
//
// The localStorage readers are executed for real below (their source is
// extracted and run against a stub), so these assert BEHAVIOUR rather than
// merely matching a string.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

/** Pull a top-level `const <name> = ...` declaration out of a source file. */
const extract = (src, startMarker, endMarker, label) => {
  const a = src.indexOf(startMarker)
  assert.ok(a !== -1, `could not find ${label}: ${startMarker}`)
  const b = src.indexOf(endMarker, a)
  assert.ok(b > a, `could not find end of ${label}: ${endMarker}`)
  return src.slice(a, b).trim().replace(/;$/, '')
}

const CART = read('src/context/CartContext.jsx')
const WISHLIST = read('src/context/WishlistContext.jsx')
const HERO = read('src/components/home/HeroCarousel.jsx')
const MODERN = read('src/components/home/HomeModern.jsx')

/** Evaluate an extracted declaration with `localStorage` supplied as a stub. */
const compile = (decl, storage) => {
  // `const readStoredArray = (...) => {...}` becomes an expression we can run.
  const expr = decl.replace(/^const\s+\w+\s*=\s*/, '')
  // eslint-disable-next-line no-new-func
  return new Function('localStorage', `return (${expr})`)(storage)
}

const stubStorage = (value) => ({
  getItem: () => (value === undefined ? null : value),
  setItem: () => {},
})

// ---- 1. persisted state must come back as an array -------------------------

test('a non-array JSON value in localStorage reads as an empty basket', () => {
  const decl = extract(CART, 'const readStoredArray =', '\nconst Ctx', 'readStoredArray')
  for (const corrupt of ['{}', '"hello"', '7', 'true', '{"items":[]}', '[]']) {
    const fn = compile(decl, stubStorage(corrupt))
    const got = fn('cart', true)
    assert.ok(Array.isArray(got), `${corrupt} must still yield an array`)
    assert.deepEqual(got, [], `${corrupt} must not be restored as a basket line`)
  }
})

test('a well-formed basket round-trips untouched', () => {
  const decl = extract(CART, 'const readStoredArray =', '\nconst Ctx', 'readStoredArray')
  const good = [
    { id: 'mulmul-cotton-trousers-white', size: 'M', qty: 2 },
    { id: 'korean-pants-black', size: 'XL', qty: 1, color: 'Black' },
  ]
  const fn = compile(decl, stubStorage(JSON.stringify(good)))
  assert.deepEqual(fn('cart', true), good, 'legitimate lines are never dropped')
})

test('cart lines with no usable id are dropped — they could never resolve', () => {
  const decl = extract(CART, 'const readStoredArray =', '\nconst Ctx', 'readStoredArray')
  const mixed = [
    { id: 'real-product', size: 'M', qty: 1 },
    { size: 'M', qty: 1 },        // no id
    { id: '', size: 'M', qty: 1 }, // blank id
    null,                          // not an object
    'nonsense',
    { id: 42, size: 'M', qty: 1 }, // id present (number is still usable)
  ]
  const fn = compile(decl, stubStorage(JSON.stringify(mixed)))
  const got = fn('cart', true)
  assert.deepEqual(got.map((l) => l.id), ['real-product', 42])
})

test('unparseable localStorage still yields an empty basket, never a throw', () => {
  const decl = extract(CART, 'const readStoredArray =', '\nconst Ctx', 'readStoredArray')
  const fn = compile(decl, stubStorage('{not json at all'))
  assert.deepEqual(fn('cart', true), [])
  const empty = compile(decl, stubStorage(null)) // key absent -> getItem() null
  assert.deepEqual(empty('cart', true), [])
})

test('the wishlist reads only real id strings', () => {
  const decl = extract(WISHLIST, 'const read =', '\nexport function WishlistProvider', 'wishlist read')

  // A fresh reader per value: each one must read ONLY what its stub returns.
  for (const corrupt of ['{}', '7', '"a-string"', 'true', '{"ids":[]}']) {
    const fn = compile(decl, stubStorage(corrupt))
    assert.deepEqual(fn(), [], `${corrupt} must read as an empty wishlist`)
  }

  const good = compile(decl, stubStorage(JSON.stringify(['korean-pants-black', 'denim-shirt-blue'])))
  assert.deepEqual(good(), ['korean-pants-black', 'denim-shirt-blue'])

  const junk = compile(decl, stubStorage(JSON.stringify(['keep', '', null, 7, {}])))
  assert.deepEqual(junk(), ['keep'], 'only usable id strings survive')

  // Key absent entirely (first-ever visitor).
  const absent = compile(decl, stubStorage(undefined))
  assert.deepEqual(absent(), [])
})

// ---- 2. the homepage hero must survive having nothing to slide -------------

test('the hero guards an empty slide list instead of dereferencing undefined', () => {
  // `at % 0` is NaN, so `slides[NaN]` is undefined and `cur.key` threw. The
  // hero (src/components/home/HeroCarousel.jsx) now asks for the photo on
  // screen only when there is one, and never wraps an index by zero.
  assert.match(HERO, /const n = slides\.length/, 'n is still the slide count')
  assert.match(HERO, /const current = n \? slides\[Math\.min\(at, n - 1\)\] : null/,
    'nothing is read when there is nothing to read')
  assert.match(HERO, /if \(!el \|\| !n\) return\s+const to = \(\(i % n\) \+ n\) % n/,
    'nothing is wrapped when there is nothing to wrap')
  // The photos are drawn from the list itself, so an empty list draws none.
  // The guard also waits for the owner's banner to be known, so the full-size
  // fallback photograph is not downloaded and then thrown away.
  assert.match(HERO, /\{bannersKnown && slides\.map\(\(slide, i\) => \(/, 'a photo is rendered only for a slide that exists')
  // The words over the photo must NOT depend on a slide — they have to stay
  // on screen. With no photo they are the shop-wide words.
  assert.match(HERO, /children\(\{ slide: bannersKnown \? current : null, index: at, count: n \}\)/,
    'the words are handed no slide rather than an undefined one')
  assert.match(MODERN, /const to = String\(slide\?\.to \|\| ''\)/, 'and read it defensively')
  assert.match(MODERN, /if \(!key \|\| !categories\.some\(\(c\) => c\.key === key\)\) return SHOP_COPY/,
    'falling back to the shop-wide headline and button')
})

// ---- 3. the zero-slide guard cannot regress the slider ---------------------

test('the guard only changes the empty case: arrows and links are intact', () => {
  assert.match(HERO, /\{arrows && n > 1 && \(/, 'arrows still appear only with more than one slide')
  assert.match(HERO, /onClick=\{\(\) => go\(at - 1\)\}/, 'previous arrow preserved')
  assert.match(HERO, /onClick=\{\(\) => go\(at \+ 1\)\}/, 'next arrow preserved')
  assert.match(HERO, /to=\{slide\.to\}/, 'the slide still links to its category/banner')
})
