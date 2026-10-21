// The order confirmation email.
//
// The body is built by `supabase/functions/_shared/orderEmail.mjs`, which the
// Edge Function and this test both read — so what is proved here is exactly
// what goes out.
//
// Nothing is sent: there is no mail server in this test, no key and no
// recipient. What is proved is the CONTENT, and the rules that decide WHEN a
// confirmation may be sent at all.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  addressLines,
  buildConfirmationSubject,
  buildConfirmationText,
  formatOrderDate,
} from '../supabase/functions/_shared/orderEmail.mjs'

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8')

const order = (over = {}) => ({
  reference: '21102601',
  created_at: '2026-10-20T18:30:00.000Z', // 00:00 IST on 21 October 2026
  full_name: 'Priya Sharma',
  email: 'priya@example.com',
  phone: '9046651272',
  address: '12 Rose Garden',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  status: 'pending',
  payment_status: 'paid',
  subtotal: 1800,
  discount: 200,
  coupon_code: 'RUHI10',
  shipping: 0,
  total: 1600,
  ...over,
})

const items = [
  { title: 'Denim Shirt - Blue', size: 'M', qty: 2, unit_price: 900, sku: '0101BU' },
  { title: 'Cotton Dress - Green', size: 'L', qty: 1, unit_price: 800, sku: '0302GR' },
]

test('the email carries the brand, the Order ID and the order date', () => {
  const text = buildConfirmationText(order(), items)
  assert.match(text, /Ruhi Womens Clothing/)
  assert.match(text, /Order ID: 21102601/)
  assert.match(text, /Order date: 21 Oct 2026, 00:00 IST/, 'the shop\'s own date and time')
})

test('the email carries each product, its Product ID, its colour and its price', () => {
  const text = buildConfirmationText(order(), items)
  assert.match(text, /Denim Shirt - Blue \(Size M, Blue, Product ID 0101BU\) × 2 — ₹1,800/)
  assert.match(text, /Cotton Dress - Green \(Size L, Green, Product ID 0302GR\) × 1 — ₹800/)
})

test('the email carries the money and the status', () => {
  const text = buildConfirmationText(order(), items)
  assert.match(text, /Subtotal: ₹1,800/)
  assert.match(text, /Discount: −₹200 \(RUHI10\)/)
  assert.match(text, /Shipping: Free/)
  assert.match(text, /Total paid: ₹1,600/)
  assert.match(text, /Status: Received/)
})

test('the email carries the delivery address and the contact route', () => {
  const text = buildConfirmationText(order(), items)
  assert.match(text, /Delivering to/)
  assert.match(text, /12 Rose Garden/)
  assert.match(text, /Pune, Maharashtra/)
  assert.match(text, /411001/)
  assert.match(text, /9046651272/)
  assert.match(text, /ruhicollections2026@gmail\.com/)
})

test('the subject names the order and the shop', () => {
  assert.equal(buildConfirmationSubject('21102601'), 'Your Ruhi Womens Clothing order 21102601 — confirmation')
})

test('a line without a colour or a Product ID still reads well', () => {
  const text = buildConfirmationText(order(), [{ title: 'Cotton Dress', size: 'M', qty: 1, unit_price: 800 }])
  assert.match(text, /Cotton Dress \(Size M\) × 1 — ₹800/)
  assert.ok(!/undefined/.test(text), 'nothing is left undefined')
  assert.ok(!/null/.test(text), 'and nothing is left null')
})

test('an order with no lines still produces a readable email', () => {
  const text = buildConfirmationText(order(), [])
  assert.match(text, /Order ID: 21102601/)
  assert.match(text, /Total paid: ₹1,600/)
  assert.match(text, /Items/)
})

test('the date is the shop\'s own, not the reader\'s', () => {
  assert.equal(formatOrderDate('2026-10-20T18:30:00.000Z'), '21 Oct 2026, 00:00 IST')
  assert.equal(formatOrderDate('2026-10-01T18:00:00.000Z'), '1 Oct 2026, 23:30 IST')
  assert.equal(formatOrderDate('not-a-date'), '')
})

test('the address is only the lines the customer gave', () => {
  assert.deepEqual(addressLines(order()), ['12 Rose Garden', 'Pune, Maharashtra', '411001'])
  assert.deepEqual(addressLines(order({ address: '', city: '', state: '', pincode: '' })), [])
})

test('a confirmation is only sent for a settled order, and only once', () => {
  const mail = read('supabase/functions/_shared/confirmation.ts')
  assert.match(mail, /or=\(payment_status\.eq\.paid,payment_method\.eq\.cod\)/,
    'a paid order, or a cash-on-delivery order')
  assert.match(mail, /confirmation_sent_at=is\.null/, 'and only one confirmation per order')
  assert.match(mail, /await release\(orderId\)/, 'a refused send gives the slot back')
})

test('the mail never leaves the browser, and the key is only on the server', () => {
  const mail = read('supabase/functions/_shared/confirmation.ts')
  assert.match(mail, /requireEnv\('RESEND_API_KEY'\)/, 'the key is read on the server')
  const browser = read('src/lib/razorpay.js')
  assert.ok(!/RESEND/.test(browser), 'and the browser bundle knows nothing about the mail key')
  // The example file may NAME the server-side key — it must never carry the
  // value, and it must never be prefixed in a way that would ship it.
  const env = read('.env.example')
  assert.ok(!/VITE_RESEND/.test(env), 'the mail key is never a VITE_ variable')
  // The file may show the SHAPE of the key ("re_...") — it must never carry
  // a real one.
  assert.ok(!/RESEND_API_KEY=re_[A-Za-z0-9_-]{8,}/.test(env), 'and the example file carries no key')
})

test('the email is sent by the existing provider, and only from the server', () => {
  // One module talks to Resend, and it lives on the server only.
  const resend = read('supabase/functions/_shared/resend.ts')
  assert.match(resend, /api\.resend\.com\/emails/, 'the project\'s existing mail provider')
  assert.match(resend, /RESEND_FROM/, 'and the From address it uses is configurable')
  const confirm = read('supabase/functions/_shared/confirmation.ts')
  assert.match(confirm, /from '\.\/resend\.ts'/, 'the confirmation goes through it')
  const panel = read('src/admin/GoogleSheetsPanel.jsx')
  assert.ok(!/resend/i.test(panel), 'the admin panel does not hold a mail key either')
})
