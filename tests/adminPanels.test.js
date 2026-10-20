// The admin panels the client asked to improve: the best sellers, the
// category photos, and the order confirmation email.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { locatePicks, normalizePickRows, pickActive, resolveBestsellers } from '../src/lib/bestsellerRules.js'
import { validateCategoryImage, CATEGORY_IMAGE_MAX_BYTES } from '../src/lib/categoryImages.js'

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8')

const cards = [
  { id: 'a', title: 'Denim Shirt', colors: [{ id: 'a1', color: 'Black' }, { id: 'a2', color: 'Blue' }] },
  { id: 'b', title: 'Wrap Dress', colors: [{ id: 'b1', color: 'Red' }] },
  { id: 'c', title: 'Cotton Dress', colors: [{ id: 'c1' }] },
]

// ---- best sellers ----------------------------------------------------------

test('a best seller that has been switched off is not in the shop window', () => {
  const picks = [
    { product_id: 'a', is_active: true },
    { product_id: 'b', is_active: false },
    { product_id: 'c', is_active: true },
  ]
  const shown = resolveBestsellers(picks, cards)
  assert.deepEqual(shown.map((c) => c.id), ['a', 'c'], 'the switched-off design is left out')
})

test('a switched-off best seller keeps its place in the order', () => {
  const picks = [
    { product_id: 'a', is_active: true },
    { product_id: 'b', is_active: false },
    { product_id: 'c', is_active: true },
  ]
  const located = locatePicks(picks, cards)
  assert.deepEqual(located.map((e) => e.product_id), ['a', 'b', 'c'])
  assert.deepEqual(located.map((e) => e.active), [true, false, true])
})

test('a plain id is still a pick', () => {
  assert.equal(pickActive('a'), true)
  assert.equal(pickActive({ product_id: 'a' }), true)
  assert.equal(pickActive({ product_id: 'a', is_active: false }), false)
})

test('the saved rows keep the order and never repeat a design', () => {
  const rows = normalizePickRows([
    { product_id: 'a', is_active: true },
    { product_id: 'a', is_active: false },
    { product_id: 'b', is_active: false },
    '',
  ])
  assert.deepEqual(rows, [
    { product_id: 'a', is_active: true },
    { product_id: 'b', is_active: false },
  ])
})

test('the best sellers panel shows the active ones and the available ones', () => {
  const panel = read('src/admin/BestsellerPanel.jsx')
  assert.match(panel, /Showing on the homepage/, 'the active ones say so')
  assert.match(panel, /Available designs/, 'and the ones that are not chosen are under their own heading')
  assert.match(panel, /Nothing here is chosen yet/, 'which says they are not chosen yet')
  assert.match(panel, /onToggle/, 'and each one can be switched off')
})

test('the best sellers table can carry the switch', () => {
  const migration = read('supabase/migrations/20261021100000_active_switches_and_sync_ledger.sql')
  assert.match(migration, /alter table public\.bestsellers\s+add column if not exists is_active boolean not null default true/)
  assert.match(migration, /A switched-off product keeps its position/)
})

// ---- category photos -------------------------------------------------------

test('only a real photograph may be uploaded', () => {
  assert.equal(validateCategoryImage({ name: 'a.jpg', type: 'image/jpeg', size: 1000 }), '')
  assert.equal(validateCategoryImage({ name: 'a.png', type: 'image/png', size: 1000 }), '')
  assert.equal(validateCategoryImage({ name: 'a.webp', type: 'image/webp', size: 1000 }), '')
  assert.match(validateCategoryImage({ name: 'a.pdf', type: 'application/pdf', size: 1000 }), /image file/i)
  assert.match(validateCategoryImage({ name: 'a.svg', type: 'image/svg+xml', size: 1000 }), /JPEG, PNG, WebP, GIF or AVIF/)
  assert.equal(validateCategoryImage(null), 'Please choose an image file.')
})

test('a photograph that is too large is refused with a size the owner can read', () => {
  assert.equal(validateCategoryImage({ name: 'a.jpg', type: 'image/jpeg', size: CATEGORY_IMAGE_MAX_BYTES }), '')
  assert.match(
    validateCategoryImage({ name: 'a.jpg', type: 'image/jpeg', size: CATEGORY_IMAGE_MAX_BYTES + 1 }),
    /5 MB/,
  )
})

test('the admin sees the photograph the site is actually using', () => {
  const panel = read('src/admin/CategoryImagesPanel.jsx')
  assert.match(panel, /row\.image \|\| row\.defaultImage/, 'the chosen photo, or the default one')
  assert.match(panel, /categoryFallbackImage/, 'and the default comes from the same rule the site uses')
  assert.match(panel, /The site’s default photo/, 'which is said plainly')
})

test('an upload that the storage refuses is reported, not swallowed', () => {
  const store = read('src/lib/categoryImageStore.js')
  assert.match(store, /uploadProblem/, 'the reason is turned into a sentence')
  assert.match(store, /Only an admin account can add photographs/, 'a permission problem is named')
})

// ---- the order confirmation email ------------------------------------------

test('the confirmation email carries everything the client asked for', () => {
  // The body is built by the shared module, which the test suite drives
  // directly (tests/orderEmail.test.js).
  const mail = read('supabase/functions/_shared/orderEmail.mjs')
  assert.match(mail, /Order ID: /, 'the Order ID')
  assert.match(mail, /Order date: /, 'the order date and time')
  assert.match(mail, /Product ID /, 'the Product ID of each item')
  assert.match(mail, /Delivering to/, 'the delivery address')
  assert.match(mail, /Ruhi Womens Clothing/, 'the brand')
  assert.match(mail, /Total paid: /, 'the total')
  assert.match(mail, /Status: /, 'the order status')
  assert.match(mail, /ruhicollections2026@gmail\.com/, 'the contact route the site already uses')
  // The sending itself is still guarded in the Edge Function.
  const confirm = read('supabase/functions/_shared/confirmation.ts')
  assert.match(confirm, /buildConfirmationText/, 'and the function sends exactly that body')
})

test('the confirmation email is sent once and only for a paid order', () => {
  const mail = read('supabase/functions/_shared/confirmation.ts')
  assert.match(mail, /payment_status=eq\.paid/, 'only a paid order')
  assert.match(mail, /confirmation_sent_at=is\.null/, 'and only once')
  assert.match(mail, /await release\(orderId\)/, 'a failed send gives the slot back')
  const verify = read('supabase/functions/verify-razorpay-payment/index.ts')
  assert.match(verify, /confirmation not sent/, 'a mail failure never fails the payment')
})
