// The homepage's Best Sellers row, and how it behaves with only a few designs.
//
// Four cards across on a desktop, so four or fewer belong on the screen as
// they are — with NO arrows at all — and a fifth onwards is paged with the
// arrows. Every window is FULL while more than four exist, so the last page
// never shows one lonely card in a four-up row (five designs → 1-4 then 2-5),
// and a page number left behind by a shrinking list is clamped rather than
// pointing at a page that is gone.
//
// The rule lives in src/lib/bestsellerCarousel.js so it can be proved here in
// plain Node; Sections.jsx only ever renders what it says.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  BESTSELLER_PER_VIEW,
  bestsellerArrows,
  bestsellerPages,
  bestsellerSlice,
} from '../src/lib/bestsellerCarousel.js'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const SECTIONS = read('src/components/Sections.jsx')

/** `n` real catalogue cards, numbered so the order is checkable. */
const designs = (n) => Array.from({ length: n }, (_, i) => ({ id: `design-${i + 1}` }))
const ids = (list) => list.map((c) => c.id)

// ---- four or fewer: shown as they are, no arrows ---------------------------

test('nothing to show is nothing at all — and never an arrow pointing at a void', () => {
  assert.equal(bestsellerArrows(0), false)
  assert.equal(bestsellerPages(0), 1)
  assert.deepEqual(bestsellerSlice(designs(0), 0), [])
  assert.deepEqual(bestsellerSlice([], 3), [], 'a stale page number cannot invent anything')
})

for (const n of [1, 2, 3, 4]) {
  test(`${n} design${n === 1 ? '' : 's'}: no arrows, and the row is exactly the list`, () => {
    assert.equal(bestsellerArrows(n), false, 'four or fewer never shows an arrow')
    assert.equal(bestsellerPages(n), 1, 'so there is only ever one page')
    assert.deepEqual(ids(bestsellerSlice(designs(n), 0)), ids(designs(n)))
    assert.deepEqual(ids(bestsellerSlice(designs(n), 1)), ids(designs(n)),
      'a stray page number shows the designs anyway, never an empty row')
  })
}

test('the row is four cards across, which is what the shared grid shows', () => {
  assert.equal(BESTSELLER_PER_VIEW, 4)
  assert.match(read('src/components/ProductGrid.jsx'), /lg:grid-cols-4/, 'the grid is four-up on a desktop')
})

// ---- five and more: the arrows appear, and every page is full --------------

test('five designs: two pages, both showing four, never one lonely card', () => {
  assert.equal(bestsellerArrows(5), true)
  assert.equal(bestsellerPages(5), 2)
  assert.deepEqual(ids(bestsellerSlice(designs(5), 0)), ['design-1', 'design-2', 'design-3', 'design-4'])
  assert.deepEqual(ids(bestsellerSlice(designs(5), 1)), ['design-2', 'design-3', 'design-4', 'design-5'],
    'the last page slides back so it is never a quarter-full row')
})

test('six designs: the second page starts where the first stopped', () => {
  assert.equal(bestsellerPages(6), 2)
  assert.deepEqual(ids(bestsellerSlice(designs(6), 1)), ['design-3', 'design-4', 'design-5', 'design-6'])
})

test('eight designs: exactly two full pages, in order, nothing lost', () => {
  assert.equal(bestsellerPages(8), 2)
  assert.deepEqual(ids(bestsellerSlice(designs(8), 0)), ['design-1', 'design-2', 'design-3', 'design-4'])
  assert.deepEqual(ids(bestsellerSlice(designs(8), 1)), ['design-5', 'design-6', 'design-7', 'design-8'])
  const seen = [...bestsellerSlice(designs(8), 0), ...bestsellerSlice(designs(8), 1)]
  assert.deepEqual(ids(seen), ids(designs(8)), 'every design is reachable and none appears twice')
})

test('nine designs: three pages, and a stale page is pulled back', () => {
  assert.equal(bestsellerPages(9), 3)
  assert.deepEqual(ids(bestsellerSlice(designs(9), 2)), ['design-6', 'design-7', 'design-8', 'design-9'])
  assert.deepEqual(ids(bestsellerSlice(designs(9), 99)), ids(bestsellerSlice(designs(9), 2)),
    'a page beyond the end shows the last page, never nothing')
  assert.deepEqual(ids(bestsellerSlice(designs(9), -1)), ids(bestsellerSlice(designs(9), 0)))
})

test('the list shrinks when a design is removed — the row keeps showing four', () => {
  // Eight picks, the owner is on the last page, then removes four of them.
  const six = designs(6)
  assert.equal(bestsellerPages(six.length), 2)
  assert.equal(bestsellerSlice(six, 1).length, 4, 'the window is still full')
  // …and with only four left there is no second page to be on at all.
  assert.equal(bestsellerPages(4), 1)
  assert.deepEqual(ids(bestsellerSlice(designs(4), 5)), ids(designs(4)))
})

test('nothing here reorders, copies or invents a design', () => {
  const list = designs(6)
  const page = bestsellerSlice(list, 1)
  assert.equal(page[0], list[2], 'the entries are the very objects that went in')
  assert.deepEqual(ids(list), ['design-1', 'design-2', 'design-3', 'design-4', 'design-5', 'design-6'],
    'and the source list is never touched')
  assert.equal(bestsellerSlice(null, 0).length, 0)
  assert.equal(bestsellerSlice('not a list', 0).length, 0)
})

// ---- the section uses that rule --------------------------------------------

const body = SECTIONS.slice(
  SECTIONS.indexOf('export const BestSellers'),
  SECTIONS.indexOf('export const OurStory'),
)

test('the row renders the shared card grid, arrows or no arrows', () => {
  assert.match(body, /<ProductGrid/, 'the same cards, prices, wishlist hearts and images as always')
  assert.match(body, /items=\{shown\}/, 'the grid is handed the designs this page shows')
  assert.match(body, /const shown = arrows \? bestsellerSlice\(items, page\) : items/,
    'four or fewer are shown whole; more are paged by the rule above')
})

test('the arrows are rendered only while there is more to see', () => {
  assert.match(body, /const arrows = !gridLoading && bestsellerArrows\(total\)/,
    'the rule itself decides — four or fewer, no arrows in the page at all')
  assert.match(body, /\{arrows \? \(/, 'the arrow layout is chosen by it')
  assert.match(body, /\) : grid\}/, 'and the plain row is what stands without them')
  assert.match(body, /aria-label="Show previous best sellers"/)
  assert.match(body, /aria-label="Show next best sellers"/)
  assert.match(body, /disabled=\{page === 0\}/, 'the first arrow is off on the first page')
  assert.match(body, /disabled=\{page >= pages - 1\}/, 'the second is off on the last')
  // The arrows wrap to their own row on a phone instead of squeezing the
  // cards, and sit either side of them from `md` up.
  assert.match(body, /flex flex-wrap items-center justify-center gap-3 md:gap-5 md:justify-start/)
  assert.match(body, /w-full md:w-auto md:flex-1 min-w-0/)
})

test('a page number left behind by a shorter list is pulled back', () => {
  assert.match(body, /setPage\(\(p\) => Math\.min\(p, pages - 1\)\)/,
    'so the arrows can never point at a page that is gone')
})
