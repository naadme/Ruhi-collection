// Removing a design from Best Sellers.
//
// TWO things made the remove button do nothing at all:
//
//   1. `state.picks` holds ROWS (`{ product_id, is_active }`) since the
//      Active/Inactive switch was added, but the filter compared those rows
//      against a Set of id STRINGs — no pick ever matched, the list never
//      changed, Save never lit up and the database was never told; and
//   2. the ids were collected through `locatePicks`, which reports ONE entry
//      per design, so only the first pick of a design would have been dropped
//      anyway — every other colour row of it survived and brought it back.
//
// `picksForCard` + `withoutPicks` fix both: the ids are read OFF every pick,
// and every pick that renders as the design is collected.
//
// These tests drive the very rule the panel calls with real grouped cards, so
// the regression cannot come back unnoticed, and they pin the panel's own
// source to that rule.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  locatePicks,
  normalizePickRows,
  pickId,
  picksForCard,
  withoutPicks,
} from '../src/lib/bestsellerRules.js'
import { groupedCards } from '../src/lib/productGrouping.js'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const PANEL = read('src/admin/BestsellerPanel.jsx')
const IO = read('src/lib/bestsellers.js')

// One design with three colour rows (so it is ONE card) and one single-colour
// design — the shape the admin really works with.
const ROWS = [
  { id: 'stripes-dress-pink', title: 'Stripes Dress - Pink', type: 'dress', colour: 'Pink', price: 900, image: '/p.jpg', is_active: true },
  { id: 'stripes-dress-blue', title: 'Stripes Dress - Blue', type: 'dress', colour: 'Blue', price: 900, image: '/b.jpg', is_active: true },
  { id: 'stripes-dress-red', title: 'Stripes Dress - Red', type: 'dress', colour: 'Red', price: 850, image: '/r.jpg', is_active: true },
  { id: 'linen-top-white', title: 'Linen Top', type: 'tops', colour: 'White', price: 700, image: '/w.jpg', is_active: true },
]
const CARDS = groupedCards(ROWS)

// Exactly the shape `load()` puts in state: rows, not plain ids.
const savedPicks = (...entries) => normalizePickRows(entries)

/** What BestsellerPanel.remove does, step for step. */
const removeCard = (picks, cardId) => {
  const drop = picksForCard(picks, cardId, CARDS)
  if (!drop.length) return picks
  return withoutPicks(picks, drop)
}

test('the design the owner removes really leaves the list', () => {
  const picks = savedPicks('linen-top-white', { product_id: 'stripes-dress-pink', is_active: true })
  const left = removeCard(picks, 'stripes-dress-red') // the grouped card's own id

  assert.deepEqual(left.map(pickId), ['linen-top-white'], 'the chosen design is gone')
  assert.equal(left.length, picks.length - 1, 'and exactly one entry was dropped')
  // The old filter, for the record: rows compared to a Set of strings match
  // NOTHING, so the list came back unchanged and Save stayed disabled.
  const drop = new Set(['stripes-dress-pink'])
  assert.equal(picks.filter((p) => !drop.has(p)).length, picks.length,
    'the old drop.has(p) comparison dropped nothing — this is the bug')
})

test('removing a design drops every pick that names any of its colour rows', () => {
  // The owner may have promoted Pink while the card is filed as Red (its
  // cheapest colour) — and a stored duplicate must not survive the removal.
  const picks = savedPicks(
    'stripes-dress-pink',
    'stripes-dress-blue',
    { product_id: 'linen-top-white', is_active: true },
    'stripes-dress-red',
  )
  const left = removeCard(picks, 'stripes-dress-red')
  assert.deepEqual(left.map(pickId), ['linen-top-white'], 'every row of that design is gone')
})

test('a removal leaves every OTHER pick exactly where it was', () => {
  const picks = savedPicks(
    { product_id: 'stripes-dress-red', is_active: false },
    'linen-top-white',
    'gone-from-the-catalogue',
  )
  const left = removeCard(picks, 'stripes-dress-red')
  assert.deepEqual(left.map(pickId), ['linen-top-white', 'gone-from-the-catalogue'],
    'the order of what stays is untouched, and the hidden entry keeps its slot')
  assert.equal(left[0].product_id, 'linen-top-white')
  assert.equal(typeof left[0], 'object', 'the survivors keep their own shape')
})

test('removing something that is not on the list changes nothing at all', () => {
  const picks = savedPicks('linen-top-white')
  assert.equal(removeCard(picks, 'stripes-dress-red'), picks, 'the same array back — no state churn')
  assert.equal(removeCard([], 'linen-top-white').length, 0)
  assert.deepEqual(withoutPicks(null, ['a']), [], 'and never a throw')
})

test('withoutPicks reads the id off the pick, whatever shape it is', () => {
  const mixed = ['a', { product_id: 'b', is_active: false }, { product_id: 'c' }]
  assert.deepEqual(withoutPicks(mixed, ['b']).map(pickId), ['a', 'c'])
  assert.deepEqual(withoutPicks(mixed, new Set(['a', 'c'])).map(pickId), ['b'])
  // Nothing to drop: the very same array comes back, so the caller can skip
  // the state update entirely.
  assert.equal(withoutPicks(mixed, []), mixed)
  assert.equal(withoutPicks(mixed, null), mixed)
  // Trimming both sides, so ' a ' and 'a' are the same design.
  assert.equal(withoutPicks([' a '], ['a']).length, 0)
  // An entry with no id at all is never dropped by a removal (it is dropped
  // by normalizePicks when the list is saved).
  assert.equal(withoutPicks(['a', null, '  '], ['a']).length, 2)
  assert.deepEqual(withoutPicks(null, ['a']), [])
})

test('the visible list reports one entry per design, so it cannot collect a removal', () => {
  const picks = savedPicks('stripes-dress-pink', 'stripes-dress-blue', 'linen-top-white', 'stripes-dress-red')
  // What renders: two designs — the dedupe is what keeps the row honest.
  assert.equal(locatePicks(picks, CARDS).length, 2)
  // What has to GO when the owner removes one of them: every row of it.
  assert.deepEqual(
    picksForCard(picks, 'stripes-dress-red', CARDS),
    ['stripes-dress-pink', 'stripes-dress-blue', 'stripes-dress-red'],
    'collecting only the first pick would let the design come straight back',
  )
  assert.deepEqual(picksForCard(picks, 'linen-top-white', CARDS), ['linen-top-white'])
  assert.deepEqual(picksForCard(picks, 'no-such-design', CARDS), [])
})

// ---- what the panel does with that rule ------------------------------------

test('the panel removes through the shared rule, never by comparing rows', () => {
  assert.match(PANEL, /const remove = \(cardId\)/, 'remove takes the card id')
  assert.match(PANEL, /picksForCard\(s\.picks, cardId, cards\)/,
    'EVERY pick that renders as this design is collected, not just the one that shows')
  assert.match(PANEL, /locatePicks\(s\.picks, cards\)/, 'resolved from the state it is about to write')
  assert.match(PANEL, /withoutPicks\(s\.picks, drop\)/, 'and the ids are read off every pick')
  assert.doesNotMatch(PANEL, /drop\.has\(p\)/,
    'the old row-against-id comparison must never come back')
})

test('the panel cannot put a design on the list twice', () => {
  assert.match(PANEL, /chosenIds\.has\(card\.id\)/, 'a design already chosen is refused up front')
  assert.match(PANEL, /locatePicks\(s\.picks, cards\)\.some\(/,
    'and again against the state about to be written, so two quick clicks cannot race')
  // The list offered to add from excludes what is already on it.
  assert.match(PANEL, /cards\.filter\(\(c\) => !chosenIds\.has\(c\.id\)/)
})

test('removing a best seller never touches the catalogue itself', () => {
  // The panel writes picks and nothing else; the product rows are the
  // catalogue's own business. Removing a promotion must leave the product
  // exactly where shoppers can still find it.
  assert.doesNotMatch(PANEL, /deleteProduct|removeRow|\.from\(/,
    'the panel never speaks to a table itself')
  assert.match(PANEL, /saveBestsellers\(state\.picks\)/, 'it hands the whole list to the one writer')

  // That writer only ever reads and writes the promotion table.
  const froms = [...IO.matchAll(/\.from\('([^']+)'\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(froms)], ['bestsellers'],
    'bestsellers.js touches the best sellers table and nothing else')
  assert.doesNotMatch(IO, /from\('products'\)/, 'and never the catalogue')
})

test('the panel says whether the save landed, and says why when it did not', () => {
  assert.match(PANEL, /notify\('success', state\.picks\.length/, 'a clear success message')
  assert.match(PANEL, /notify\('error', e\?\.message \|\| 'Could not save the best sellers\.'\)/,
    'and a real reason when the write fails')
  // A failure re-reads the database rather than leaving the owner looking at
  // a list the store does not hold.
  assert.match(PANEL, /await load\(\)\s*\n\s*\} finally \{/)
})

test('the saved rows are the only thing the write path ever keeps', () => {
  // One row per design, in order, never the same design twice.
  const rows = normalizePickRows([
    { product_id: 'a', is_active: true },
    { product_id: 'a', is_active: false },
    { product_id: 'b', is_active: true },
  ])
  assert.deepEqual(rows, [
    { product_id: 'a', is_active: true },
    { product_id: 'b', is_active: true },
  ])
})
