// The GTM page entry (tracking brief, Section 2): which page_type every route
// reports, and the visitor's details in exactly the brief's format.
//
// The brief's own rules are the assertions here: unknown values are left out
// (never "", null or "undefined"), names and places are lower-case, phones are
// "+" and the country code with no spaces, user_id is the account id and never
// an email. The full example from the brief's Annexure A2 is reproduced field
// for field at the end.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PAGE_EVENT,
  authEvent,
  claimPurchase,
  clearVisitor,
  compact,
  createPageGate,
  customerFields,
  detailsFromOrders,
  newEventId,
  normalizeEmail,
  normalizePhone,
  normalizePincode,
  pageEntry,
  pageKey,
  pageTypeFor,
  returningSignIn,
  splitName,
} from '../src/lib/tracking.js'

test('every route reports one of the brief’s page types', () => {
  const cases = [
    ['/', '', 'home'],
    ['/shop', '', 'category'],
    ['/shop', '?type=dresses', 'category'],
    ['/shop', '?q=red%20dress', 'search'],
    ['/shop', '?q=%20%20', 'category'],
    ['/catalog', '', 'category'],
    ['/collections', '', 'category'],
    ['/product/floral-maxi-dress-black', '', 'product'],
    ['/cart', '', 'cart'],
    ['/checkout', '', 'checkout'],
    ['/order/RCH-AB12CD34', '', 'thank_you'],
    ['/account', '?code=abc', 'account'],
    ['/wishlist', '', 'other'],
    ['/admin', '', 'other'],
    ['/about', '', 'other'],
    ['/policies/privacy-policy', '', 'other'],
    ['/no-such-page', '', 'other'],
    ['/cart/', '', 'cart'],
  ]
  for (const [path, search, expected] of cases) {
    assert.equal(pageTypeFor(path, search), expected, `${path}${search}`)
  }
})

test('a sort, an OAuth callback or a campaign tag is not a new page', () => {
  assert.equal(pageKey('/shop', '?type=dresses&sort=low'), pageKey('/shop', '?type=dresses'))
  assert.equal(pageKey('/account', '?code=abc'), pageKey('/account', ''))
  assert.equal(pageKey('/', '?utm_source=google&gclid=xyz'), pageKey('/', ''))
  assert.equal(pageKey('/cart/', ''), pageKey('/cart', ''))
})

test('a new search or a new category on the shop is a new page', () => {
  assert.notEqual(pageKey('/shop', '?type=dresses'), pageKey('/shop', '?type=tops'))
  assert.notEqual(pageKey('/shop', '?q=red'), pageKey('/shop', '?q=blue'))
  assert.notEqual(pageKey('/shop', '?q=red'), pageKey('/shop', ''))
  // A search covers every category, so a leftover category does not split it.
  assert.equal(pageKey('/shop', '?q=red&type=dresses'), pageKey('/shop', '?q=red'))
})

test('emails are trimmed and lower-cased, and only real addresses are kept', () => {
  assert.equal(normalizeEmail('  Priya@Example.COM '), 'priya@example.com')
  assert.equal(normalizeEmail('not an email'), undefined)
  assert.equal(normalizeEmail(''), undefined)
  assert.equal(normalizeEmail(undefined), undefined)
})

test('phones become + and the country code with no spaces or dashes', () => {
  assert.equal(normalizePhone('9876543210'), '+919876543210')
  assert.equal(normalizePhone('98765 43210'), '+919876543210')
  assert.equal(normalizePhone('98765-43210'), '+919876543210')
  assert.equal(normalizePhone('09876543210'), '+919876543210')
  assert.equal(normalizePhone('919876543210'), '+919876543210')
  assert.equal(normalizePhone('+91 98765 43210'), '+919876543210')
  assert.equal(normalizePhone('+1 (415) 555-0100'), '+14155550100')
})

test('a phone that cannot be read with certainty is left out, not guessed', () => {
  for (const value of ['', '   ', '12345', '987654321', '1234567890123', '+12345', '+1234567890123456', undefined]) {
    assert.equal(normalizePhone(value), undefined, String(value))
  }
})

test('PIN codes lose their spaces and must be six digits', () => {
  assert.equal(normalizePincode('411 001'), '411001')
  assert.equal(normalizePincode('411001'), '411001')
  assert.equal(normalizePincode('011001'), undefined)
  assert.equal(normalizePincode('41100'), undefined)
})

test('a full name splits into a first name and the rest', () => {
  assert.deepEqual(splitName('  Priya   Sharma '), { first: 'priya', last: 'sharma' })
  assert.deepEqual(splitName('Priya Sharma Rao'), { first: 'priya', last: 'sharma rao' })
  assert.deepEqual(splitName('Priya'), { first: 'priya', last: undefined })
  assert.deepEqual(splitName(''), { first: undefined, last: undefined })
})

test('unknown values are dropped; false and 0 are real values', () => {
  assert.deepEqual(
    compact({ a: undefined, b: null, c: '', d: false, e: 0, f: 'x' }),
    { d: false, e: 0, f: 'x' },
  )
})

test('the country is only reported alongside an address', () => {
  assert.equal(customerFields({ email: 'a@b.co' }).user_country, undefined)
  assert.equal(customerFields({ city: 'Pune' }).user_country, 'IN')
})

test('customer fields never carry a blank, null or "undefined"', () => {
  const fields = customerFields({ email: 'x', fullName: ' ', phone: 'abc', city: '', state: null, pincode: '1' })
  assert.deepEqual(fields, {})
})

test('details come from the account’s latest order, then its Google profile', () => {
  const user = { id: 'u1', user_metadata: { full_name: 'Google Name' } }
  const orders = [
    { full_name: 'Newest Name', phone: '9876543210', city: 'Pune', state: 'Maharashtra', pincode: '411001', payment_status: 'paid', payment_method: 'razorpay', status: 'confirmed' },
    { full_name: 'Older Name', phone: '9000000000', city: 'Delhi', state: 'Delhi', pincode: '110001', payment_status: 'paid', payment_method: 'razorpay', status: 'delivered' },
  ]
  const details = detailsFromOrders(orders, user)
  assert.equal(details.fullName, 'Newest Name')
  assert.equal(details.city, 'Pune')
  assert.equal(detailsFromOrders([], user).fullName, 'Google Name')
  assert.equal(detailsFromOrders([], { id: 'u2', user_metadata: { name: 'Only Name' } }).fullName, 'Only Name')
  assert.equal(detailsFromOrders([], { id: 'u3' }).fullName, undefined)
})

test('new_customer is false after a purchase and unknown otherwise', () => {
  const order = (fields) => ({ full_name: 'A B', ...fields })
  assert.equal(detailsFromOrders([order({ payment_method: 'razorpay', payment_status: 'paid' })]).new_customer, false)
  assert.equal(detailsFromOrders([order({ payment_method: 'razorpay', payment_status: 'refunded' })]).new_customer, false)
  assert.equal(detailsFromOrders([order({ payment_method: 'cod', status: 'pending' })]).new_customer, false)
  // An unpaid or failed online payment, or a cancelled COD order, is not a
  // purchase — and with no purchase on the account, the brief says leave it out.
  assert.equal(detailsFromOrders([order({ payment_method: 'razorpay', payment_status: 'pending' })]).new_customer, undefined)
  assert.equal(detailsFromOrders([order({ payment_method: 'razorpay', payment_status: 'failed' })]).new_customer, undefined)
  assert.equal(detailsFromOrders([order({ payment_method: 'cod', status: 'cancelled' })]).new_customer, undefined)
  assert.equal(detailsFromOrders([]).new_customer, undefined)
})

test('an anonymous visitor’s entry is the page type and "not logged in", nothing else', () => {
  assert.deepEqual(pageEntry({ pathname: '/product/x', search: '', user: null }), {
    event: PAGE_EVENT,
    page_type: 'product',
    user_logged_in: false,
  })
})

test('a signed-in visitor’s entry matches the brief’s Annexure A2 example field for field', () => {
  const user = { id: 4821, email: ' Priya@Example.com ' }
  const details = {
    fullName: 'Priya  Sharma', phone: '98765 43210', city: ' Pune', state: 'Maharashtra',
    pincode: '411001', new_customer: false,
  }
  const entry = pageEntry({ pathname: '/product/floral-maxi-dress-black', search: '', user, details })
  assert.deepEqual(entry, {
    event: PAGE_EVENT,
    page_type: 'product',
    user_logged_in: true,
    user_id: '4821',
    new_customer: false,
    user_email: 'priya@example.com',
    user_phone: '+919876543210',
    user_first_name: 'priya',
    user_last_name: 'sharma',
    user_city: 'pune',
    user_state: 'maharashtra',
    user_zip: '411001',
    user_country: 'IN',
  })
  // Same order as the brief, so the entry reads the same in GTM's preview.
  assert.deepEqual(Object.keys(entry), [
    'event', 'page_type', 'user_logged_in', 'user_id', 'new_customer', 'user_email', 'user_phone',
    'user_first_name', 'user_last_name', 'user_city', 'user_state', 'user_zip', 'user_country',
  ])
})

test('user_id is the account id as text, and never an email', () => {
  const entry = pageEntry({ pathname: '/', user: { id: 'a1b2', email: 'p@x.co' } })
  assert.equal(entry.user_id, 'a1b2')
  assert.equal(typeof entry.user_id, 'string')
  assert.notEqual(entry.user_id, entry.user_email)
})

test('a signed-in visitor with nothing on file still gets only known fields', () => {
  const entry = pageEntry({ pathname: '/account', user: { id: 'u9', email: 'new@x.co' }, details: detailsFromOrders([], { id: 'u9' }) })
  assert.deepEqual(entry, {
    event: PAGE_EVENT, page_type: 'account', user_logged_in: true, user_id: 'u9', user_email: 'new@x.co',
  })
})

test('signing out clears GTM’s memory with its reset method, then sets user_id to null', () => {
  const saved = globalThis.window
  globalThis.window = {}
  try {
    window.dataLayer = [{ user_email: 'old@x.co' }]
    clearVisitor()
    const [, resetCall, afterReset] = window.dataLayer
    assert.equal(typeof resetCall, 'function')
    let resetRan = false
    resetCall.call({ reset() { resetRan = true } })
    assert.equal(resetRan, true)
    assert.deepEqual(afterReset, { user_logged_in: false, user_id: null })
    // The existing array is extended, never replaced (Google: never re-assign it).
    assert.equal(window.dataLayer.length, 3)
  } finally {
    globalThis.window = saved
  }
})

test('a page view carries its own event_id, right after the event name', () => {
  const entry = pageEntry({ pathname: '/', user: null, eventId: 'page-1' })
  assert.deepEqual(entry, { event: PAGE_EVENT, event_id: 'page-1', page_type: 'home', user_logged_in: false })
  assert.deepEqual(Object.keys(entry), ['event', 'event_id', 'page_type', 'user_logged_in'])
})

test('event ids are new random UUIDs every time', () => {
  const ids = new Set(Array.from({ length: 50 }, newEventId))
  assert.equal(ids.size, 50)
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('a page’s events wait for that page’s entry, and keep their order', () => {
  const pushed = []
  const gate = createPageGate((m) => pushed.push(m))
  gate.shown('/')
  gate.send('/', [{ event: 'now' }])
  assert.deepEqual(pushed, [{ event: 'now' }])

  // The visitor opens a product; its view_item is ready before the entry.
  gate.send('/product/x', [{ ecommerce: null }, { event: 'view_item' }])
  assert.equal(pushed.length, 1)
  pushed.push({ event: 'page_data' }) // PageTracker's own push…
  gate.shown('/product/x') // …and its signal.
  assert.deepEqual(pushed.slice(1), [{ event: 'page_data' }, { ecommerce: null }, { event: 'view_item' }])
})

test('events of a page that was never shown are dropped with it', () => {
  const pushed = []
  const gate = createPageGate((m) => pushed.push(m))
  gate.shown('/')
  gate.send('/catalog', [{ event: 'lost' }])
  gate.shown('/shop?type=')
  assert.deepEqual(pushed, [])
})

test('a sign-in waits for the first page entry, whichever page it is', () => {
  const pushed = []
  const gate = createPageGate((m) => pushed.push(m))
  gate.sendSoon([{ event: 'login' }])
  assert.deepEqual(pushed, [])
  gate.shown('/checkout')
  assert.deepEqual(pushed, [{ event: 'login' }])
  gate.sendSoon([{ event: 'sign_up' }])
  assert.deepEqual(pushed, [{ event: 'login' }, { event: 'sign_up' }])
})

const memoryStorage = () => {
  const data = new Map()
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) }
}

test('a purchase is claimed once per order on this device (brief Section 7, rule 1)', () => {
  const storage = memoryStorage()
  assert.equal(claimPurchase('01112601', storage), true)
  assert.equal(claimPurchase('01112601', storage), false)
  assert.equal(claimPurchase('01112602', storage), true)
  // A refresh is a new page: only the stored mark is left, and it holds.
  assert.equal(JSON.parse(storage.getItem('ruhi:tracked-purchases')).includes('01112601'), true)
  assert.equal(claimPurchase('', storage), false)
})

test('a stored mark from an earlier page load stops the purchase too', () => {
  const storage = memoryStorage()
  storage.setItem('ruhi:tracked-purchases', JSON.stringify(['02112601']))
  assert.equal(claimPurchase('02112601', storage), false)
})

test('a browser that refuses storage still sends each purchase once for the open page', () => {
  const refusing = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(claimPurchase('03112601', refusing), true)
  assert.equal(claimPurchase('03112601', refusing), false)
})

test('A12 login: method, account id and signed-in, nothing else', () => {
  const event = authEvent('login', { method: 'email', user: { id: 4821, email: 'p@x.co' }, eventId: 'l1' })
  assert.deepEqual(event, { event: 'login', event_id: 'l1', method: 'email', user_id: '4821', user_logged_in: true })
  assert.deepEqual(Object.keys(event), ['event', 'event_id', 'method', 'user_id', 'user_logged_in'])
})

test('A11 sign_up: the details the person gave, in the brief’s formats', () => {
  const google = { id: 'u1', email: 'Priya@Example.com', user_metadata: { full_name: 'Priya Sharma' } }
  assert.deepEqual(authEvent('sign_up', { method: 'google', user: google, eventId: 's1' }), {
    event: 'sign_up', event_id: 's1', method: 'google', user_id: 'u1', user_logged_in: true,
    user_email: 'priya@example.com', user_first_name: 'priya', user_last_name: 'sharma',
  })
  // Waiting for the confirmation link: an account, not yet a signed-in visitor.
  assert.deepEqual(authEvent('sign_up', { method: 'email', user: { id: 'u2', email: 'a@b.co' }, loggedIn: false, eventId: 's2' }), {
    event: 'sign_up', event_id: 's2', method: 'email', user_logged_in: false, user_email: 'a@b.co',
  })
})

test('a return from Google is a sign-up only when the account was created by it', () => {
  const at = '2026-10-31T10:00:00.000Z'
  const fresh = {
    id: 'u1', created_at: '2026-10-31T09:59:59.400Z', last_sign_in_at: at,
    identities: [{ provider: 'google', last_sign_in_at: at }],
  }
  assert.deepEqual(returningSignIn(fresh), { method: 'google', isNew: true, key: `u1:${at}` })
  const back = { ...fresh, created_at: '2026-09-01T08:00:00.000Z' }
  assert.equal(returningSignIn(back).isNew, false)
  // An email account that later links Google: the latest identity names the method.
  const both = {
    ...back,
    identities: [
      { provider: 'email', last_sign_in_at: '2026-09-01T08:00:00.000Z' },
      { provider: 'google', last_sign_in_at: at },
    ],
  }
  assert.equal(returningSignIn(both).method, 'google')
  // An email confirmation link is that account's first login; its sign_up
  // went out when the form was sent.
  const confirmed = { ...fresh, identities: [{ provider: 'email', last_sign_in_at: at }] }
  assert.deepEqual(returningSignIn(confirmed), { method: 'email', isNew: false, key: `u1:${at}` })
})
