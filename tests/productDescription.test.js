// The description the owner writes, and the description the shopper reads.
//
// A design is ONE product with several colour rows, and the description is
// stored on EVERY row. The rows can therefore disagree — and when they did,
// the editor showed an empty box for a description that WAS saved, and saving
// the form wrote that empty text over every other colour's description.
//
// The rule now: the first description that actually has text is the design's
// description, in the editor and on the page alike.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { designDescription, groupedCards, shownDescription } from '../src/lib/productGrouping.js'
import { groupForm } from '../src/lib/productForm.js'

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8')

const row = (over = {}) => ({
  id: 'r1',
  type: 'tops',
  title: 'Denim Shirt - Black',
  price: 900,
  colour: 'Black',
  desc: '',
  is_active: true,
  ...over,
})

test('the description of a design is the first one that has text', () => {
  const rows = [
    row({ id: 'a', title: 'Denim Shirt - Black', colour: 'Black', desc: '' }),
    row({ id: 'b', title: 'Denim Shirt - Blue', colour: 'Blue', desc: 'A soft cotton shirt.' }),
  ]
  assert.equal(designDescription(rows), 'A soft cotton shirt.')
})

test('a design whose rows are all empty has no description', () => {
  assert.equal(designDescription([row({ desc: '' }), row({ id: 'b', desc: '  ' })]), '')
  assert.equal(designDescription([]), '')
})

test('the editor opens with the description that is actually saved', () => {
  const rows = [
    row({ id: 'a', title: 'Denim Shirt - Black', colour: 'Black', desc: '' }),
    row({ id: 'b', title: 'Denim Shirt - Blue', colour: 'Blue', desc: 'A soft cotton shirt.' }),
  ]
  const form = groupForm(rows, 'tops')
  assert.equal(form.shared.desc, 'A soft cotton shirt.',
    'the editor must not show an empty box for a saved description')
  assert.equal(form.variants.length, 2, 'both colours are still there')
})

test('the storefront shows the same description the editor opens with', () => {
  const rows = [
    row({ id: 'a', title: 'Denim Shirt - Black', colour: 'Black', desc: '' }),
    row({ id: 'b', title: 'Denim Shirt - Blue', colour: 'Blue', desc: 'A soft cotton shirt.' }),
  ]
  const [card] = groupedCards(rows)
  const form = groupForm(rows, 'tops')
  assert.equal(card.desc, form.shared.desc, 'one source of truth')
})

test('a design with one row keeps its description and never prints the colour in its name', () => {
  const rows = [row({ desc: 'Only one colour.' })]
  const [card] = groupedCards(rows)
  assert.equal(card.desc, 'Only one colour.')
  assert.equal(card.title, 'Denim Shirt', 'the shopper reads the design, never "Denim Shirt - Black"')
  assert.equal(card.colour, 'Black', 'the colour stays on the card — it simply leaves the name')
})

test('the owner\'s own wording is never rewritten', () => {
  const words = '  Soft, breathable fabric.\n\nWash inside out.  '
  const rows = [row({ desc: words }), row({ id: 'b', desc: words })]
  assert.equal(designDescription(rows), words, 'the text is kept exactly as written')
})

test('the product page renders the description as plain text', () => {
  const page = read('src/pages/Product.jsx')
  assert.match(page, /p\.desc/, 'the page shows the card\'s description')
  assert.match(page, /whitespace-pre-line/, 'and keeps the line breaks the owner typed')
  assert.ok(!/dangerouslySetInnerHTML/.test(page), 'and never treats it as markup')
})

test('the editor and the storefront read the same rule', () => {
  const form = read('src/lib/productForm.js')
  const grouping = read('src/lib/productGrouping.js')
  assert.match(form, /designDescription\(rows\)/, 'the editor uses the shared rule')
  assert.match(grouping, /desc: designDescription\(group\)/, 'and so does the storefront')
  assert.match(grouping, /export const designDescription/, 'the rule lives in one place')
})

test('what the page renders keeps every break and drops only the stray ends', () => {
  // The owner's paragraphs are hers: two newlines between them must survive,
  // and so must a line break in the middle of a sentence she typed.
  assert.equal(
    shownDescription('First line.\n\nSecond paragraph,\nover two lines.'),
    'First line.\n\nSecond paragraph,\nover two lines.',
  )
  // Only the two things a textarea leaves behind that are not description:
  // the Windows line ending, and whitespace at the very start and end.
  assert.equal(shownDescription('  Soft and light.  '), 'Soft and light.')
  assert.equal(shownDescription('Line one.\r\n\r\nLine two.'), 'Line one.\n\nLine two.')
  // A description of nothing but spaces is no description at all — the page
  // then shows the section and no empty paragraph inside it.
  assert.equal(shownDescription('   \n\t  '), '')
  assert.equal(shownDescription(''), '')
  assert.equal(shownDescription(null), '')
  assert.equal(shownDescription(undefined), '')
})
