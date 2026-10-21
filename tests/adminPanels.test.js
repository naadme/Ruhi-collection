// The admin panels the client asked to improve: the best sellers, the
// category photos, and the order confirmation email.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { locatePicks, normalizePickRows, pickActive, resolveBestsellers } from '../src/lib/bestsellerRules.js'
import { validateCategoryImage, CATEGORY_IMAGE_MAX_BYTES } from '../src/lib/categoryImages.js'
import { bannerDestinations } from '../src/lib/bannerLinks.js'

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
  // The SAME rule the storefront uses — the owner's choice, then the shipped
  // photograph, then the first product photo in that category. A category with
  // products but no photograph of its own must not look empty here.
  assert.match(panel, /categoryImage\(c, products\)/, 'and the default comes from the storefront\'s own rule')
  assert.match(panel, /The site’s default photo/, 'which is said plainly')
})

test('an upload that the storage refuses is reported, not swallowed', () => {
  const store = read('src/lib/categoryImageStore.js')
  assert.match(store, /uploadProblem/, 'the reason is turned into a sentence')
  assert.match(store, /Only an admin account can add photographs/, 'a permission problem is named')
})

// ---- the order confirmation email ------------------------------------------

test('the banner destinations are a rule the tests can drive', () => {
  // The menu is built by a pure function, so what the owner can choose from
  // is proved rather than assumed.
  const cats = [{ key: 'dress', label: 'Dresses' }]
  const products = [{ id: 'd1', type: 'dress', title: 'Cotton Dress', price: 900, colors: [{ id: 'd1', color: 'Green' }] }]
  const list = bannerDestinations(cats, products)
  assert.ok(list.some((d) => d.value === '/shop' && d.label === 'All products'))
  assert.ok(list.some((d) => d.value === '/shop?type=dress' && d.label === 'Dresses (category)'))
  assert.ok(list.some((d) => d.value === '/product/d1' && d.label === 'Cotton Dress (product)'))
  // Nothing that is not a destination of this site is offered.
  for (const d of list) assert.ok(d.value.startsWith('/'), 'every destination is a path on this site')
})

test('no panel shadows a name it then reads from itself', () => {
  // A `const x = ... x ...` inside a scope that already has an `x` is a
  // temporal-dead-zone ReferenceError: the panel crashes the moment it
  // renders. The banner panel had exactly this — the destination menu read
  // `products` while declaring a new `products` — and nothing in the build
  // or the tests noticed, because the panel is only ever opened by an admin.
  //
  // The rule is checked here so it cannot come back: a declaration may not
  // use a name that is already declared in the same file.
  const panels = [
    'src/admin/BannerPanel.jsx',
    'src/admin/BestsellerPanel.jsx',
    'src/admin/CategoryImagesPanel.jsx',
    'src/admin/OrdersPanel.jsx',
    'src/admin/GoogleSheetsPanel.jsx',
    'src/admin/ProductEditor.jsx',
  ]
  for (const file of panels) {
    const lines = read(file).split('\n')
    const declared = new Map()
    // A name inside a quoted string is not a read of the name.
    const bare = (value) => String(value).replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '')
    lines.forEach((line, i) => {
      // Every name a line declares — including the ones a destructuring
      // brings into scope (`const { products } = useProducts()`).
      for (const d of line.matchAll(/^\s*(?:const|let|var)\s+(?:\{([^}]*)\}|([A-Za-z_$][\w$]*))\s*=/g)) {
        const names = d[1]
          ? d[1].split(',').map((part) => part.split(':').pop().trim()).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))
          : [d[2]]
        for (const n of names) declared.set(n, i + 1)
      }
      const m = line.match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.*)$/)
      if (!m) return
      const [, name, value] = m
      const earlier = declared.get(name)
      if (earlier !== undefined && earlier !== i + 1) {
        // Only a problem when the declaration reads the name it shadows.
        // A bare read of the name — `state.rows` is not a read of `rows`.
        if (new RegExp(`(?<![.\\w])${name}\\b`).test(bare(value))) {
          assert.fail(`${file}:${i + 1} — "${name}" is declared again and reads itself, which throws`)
        }
      }
    })
  }
})

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

test('the confirmation email is sent once and only for a settled order', () => {
  const mail = read('supabase/functions/_shared/confirmation.ts')
  assert.match(mail, /or=\(payment_status\.eq\.paid,payment_method\.eq\.cod\)/,
    'only a paid order, or a cash-on-delivery one')
  assert.match(mail, /confirmation_sent_at=is\.null/, 'and only once')
  assert.match(mail, /await release\(orderId\)/, 'a failed send gives the slot back')
  const verify = read('supabase/functions/verify-razorpay-payment/index.ts')
  assert.match(verify, /confirmation not sent/, 'a mail failure never fails the payment')
})
