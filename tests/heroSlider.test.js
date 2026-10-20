// The homepage hero's slide list and its arrows (requirement: the arrows must
// not disappear when the owner saves a banner, and must work whenever there
// are several banners).
//
// `heroSlides` and `showArrows` are the rule; tests/resilience.test.js pins
// the markup that renders them.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { heroSlides, showArrows, slideAt } from '../src/lib/heroSlider.js'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

const CATS = [
  { key: 'tops', image: '/tops.jpg', to: '/shop?type=tops', label: 'Tops' },
  { key: 'coord', image: '/coord.jpg', to: '/shop?type=coord', label: 'Co-ord Sets' },
  { key: 'dress', image: '/dress.jpg', to: '/shop?type=dress', label: 'Dresses' },
  { key: 'trousers', image: '/trousers.jpg', to: '/shop?type=trousers', label: 'Trousers' },
]
const banner = (id, extra = {}) => ({ id, image: `/banner-${id}.jpg`, link: '', ...extra })

test('no banners saved: the original category slider, unchanged', () => {
  const slides = heroSlides([], CATS)
  assert.equal(slides.length, 4)
  assert.equal(slides[0].key, 'tops', 'it opens on the first category, as it always did')
  assert.equal(showArrows(slides), true)
})

test('THE BUG: saving the FIRST banner no longer removes the arrows', () => {
  const before = heroSlides([], CATS)
  const after = heroSlides([banner('a')], CATS)

  assert.equal(showArrows(before), true)
  assert.equal(showArrows(after), true, 'adding a banner used to leave one slide and hide the arrows')
  assert.ok(after.length > before.length, 'the banner is added, never subtracted')
  assert.equal(after[0].key, 'a', 'the owner’s banner is what the hero opens on')
  assert.equal(after[after.length - 1].key, 'trousers', 'the default photos stay on the end')
})

test('several banners: working arrows, in the order they were saved', () => {
  const slides = heroSlides([banner('one'), banner('two'), banner('three')], CATS)
  assert.equal(showArrows(slides), true)
  assert.deepEqual(slides.slice(0, 3).map((s) => s.key), ['one', 'two', 'three'])

  // Every step of the carousel lands on a real slide, forwards and backwards.
  for (let i = 0; i < slides.length + 2; i += 1) {
    assert.ok(slides[slideAt(i, slides.length)], `forward step ${i} lands on a slide`)
    assert.ok(slides[slideAt(-i, slides.length)], `backward step ${i} lands on a slide`)
  }
})

test('a banner with no photo is never a slide', () => {
  const slides = heroSlides([banner('ok'), { id: 'bad', image: '   ' }, { id: 'worse' }], [])
  assert.equal(slides.length, 1)
  assert.equal(showArrows(slides), false, 'one slide: dead arrows would help nobody')
})

test('one banner and nothing to fall back on still renders the banner', () => {
  const slides = heroSlides([banner('only')], [])
  assert.equal(slides.length, 1)
  assert.equal(slideAt(0, slides.length), 0)
  assert.equal(showArrows(slides), false)
})

test('an empty catalogue never produces NaN (the zero-slide guard)', () => {
  assert.equal(heroSlides([], []).length, 0)
  assert.equal(slideAt(3, 0), null, 'a null index means "render nothing", not a crash')
  assert.equal(slideAt(Number.NaN, 4), 0)
  assert.equal(showArrows([]), false)
  assert.equal(showArrows(undefined), false)
})

test('a banner keeps its saved link, or falls back to the shop', () => {
  const withLink = heroSlides([banner('a', { link: '/shop?type=dress' })], [])[0]
  const without = heroSlides([banner('b')], [])[0]
  assert.equal(withLink.to, '/shop?type=dress')
  assert.equal(without.to, '/shop')
})

test('the hero renders exactly this rule, and nothing invented beside it', () => {
  const sections = read('src/components/Sections.jsx')
  assert.match(sections, /heroSlides\(banners/, 'the slide list comes from src/lib/heroSlider.js')
  assert.match(sections, /slideAt\(atRaw, n\)/, 'the index is wrapped by the same module')
  assert.match(sections, /\{n > 1 && \(/, 'arrows appear whenever there is more than one slide')
  assert.match(sections, /onClick=\{\(\) => go\(-1\)\}/, 'previous arrow')
  assert.match(sections, /onClick=\{\(\) => go\(1\)\}/, 'next arrow')
  assert.match(sections, /setAt\(0\)\s*\}\s*,\s*\[banners\.length\]/, 'a new banner starts the carousel at its first photo')
  assert.doesNotMatch(sections, /banners\.length\n?\s*\?\s*banners\.map/,
    'banners no longer REPLACE the fallback list — that replacement was the bug')
})
