// Paying again after Razorpay's window was closed mid-payment (22 Nov 2026).
//
// A shopper started a UPI payment, came back to change the address, and found
// Pay locked for the ~10 minutes Razorpay keeps an unapproved request open.
// These tests pin the rules in src/lib/payAgain.js and how the checkout and
// verify-razorpay-payment use them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { isOpenRequest, paysSameOrder } = await import('../src/lib/payAgain.js')

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const CHECKOUT = read('src/pages/Checkout.jsx')
const VERIFY = read('supabase/functions/verify-razorpay-payment/index.ts')

const PENDING = { reference: '22112601', razorpay_order_id: 'order_abc', customer: { email: 'priya@example.com' }, amount: 84900 }

test('a request nobody approved is open: Pay stays free', () => {
  assert.equal(isOpenRequest({ status: 'processing', stage: 'created' }, PENDING), true)
})

test('an approved payment, an unknown stage or another answer is not open', () => {
  assert.equal(isOpenRequest({ status: 'processing', stage: 'authorized' }, PENDING), false)
  // A server from before 22 Nov 2026 sends no stage: the page waits as before.
  assert.equal(isOpenRequest({ status: 'processing' }, PENDING), false)
  assert.equal(isOpenRequest({ status: 'unpaid' }, PENDING), false)
  assert.equal(isOpenRequest({ status: 'paid', stage: 'created' }, PENDING), false)
  assert.equal(isOpenRequest(null, PENDING), false)
})

test('a payment saved without its amount (before 22 Nov 2026) keeps the old wait', () => {
  assert.equal(isOpenRequest({ status: 'processing', stage: 'created' }, { ...PENDING, amount: null }), false)
  assert.equal(isOpenRequest({ status: 'processing', stage: 'created' }, null), false)
})

const OPEN = { email: 'priya@example.com', amount: 84900 }

test('the same email and total pay the same Razorpay order', () => {
  assert.equal(paysSameOrder(OPEN, { email: 'priya@example.com', total: 849 }), true)
  // The database compares emails without case or spaces.
  assert.equal(paysSameOrder(OPEN, { email: '  Priya@Example.com ', total: 849 }), true)
})

test('a new email or a new total would need another payment, so it waits', () => {
  assert.equal(paysSameOrder(OPEN, { email: 'priya.s@example.com', total: 849 }), false)
  assert.equal(paysSameOrder(OPEN, { email: 'priya@example.com', total: 998 }), false)
  assert.equal(paysSameOrder(OPEN, { email: 'priya@example.com', total: 849.01 }), false)
  assert.equal(paysSameOrder(null, { email: 'priya@example.com', total: 849 }), false)
  assert.equal(paysSameOrder({ ...OPEN, amount: null }, { email: 'priya@example.com', total: 849 }), false)
})

test('verify-razorpay-payment says which kind of attempt is in flight', () => {
  assert.match(VERIFY, /const stage = inFlight\.some\(\(p\) => p\.status === 'authorized'\) \? 'authorized' : 'created'/)
  assert.match(VERIFY, /status: 'processing', stage \}/)
})

test('checkout: an open request does not lock Pay; an approved one still does', () => {
  assert.match(CHECKOUT, /const awaitingPayment = \['checking', 'processing', 'error'\]\.includes\(recovery\?\.state\)/)
  assert.match(CHECKOUT, /if \(isOpenRequest\(res, pending\)\) \{/)
  assert.match(CHECKOUT, /state: 'open',/)
  // A check of an open request must not flip the banner to "Checking…",
  // which would lock Pay for the second the check takes.
  assert.match(CHECKOUT, /prev\.state === 'processing' \|\| prev\.state === 'open'/)
})

test('checkout: each attempt remembers what it charges, so the next one can be compared', () => {
  assert.match(CHECKOUT, /savePendingPayment\(\{[^}]*amount: started\.amount,[^}]*\}\)/s)
})

test('checkout: Pay with a new email or total waits while the old request is open', () => {
  const at = CHECKOUT.indexOf("if (recovery?.state === 'open' && !paysSameOrder(recovery")
  assert.ok(at > 0, 'the guard is in submit')
  const create = CHECKOUT.indexOf('await payOnline(customer, items')
  assert.ok(at < create, 'it runs before the order is created')
  assert.ok(CHECKOUT.indexOf('sendStep(sentShipping', at) > at, 'and before add_shipping_info is sent')
})

test('checkout: the open banner tells the shopper they can fix the address and pay again', () => {
  assert.match(CHECKOUT, /isn't complete\. You can correct your address or other details below and pay again\./)
  assert.match(CHECKOUT, /recovery\.state !== 'checking' && recovery\.state !== 'open'/, 'no "Check again" on an open request')
})
