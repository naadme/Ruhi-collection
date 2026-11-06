// Test harness for supabase/functions/razorpay-webhook — run with:
//
//     node scripts/test-razorpay-webhook.mjs
//
// Safety properties of this harness:
//  * every credential is a dummy value that exists only inside this process;
//  * `fetch` is replaced before the function is imported, so NO network call
//    and no database write can ever happen — asserted per test case;
//  * it never contacts Razorpay, Supabase, or any third party;
//  * signatures are computed with node:crypto as an independent
//    cross-implementation check of the WebCrypto HMAC in _shared/crypto.ts.

import { createHmac } from 'node:crypto'

// --- dummy configuration (process-local, never real) ------------------------
process.env.SUPABASE_URL = 'https://unit-test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-service-role-key'
process.env.RAZORPAY_KEY_ID = 'rzp_test_0000000000000000'
process.env.RAZORPAY_KEY_SECRET = 'unit-test-key-secret'
process.env.RAZORPAY_WEBHOOK_SECRET = 'unit-test-webhook-secret'
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET

// Minimal Deno shim so _shared/deno.ts resolves (env only — `serve` stays
// undefined, so importing the module does not start an HTTP listener).
globalThis.Deno = { env: { get: (name) => process.env[name] } }

// --- fetch stub: records every call, answers from canned data ---------------
const ORDER = {
  id: '11111111-2222-3333-4444-555555555555',
  reference: 'RCH-TESTTEST',
  status: 'pending',
  payment_method: 'razorpay',
  payment_status: 'pending',
  razorpay_order_id: 'order_rzp_1',
  razorpay_payment_id: null,
  paid_at: null,
  subtotal: 900,
  shipping: 0,
  total: 900,
  created_at: '2026-10-15T00:00:00.000Z',
}

const state = {
  calls: [],
  duplicateEventIds: new Set(),
  patchStatus: 200,
  unknownUrls: [],
  // The order's payment_status as the database holds it right now.
  orderStatus: 'pending',
  // The Razorpay order id the database holds for it (a checkout restarted
  // with another cart gets a new one).
  orderRzpId: 'order_rzp_1',
}

function jsonRes(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input)
  const method = (init.method || 'GET').toUpperCase()
  const body = init.body ? String(init.body) : ''
  state.calls.push({ method, url, body })

  if (url.includes('/rest/v1/razorpay_webhook_events')) {
    if (method === 'POST') {
      let eventId = ''
      try { eventId = JSON.parse(body).event_id } catch { /* not json */ }
      // PostgREST answers a repeated primary key with 409 Conflict.
      if (state.duplicateEventIds.has(eventId)) {
        return jsonRes(409, {
          code: '23505',
          message: 'duplicate key value violates unique constraint "razorpay_webhook_events_pkey"',
        })
      }
      return jsonRes(201, [{ event_id: eventId }])
    }
    if (method === 'DELETE') return new Response(null, { status: 204 })
  }

  if (url.includes('/rest/v1/orders')) {
    if (method === 'GET') {
      const m = url.match(/([a-z_]+)=eq\.([^&]+)/)
      const col = m ? m[1] : ''
      const val = m ? decodeURIComponent(m[2]) : ''
      const current = { ...ORDER, payment_status: state.orderStatus, razorpay_order_id: state.orderRzpId }
      const row = (col === 'razorpay_order_id' && val === state.orderRzpId) || (col === 'reference' && val === ORDER.reference)
        ? current
        : null
      return jsonRes(200, row ? [row] : [])
    }
    if (method === 'PATCH') {
      return state.patchStatus === 200
        ? jsonRes(200, [ORDER])
        : jsonRes(state.patchStatus, { message: 'simulated patch failure' })
    }
  }

  state.unknownUrls.push(`${method} ${url}`)
  return jsonRes(500, { message: 'unexpected call from test' })
}

const { handle } = await import(
  new URL('../supabase/functions/razorpay-webhook/index.ts', import.meta.url)
)

// --- helpers -----------------------------------------------------------------
const sig = (rawBody) => createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')

function post(rawBody, headers = {}) {
  return handle(
    new Request('https://unit-test.functions.supabase.co/razorpay-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: rawBody,
    }),
  )
}

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

function reset() {
  state.calls.length = 0
  state.duplicateEventIds.clear()
  state.patchStatus = 200
  state.unknownUrls.length = 0
  state.orderStatus = 'pending'
  state.orderRzpId = 'order_rzp_1'
}

const callsTo = (fragment) => state.calls.filter((c) => c.url.includes(fragment))
const dbCalls = () => state.calls.length

const event = (id, eventType, extra = {}) => JSON.stringify({
  id,
  event: eventType,
  payload: {
    payment: {
      entity: {
        id: 'pay_test_1',
        order_id: 'order_rzp_1',
        // The order's total (₹900) in paise, as Razorpay sends it.
        amount: 90000,
        currency: 'INR',
        notes: { reference: 'RCH-TESTTEST' },
        ...extra,
      },
    },
  },
})

// --- test cases --------------------------------------------------------------

// 1. Missing secret ⇒ refuse before anything else, zero database traffic.
{
  reset()
  delete process.env.RAZORPAY_WEBHOOK_SECRET
  const res = await post(event('evt_1', 'payment.captured'), { 'x-razorpay-signature': sig(event('evt_1', 'payment.captured')) })
  check('missing secret → 503, refused', res.status === 503 && (await res.json()).error === 'Webhook is not configured.')
  check('missing secret → zero database operations', dbCalls() === 0, `saw ${dbCalls()}`)
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET
}

// 2. Missing signature header ⇒ 401, no orders touched.
{
  reset()
  const raw = event('evt_2', 'payment.captured')
  const res = await post(raw)
  check('missing signature → 401', res.status === 401)
  check('missing signature → zero database operations', dbCalls() === 0, `saw ${dbCalls()}`)
}

// 3. Invalid signature (garbage) ⇒ 401, no orders touched.
{
  reset()
  const raw = event('evt_3', 'payment.captured')
  const res = await post(raw, { 'x-razorpay-signature': 'deadbeef'.repeat(8) })
  check('invalid signature → 401', res.status === 401)
  check('invalid signature → zero database operations', dbCalls() === 0, `saw ${dbCalls()}`)
}

// 4. Correctly-shaped signature over a *different* body (tampering) ⇒ 401.
{
  reset()
  const raw = event('evt_4', 'payment.captured')
  const tampered = raw.replace('"id":"pay_test_1"', '"id":"pay_evil_9"')
  const res = await post(tampered, { 'x-razorpay-signature': sig(raw) })
  check('tampered body (sig for other payload) → 401', res.status === 401)
  check('tampered body → zero database operations', dbCalls() === 0, `saw ${dbCalls()}`)
}

// 5. Signature is verified BEFORE the body is parsed (rule 1 of the contract):
//    invalid JSON with no signature must be rejected as unauthenticated (401),
//    not as unparseable (400).
{
  reset()
  const res = await post('this is not json')
  check('malformed JSON, no signature → 401 (checked before parse)', res.status === 401, `got ${res.status}`)
  check('malformed JSON, no signature → zero database operations', dbCalls() === 0, `saw ${dbCalls()}`)
}

// 6. Authenticated but unparseable ⇒ 400, still no database traffic.
{
  reset()
  const raw = 'this is not json'
  const res = await post(raw, { 'x-razorpay-signature': sig(raw) })
  check('valid signature over malformed JSON → 400', res.status === 400, `got ${res.status}`)
  check('valid signature over malformed JSON → zero database operations', dbCalls() === 0, `saw ${dbCalls()}`)
}

// 7. Independent cross-check: node:crypto HMAC accepted ⇒ WebCrypto HMAC over
//    the raw body matches Razorpay's documented algorithm.
{
  reset()
  const raw = event('evt_cross', 'payment.authorized')
  const res = await post(raw, { 'x-razorpay-signature': sig(raw) })
  check('node:crypto HMAC accepted (algorithm cross-check)', res.status === 200, `got ${res.status}`)
}

// 8. Unsupported event ⇒ acknowledged, ledger claimed, orders untouched.
{
  reset()
  const raw = event('evt_unsupported', 'payment.authorized')
  const res = await post(raw, { 'x-razorpay-signature': sig(raw) })
  const body = await res.json()
  check('unsupported event → 200 acknowledged', res.status === 200 && body.ok === true)
  check('unsupported event → ledger claimed once', callsTo('razorpay_webhook_events').length === 1)
  check('unsupported event → no order write', callsTo('/rest/v1/orders').filter((c) => c.method === 'PATCH').length === 0)
}

// 9. Unsupported event with no id ⇒ acknowledged with zero database traffic.
{
  reset()
  const raw = JSON.stringify({ event: 'payment.authorized', payload: {} })
  const res = await post(raw, { 'x-razorpay-signature': sig(raw) })
  check('event without id → 200, no ledger row', res.status === 200 && dbCalls() === 0, `calls=${dbCalls()}`)
}

// 10. payment.captured ⇒ marks the matching order paid (guarded PATCH).
{
  reset()
  const raw = event('evt_capture', 'payment.captured')
  const res = await post(raw, { 'x-razorpay-signature': sig(raw) })
  const body = await res.json()
  const patch = callsTo('/rest/v1/orders').find((c) => c.method === 'PATCH')
  const values = patch ? JSON.parse(patch.body) : {}
  check('payment.captured → 200 ok', res.status === 200 && body.ok === true)
  check('payment.captured → PATCH guarded by payment_status=in.(pending,failed)',
    !!patch && patch.url.includes('payment_status=in.(pending,failed)'), patch ? patch.url : 'no patch')
  check('payment.captured → sets paid + paid_at + payment id',
    values.payment_status === 'paid' && typeof values.paid_at === 'string' && values.razorpay_payment_id === 'pay_test_1')
  check('payment.captured → amount/total never written by webhook',
    !('total' in values) && !('subtotal' in values))
}

// 10b. A capture redelivered after a refund ⇒ acknowledged, nothing changes:
//      no order write and no mail-related calls.
{
  reset()
  state.orderStatus = 'refunded'
  const raw = event('evt_capture_after_refund', 'payment.captured')
  const res = await post(raw, { 'x-razorpay-signature': sig(raw) })
  const body = await res.json()
  const orderCalls = callsTo('/rest/v1/orders')
  check('capture after refund → 200 ok, so Razorpay stops redelivering', res.status === 200 && body.ok === true)
  check('capture after refund → order not written',
    orderCalls.filter((c) => c.method === 'PATCH').length === 0)
  check('capture after refund → only the event ledger and the order lookup are touched',
    state.calls.every((c) => c.url.includes('razorpay_webhook_events') || (c.url.includes('/rest/v1/orders') && c.method === 'GET')),
    state.calls.map((c) => `${c.method} ${c.url}`).join(', '))
}

// 10c. order.paid on an order the webhook marked failed earlier ⇒ still settles.
{
  reset()
  state.orderStatus = 'failed'
  const raw = event('evt_paid_after_failed', 'payment.captured')
  await post(raw, { 'x-razorpay-signature': sig(raw) })
  const patch = callsTo('/rest/v1/orders').find((c) => c.method === 'PATCH')
  check('capture after an earlier failed attempt → order settles',
    !!patch && JSON.parse(patch.body).payment_status === 'paid')
}

// 10d. Razorpay's real payload: no `id` in the body, the event id in the
//      `x-razorpay-event-id` header. Before this was read, real events were
//      acknowledged and never applied.
const realEvent = (eventType, extra = {}) => {
  const body = JSON.parse(event('unused', eventType, extra))
  delete body.id
  return JSON.stringify({ entity: 'event', account_id: 'acc_test', ...body, contains: ['payment'], created_at: 1793900000 })
}
{
  reset()
  const raw = realEvent('payment.captured')
  const res = await post(raw, { 'x-razorpay-signature': sig(raw), 'x-razorpay-event-id': 'evt_header_1' })
  const claim = callsTo('razorpay_webhook_events').find((c) => c.method === 'POST')
  const patch = callsTo('/rest/v1/orders').find((c) => c.method === 'PATCH')
  check('real payload (header id) → claimed under the header id',
    res.status === 200 && !!claim && JSON.parse(claim.body).event_id === 'evt_header_1')
  check('real payload (header id) → order marked paid',
    !!patch && JSON.parse(patch.body).payment_status === 'paid')
}
{
  reset()
  state.duplicateEventIds.add('evt_header_dup')
  const raw = realEvent('payment.captured')
  const res = await post(raw, { 'x-razorpay-signature': sig(raw), 'x-razorpay-event-id': 'evt_header_dup' })
  const body = await res.json()
  check('real payload redelivered → duplicate, no order write',
    body.duplicate === true && callsTo('/rest/v1/orders').filter((c) => c.method === 'PATCH').length === 0)
}
{
  reset()
  const raw = realEvent('payment.captured')
  const res = await post(raw, { 'x-razorpay-signature': sig(raw) })
  check('no event id anywhere → acknowledged, nothing written', res.status === 200 && state.calls.length === 0)
}

// 10e. The refund arrives before the capture (delivery order is not
//      guaranteed): the order is recorded refunded, and the capture then
//      leaves it alone (10b).
{
  reset()
  const raw = event('evt_refund_first', 'refund.processed', { captured: true, amount: 90000, amount_refunded: 90000, refund_status: 'full' })
  await post(raw, { 'x-razorpay-signature': sig(raw) })
  const patch = callsTo('/rest/v1/orders').find((c) => c.method === 'PATCH')
  check('refund before capture → a pending order is recorded refunded',
    !!patch && patch.url.includes('pending') && JSON.parse(patch.body).payment_status === 'refunded')
}

// 10f. A late payment on a Razorpay order the checkout has since replaced:
//      the order is found by its reference, but the write is pinned to the
//      Razorpay order that was paid, so the new, different order is untouched.
{
  reset()
  state.orderRzpId = 'order_rzp_2'
  const raw = event('evt_superseded', 'payment.captured')
  await post(raw, { 'x-razorpay-signature': sig(raw) })
  const patch = callsTo('/rest/v1/orders').find((c) => c.method === 'PATCH')
  check('payment on a replaced Razorpay order → write pinned to that Razorpay order',
    !!patch && patch.url.includes('razorpay_order_id=eq.order_rzp_1'), patch ? patch.url : 'no patch')
}

// 10g. A capture that is not exactly the order's total, in rupees, never
//      marks the order paid: the cart behind an unpaid order can be made
//      dearer after its Razorpay order was created.
for (const [label, extra] of [
  ['an underpayment (cart made dearer after the Razorpay order)', { amount: 47900 }],
  ['an overpayment', { amount: 90100 }],
  ['another currency', { currency: 'USD' }],
  ['no amount at all', { amount: undefined }],
]) {
  reset()
  const raw = event(`evt_amount_${label.length}`, 'payment.captured', extra)
  const res = await post(raw, { 'x-razorpay-signature': sig(raw) })
  const body = await res.json()
  check(`${label} → acknowledged, so Razorpay stops redelivering`, res.status === 200 && body.ok === true)
  check(`${label} → order not marked paid, nothing announced`,
    state.calls.every((c) => c.url.includes('razorpay_webhook_events') || (c.url.includes('/rest/v1/orders') && c.method === 'GET')),
    state.calls.map((c) => `${c.method} ${c.url}`).join(', '))
}

// 10h. An event whose payment names no Razorpay order changes nothing, even
//      when its notes point at a real order: the payer controls the notes.
for (const type of ['payment.captured', 'payment.failed', 'refund.processed']) {
  reset()
  const raw = event(`evt_no_rzp_order_${type}`, type, { order_id: undefined, captured: true, amount_refunded: 90000, refund_status: 'full' })
  const res = await post(raw, { 'x-razorpay-signature': sig(raw) })
  check(`${type} without a Razorpay order → acknowledged, order not written`,
    res.status === 200 && callsTo('/rest/v1/orders').filter((c) => c.method === 'PATCH').length === 0)
}

// 11. payment.failed ⇒ pending → failed only.
{
  reset()
  const raw = event('evt_failed', 'payment.failed')
  const res = await post(raw, { 'x-razorpay-signature': sig(raw) })
  const patch = callsTo('/rest/v1/orders').find((c) => c.method === 'PATCH')
  const values = patch ? JSON.parse(patch.body) : {}
  check('payment.failed → 200 ok', res.status === 200)
  check('payment.failed → guarded by payment_status=eq.pending',
    !!patch && patch.url.includes('payment_status=eq.pending'))
  check('payment.failed → sets failed only', values.payment_status === 'failed' && Object.keys(values).length === 1)
}

// 12a. Refunds that are not this order's full refund change nothing.
for (const [label, extra] of [
  ['an automatic refund of an attempt that was never captured', { captured: false, amount: 90000, amount_refunded: 90000, refund_status: 'full' }],
  ['a partial refund (one item returned)', { captured: true, amount: 90000, amount_refunded: 20000, refund_status: 'partial' }],
]) {
  reset()
  state.orderStatus = 'paid'
  const raw = event(`evt_refund_${label.length}`, 'refund.processed', extra)
  const res = await post(raw, { 'x-razorpay-signature': sig(raw) })
  check(`${label} → acknowledged, order not written`,
    res.status === 200 && callsTo('/rest/v1/orders').filter((c) => c.method === 'PATCH').length === 0)
}

// 12b. A full refund only applies to the payment the order holds (or none yet).
{
  reset()
  state.orderStatus = 'paid'
  const raw = event('evt_refund_pinned', 'refund.processed', { captured: true, amount: 90000, amount_refunded: 90000, refund_status: 'full' })
  await post(raw, { 'x-razorpay-signature': sig(raw) })
  const patch = callsTo('/rest/v1/orders').find((c) => c.method === 'PATCH')
  check('full refund → write limited to this payment and this Razorpay order',
    !!patch && patch.url.includes('or=(razorpay_payment_id.is.null,razorpay_payment_id.eq.pay_test_1)') &&
      patch.url.includes('razorpay_order_id=eq.order_rzp_1'), patch ? patch.url : 'no patch')
}

// 12c. payment.failed is tied to the Razorpay order too.
{
  reset()
  const raw = event('evt_failed_pinned', 'payment.failed')
  await post(raw, { 'x-razorpay-signature': sig(raw) })
  const patch = callsTo('/rest/v1/orders').find((c) => c.method === 'PATCH')
  check('payment.failed → write pinned to its Razorpay order',
    !!patch && patch.url.includes('razorpay_order_id=eq.order_rzp_1'))
}

// 12. refund.processed ⇒ paid → refunded only.
{
  reset()
  const raw = event('evt_refund', 'refund.processed', { captured: true, amount: 90000, amount_refunded: 90000, refund_status: 'full' })
  const res = await post(raw, { 'x-razorpay-signature': sig(raw) })
  const patch = callsTo('/rest/v1/orders').find((c) => c.method === 'PATCH')
  check('refund.processed → 200 ok', res.status === 200)
  check('refund.processed → recorded from any state but refunded',
    !!patch && patch.url.includes('payment_status=in.(pending,failed,paid)') && JSON.parse(patch.body).payment_status === 'refunded')
}

// 13. Duplicate delivery (ledger answers 409) ⇒ 200 duplicate ack, no writes,
//     no marker release.
{
  reset()
  state.duplicateEventIds.add('evt_dup')
  const raw = event('evt_dup', 'payment.captured')
  const res = await post(raw, { 'x-razorpay-signature': sig(raw) })
  const body = await res.json()
  check('duplicate event → 200 with duplicate:true', res.status === 200 && body.duplicate === true, `status=${res.status}`)
  check('duplicate event → no order write',
    callsTo('/rest/v1/orders').filter((c) => c.method === 'PATCH').length === 0)
  check('duplicate event → marker NOT released', callsTo('razorpay_webhook_events').filter((c) => c.method === 'DELETE').length === 0)
}

// 14. Processing failure ⇒ marker released so Razorpay's retry can re-claim,
//     and 500 returned.
{
  reset()
  state.patchStatus = 500
  const raw = event('evt_broken', 'payment.captured')
  const res = await post(raw, { 'x-razorpay-signature': sig(raw) })
  const releases = callsTo('razorpay_webhook_events').filter((c) => c.method === 'DELETE')
  check('failed processing → 500 returned', res.status === 500)
  check('failed processing → marker released for retry', releases.length === 1)
}

// 15. Non-POST is refused; OPTIONS preflight answered.
{
  reset()
  const getRes = await handle(new Request('https://unit-test.functions.supabase.co/razorpay-webhook', { method: 'GET' }))
  const optRes = await handle(new Request('https://unit-test.functions.supabase.co/razorpay-webhook', { method: 'OPTIONS' }))
  check('GET → 405', getRes.status === 405)
  check('OPTIONS → 204 preflight', optRes.status === 204)
  check('no unexpected stubbed calls in any case', state.unknownUrls.length === 0, state.unknownUrls.join(', '))
}

// --- summary -----------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
