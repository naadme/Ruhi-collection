// Test harness for supabase/functions/create-razorpay-order and
// verify-razorpay-payment — the tracking brief's parts of them: the ad visit
// saved on the order (Section 4), how the shopper paid (Section 3), and an
// admin's test order paid with Razorpay's test keys (rule 10). Run with:
//
//     node scripts/test-razorpay-checkout.mjs
//
// Same safety properties as scripts/test-razorpay-webhook.mjs:
//  * every credential is a dummy value that exists only inside this process;
//  * `fetch` is replaced before the functions are imported, so NO network
//    call and no database write can ever happen;
//  * it never contacts Razorpay, Supabase, or any third party;
//  * signatures are computed with node:crypto as an independent check of the
//    WebCrypto HMAC in _shared/crypto.ts.

import { createHmac } from 'node:crypto'

// --- dummy configuration (process-local, never real) ------------------------
process.env.SUPABASE_URL = 'https://unit-test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-service-role-key'
process.env.SUPABASE_ANON_KEY = 'unit-test-anon-key'
process.env.RAZORPAY_KEY_ID = 'rzp_live_0000000000000000'
process.env.RAZORPAY_KEY_SECRET = 'unit-live-key-secret'
process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_0000000000000000'
process.env.RAZORPAY_TEST_KEY_SECRET = 'unit-test-key-secret'
const LIVE = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET }
const TEST = { id: process.env.RAZORPAY_TEST_KEY_ID, secret: process.env.RAZORPAY_TEST_KEY_SECRET }

// Minimal Deno shim: env only, so importing a function starts no listener.
globalThis.Deno = { env: { get: (name) => process.env[name] } }

const ADMIN_JWT = 'eyJhbGciOiJIUzI1NiJ9.admin.signature'
const SHOPPER_JWT = 'eyJhbGciOiJIUzI1NiJ9.shopper.signature'
const basic = (key) => `Basic ${Buffer.from(`${key.id}:${key.secret}`).toString('base64')}`

// --- the database and Razorpay, as this harness pretends they are ----------
const baseOrder = (extra = {}) => ({
  id: '11111111-2222-3333-4444-555555555555',
  reference: '02112601',
  status: 'pending',
  email: 'priya@example.com',
  full_name: 'Priya Sharma',
  phone: '9876543210',
  payment_method: 'razorpay',
  payment_status: 'pending',
  razorpay_order_id: null,
  razorpay_payment_id: null,
  paid_at: null,
  subtotal: 849,
  shipping: 0,
  discount: 0,
  coupon_code: null,
  total: 849,
  created_at: '2026-11-02T10:00:00.000Z',
  is_test: false,
  payment_type: null,
  new_customer: null,
  ...extra,
})

const state = {
  calls: [],
  unknown: [],
  isAdmin: false,
  order: baseOrder(),
  // Columns the database does not have yet — an unmigrated database.
  missing: new Set(),
  patchStatus: 200,
  // What `mark_new_customer()` would decide when the order turns paid.
  firstOrder: true,
  payment: { status: 200, method: 'upi', orderId: '' },
  gateway: new Map(),
}

function jsonRes(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const pick = (row, select) =>
  Object.fromEntries(select.split(',').filter((c) => c in row).map((c) => [c, row[c]]))

globalThis.fetch = async (input, init = {}) => {
  const url = String(input)
  const method = (init.method || 'GET').toUpperCase()
  const headers = Object.fromEntries(new Headers(init.headers || {}))
  const body = init.body ? String(init.body) : ''
  state.calls.push({ method, url, headers, body })

  if (url.startsWith('https://api.razorpay.com/v1/')) {
    const mode = headers.authorization === basic(TEST) ? 'test' : headers.authorization === basic(LIVE) ? 'live' : ''
    if (!mode) return jsonRes(401, { error: 'unknown key' })
    const path = url.slice('https://api.razorpay.com/v1'.length)
    if (method === 'POST' && path === '/orders') {
      const sent = JSON.parse(body)
      const id = `order_${mode}_${state.gateway.size + 1}`
      state.gateway.set(id, { amount: sent.amount, currency: sent.currency, mode })
      return jsonRes(200, { id, entity: 'order', amount: sent.amount, amount_paid: 0, currency: sent.currency })
    }
    let m = path.match(/^\/orders\/([^/?]+)$/)
    if (method === 'GET' && m) {
      const id = decodeURIComponent(m[1])
      const known = state.gateway.get(id)
      // An order made with one set of keys does not exist for the other.
      if (!known || known.mode !== mode) return jsonRes(404, { error: 'not found' })
      return jsonRes(200, { id, entity: 'order', amount: known.amount, amount_paid: known.amount, currency: known.currency })
    }
    m = path.match(/^\/payments\/([^/?]+)$/)
    if (method === 'GET' && m) {
      if (state.payment.status !== 200) return jsonRes(state.payment.status, { error: 'unavailable' })
      return jsonRes(200, {
        id: decodeURIComponent(m[1]),
        entity: 'payment',
        amount: 84900,
        currency: 'INR',
        status: 'captured',
        order_id: state.payment.orderId || state.order.razorpay_order_id,
        method: state.payment.method,
      })
    }
  }

  if (url.startsWith('https://unit-test.supabase.co/rest/v1/')) {
    const rest = url.slice('https://unit-test.supabase.co/rest/v1/'.length)
    const query = new URL(url).searchParams
    if (method === 'POST' && rest === 'rpc/is_admin') {
      return jsonRes(200, state.isAdmin && headers.authorization === `Bearer ${ADMIN_JWT}`)
    }
    if (method === 'POST' && rest === 'rpc/create_order') {
      return jsonRes(200, { ...state.order, items: [] })
    }
    if (rest.startsWith('orders?')) {
      if (method === 'GET') {
        const select = query.get('select') || ''
        if (select.split(',').some((c) => state.missing.has(c))) return jsonRes(400, { message: 'column does not exist' })
        return jsonRes(200, [pick(state.order, select)])
      }
      if (method === 'PATCH') {
        const values = JSON.parse(body)
        if (Object.keys(values).some((c) => state.missing.has(c))) return jsonRes(400, { message: 'column does not exist' })
        if (state.patchStatus !== 200) return jsonRes(state.patchStatus, { message: 'simulated failure' })
        const settled = query.get('payment_status') === 'neq.paid' && state.order.payment_status === 'paid'
        const typed = query.get('payment_type') === 'is.null' && state.order.payment_type
        if (settled || typed) return jsonRes(200, [])
        Object.assign(state.order, values)
        if (values.payment_status === 'paid' && state.order.new_customer === null) {
          state.order.new_customer = state.firstOrder
        }
        return (headers.prefer || '').includes('return=representation')
          ? jsonRes(200, [{ ...state.order }])
          : new Response(null, { status: 204 })
      }
    }
    if (rest.startsWith('order_items?')) return jsonRes(200, [])
    // The best-effort extras after a payment (the owner's spreadsheet) read
    // their settings and find none.
    if (method === 'GET') return jsonRes(200, [])
  }

  state.unknown.push(`${method} ${url}`)
  return jsonRes(500, { message: 'unexpected call from test' })
}

const { handle: createOrder } = await import(
  new URL('../supabase/functions/create-razorpay-order/index.ts', import.meta.url)
)
const { handle: verifyPayment } = await import(
  new URL('../supabase/functions/verify-razorpay-payment/index.ts', import.meta.url)
)

// --- helpers -----------------------------------------------------------------
let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function reset(order = {}) {
  state.calls.length = 0
  state.unknown.length = 0
  state.isAdmin = false
  state.order = baseOrder(order)
  state.missing = new Set()
  state.patchStatus = 200
  state.firstOrder = true
  state.payment = { status: 200, method: 'upi', orderId: '' }
  state.gateway.clear()
  process.env.RAZORPAY_TEST_KEY_ID = TEST.id
}

const post = (handler, name, body, jwt) => handler(new Request(`https://unit-test.functions.supabase.co/${name}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
  body: JSON.stringify(body),
}))

const callsTo = (fragment, method) =>
  state.calls.filter((c) => c.url.includes(fragment) && (!method || c.method === method))
const orderPatches = () => callsTo('/rest/v1/orders?', 'PATCH').map((c) => JSON.parse(c.body))

const cart = (extra = {}) => ({
  email: 'priya@example.com',
  full_name: 'Priya Sharma',
  phone: '9876543210',
  address: '1 MG Road',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  items: [{ product_id: 'cotton-dress-pink', size: 'L', qty: 1 }],
  ...extra,
})

const visit = {
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'Diwali_Sale_2026',
  utm_content: 'kurta_video_1',
  utm_term: 'anarkali kurta',
  gclid: 'Cj0KCQjwAbC-DeF_ghI',
  fbc: 'fb.1.1792038600000.IwAR2xK9',
  fbp: 'fb.1.1792038300000.1234567890',
  landing_page: 'https://www.ruhi-collections.com/product/cotton-dress-pink?utm_source=google',
  landing_time: '2026-11-02T09:55:00.000Z',
  // Not real values, or not the brief's columns: none of these may be saved.
  gbraid: 'undefined',
  wbraid: 'x'.repeat(501),
  payment_status: 'paid',
  is_test: true,
}
const saved = {
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'Diwali_Sale_2026',
  utm_content: 'kurta_video_1',
  utm_term: 'anarkali kurta',
  gclid: 'Cj0KCQjwAbC-DeF_ghI',
  fbc: 'fb.1.1792038600000.IwAR2xK9',
  fbp: 'fb.1.1792038300000.1234567890',
  landing_page: 'https://www.ruhi-collections.com/product/cotton-dress-pink?utm_source=google',
  landing_time: '2026-11-02T09:55:00.000Z',
  is_test: false,
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ---------------------------------------------------------------------------
// create-razorpay-order
// ---------------------------------------------------------------------------

// 1. A shopper's order: the ad visit is saved before the payment window opens.
{
  reset()
  const res = await post(createOrder, 'create-razorpay-order', cart({ attribution: visit }))
  const data = await res.json()
  const [context] = orderPatches()
  check('live order → 200', res.status === 200, JSON.stringify(data))
  check('live order → the brief’s columns saved exactly as received', same(context, saved), JSON.stringify(context))
  check('live order → placeholders, oversize values and other fields dropped',
    !('gbraid' in context) && !('wbraid' in context) && !('payment_status' in context))
  check('live order → saved before the gateway order is made',
    state.calls.findIndex((c) => c.method === 'PATCH') < state.calls.findIndex((c) => c.url.includes('api.razorpay.com')))
  check('live order → Razorpay asked with the live keys',
    callsTo('api.razorpay.com/v1/orders', 'POST').every((c) => c.headers.authorization === basic(LIVE)))
  check('live order → Checkout gets the live Key ID', data.key_id === LIVE.id && data.is_test === false)
  check('live order → never asks whether the shopper is an admin', callsTo('rpc/is_admin').length === 0)
}

// 2. No ad visit: only the mode is written.
{
  reset()
  await post(createOrder, 'create-razorpay-order', cart())
  check('no ad visit → only is_test written', same(orderPatches()[0], { is_test: false }), JSON.stringify(orderPatches()[0]))
}

// 3. A database that cannot take the columns yet never blocks a real payment.
{
  reset()
  state.missing = new Set(['utm_source', 'is_test'])
  const res = await post(createOrder, 'create-razorpay-order', cart({ attribution: visit }))
  check('unmigrated database → the shopper can still pay', res.status === 200 && callsTo('api.razorpay.com/v1/orders', 'POST').length === 1)
}

// 4. A test order from someone who is not an admin is refused outright.
{
  reset()
  const res = await post(createOrder, 'create-razorpay-order', cart({ test: true }), SHOPPER_JWT)
  check('test order, not an admin → 403', res.status === 403)
  check('test order, not an admin → no order, no gateway call',
    callsTo('rpc/create_order').length === 0 && callsTo('api.razorpay.com').length === 0)
}

// 5. An admin's test order: marked, and paid with the test keys.
{
  reset()
  state.isAdmin = true
  const res = await post(createOrder, 'create-razorpay-order', cart({ test: true, attribution: visit }), ADMIN_JWT)
  const data = await res.json()
  check('admin test order → 200', res.status === 200, JSON.stringify(data))
  check('admin test order → admin checked with the caller’s own session',
    callsTo('rpc/is_admin')[0]?.headers.authorization === `Bearer ${ADMIN_JWT}`)
  check('admin test order → marked is_test', orderPatches()[0]?.is_test === true)
  check('admin test order → Razorpay asked with the test keys',
    callsTo('api.razorpay.com/v1/orders', 'POST').every((c) => c.headers.authorization === basic(TEST)))
  check('admin test order → Checkout gets the test Key ID', data.key_id === TEST.id && data.is_test === true)
}

// 6. Test keys missing, or a live key filed as the test key: refused, nothing written.
for (const [label, value] of [['missing', undefined], ['a live key under the test name', 'rzp_live_1111111111111111']]) {
  reset()
  state.isAdmin = true
  if (value === undefined) delete process.env.RAZORPAY_TEST_KEY_ID
  else process.env.RAZORPAY_TEST_KEY_ID = value
  const res = await post(createOrder, 'create-razorpay-order', cart({ test: true }), ADMIN_JWT)
  check(`test keys ${label} → 503`, res.status === 503)
  check(`test keys ${label} → nothing written, nothing charged`,
    callsTo('rpc/create_order').length === 0 && callsTo('api.razorpay.com').length === 0)
}
process.env.RAZORPAY_TEST_KEY_ID = TEST.id

// 7. A test order that cannot be marked is never sent to the gateway.
{
  reset()
  state.isAdmin = true
  state.patchStatus = 500
  const res = await post(createOrder, 'create-razorpay-order', cart({ test: true }), ADMIN_JWT)
  check('test order not marked → 500, no gateway order', res.status === 500 && callsTo('api.razorpay.com').length === 0)
}

// 8. A checkout reused after test mode is switched off becomes a real order.
{
  reset({ is_test: true })
  state.gateway.set('order_test_9', { amount: 84900, currency: 'INR', mode: 'test' })
  state.order.razorpay_order_id = 'order_test_9'
  const res = await post(createOrder, 'create-razorpay-order', cart())
  const data = await res.json()
  check('reused test checkout, live now → is_test cleared', orderPatches()[0]?.is_test === false)
  check('reused test checkout, live now → a fresh live gateway order',
    data.razorpay_order_id !== 'order_test_9' && data.key_id === LIVE.id)
}

// ---------------------------------------------------------------------------
// verify-razorpay-payment
// ---------------------------------------------------------------------------
const sign = (key, orderId, paymentId) => createHmac('sha256', key.secret).update(`${orderId}|${paymentId}`).digest('hex')

function placed(mode, extra = {}) {
  const id = `order_${mode}_placed`
  reset({ razorpay_order_id: id, is_test: mode === 'test', ...extra })
  state.gateway.set(id, { amount: 84900, currency: 'INR', mode })
  return id
}
const verifyBody = (orderId, signature) => ({
  reference: '02112601',
  razorpay_order_id: orderId,
  razorpay_payment_id: 'pay_1',
  razorpay_signature: signature,
})

// 9. A live payment: paid, with how it was paid and whether it is a first order.
{
  const id = placed('live')
  const res = await post(verifyPayment, 'verify-razorpay-payment', verifyBody(id, sign(LIVE, id, 'pay_1')))
  const data = await res.json()
  const paid = orderPatches()[0]
  check('live payment → 200', res.status === 200, JSON.stringify(data))
  check('live payment → payment_type saved with the payment', paid?.payment_status === 'paid' && paid?.payment_type === 'upi')
  check('live payment → payment_type and new_customer go back to the browser',
    data.order?.payment_type === 'upi' && data.order?.new_customer === true)
  check('live payment → Razorpay asked with the live keys',
    callsTo('api.razorpay.com').every((c) => c.headers.authorization === basic(LIVE)))
}

// 10. A test payment is proven with the test keys, and only with them.
{
  const id = placed('test')
  const good = await post(verifyPayment, 'verify-razorpay-payment', verifyBody(id, sign(TEST, id, 'pay_1')))
  check('test payment, test signature → 200', good.status === 200)
  check('test payment → Razorpay asked with the test keys',
    callsTo('api.razorpay.com').every((c) => c.headers.authorization === basic(TEST)))
  const id2 = placed('test')
  const bad = await post(verifyPayment, 'verify-razorpay-payment', verifyBody(id2, sign(LIVE, id2, 'pay_1')))
  check('test payment, live signature → refused', bad.status === 400 && orderPatches().length === 0)
}

// 11. Razorpay cannot say how it was paid: the payment is still recorded.
{
  const id = placed('live')
  state.payment.status = 503
  const res = await post(verifyPayment, 'verify-razorpay-payment', verifyBody(id, sign(LIVE, id, 'pay_1')))
  const paid = orderPatches()[0]
  check('method unavailable → still paid, no payment_type', res.status === 200 && paid?.payment_status === 'paid' && !('payment_type' in paid))
}

// 12. A payment that belongs to another order never lends this one its method.
{
  const id = placed('live')
  state.payment.orderId = 'order_someone_else'
  await post(verifyPayment, 'verify-razorpay-payment', verifyBody(id, sign(LIVE, id, 'pay_1')))
  check('payment of another order → no payment_type', !('payment_type' in (orderPatches()[0] || {})))
}

// 13. An unmigrated database: the payment is recorded without the new columns.
{
  const id = placed('live')
  state.missing = new Set(['payment_type', 'is_test', 'new_customer'])
  const res = await post(verifyPayment, 'verify-razorpay-payment', verifyBody(id, sign(LIVE, id, 'pay_1')))
  check('unmigrated database → still verified and paid', res.status === 200 && state.order.payment_status === 'paid')
}

// 14. The webhook got there first without a method: verification fills it in.
{
  const id = placed('live', { payment_status: 'paid', paid_at: '2026-11-02T10:01:00.000Z', razorpay_payment_id: 'pay_1', new_customer: false })
  const res = await post(verifyPayment, 'verify-razorpay-payment', verifyBody(id, sign(LIVE, id, 'pay_1')))
  const data = await res.json()
  const fill = callsTo('/rest/v1/orders?', 'PATCH')
  check('already paid → only payment_type filled in, where empty',
    fill.length === 1 && fill[0].url.includes('payment_type=is.null') && same(JSON.parse(fill[0].body), { payment_type: 'upi' }))
  check('already paid → the browser still learns both', data.order?.payment_type === 'upi' && data.order?.new_customer === false)
}

check('no unexpected stubbed calls in any case', state.unknown.length === 0, state.unknown.join(', '))

// --- summary -----------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
