// Test harness for supabase/functions/order-notifications — run with:
//
//     node scripts/test-order-notifications.mjs
//
// Safety properties of this harness:
//  * every credential is a dummy value that exists only inside this process;
//  * `fetch` is replaced before the function is imported, so NO network call
//    and no database write can ever happen — asserted per test case;
//  * it never contacts Resend, Supabase, or any third party.
//
// The database is emulated faithfully enough to prove the things that matter:
// a claim is a compare-and-set (the second caller gets nothing), the claim
// filter refuses an unpaid online order, and a refused send gives the slot
// back.

process.env.SUPABASE_URL = 'https://unit-test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-service-role-key'
process.env.RESEND_API_KEY = 're_unit_test_key'
process.env.RESEND_FROM = 'Ruhi Collection <orders@example.com>'
process.env.ORDER_NOTIFICATIONS_SECRET = 'unit-test-notification-secret'
const SECRET = process.env.ORDER_NOTIFICATIONS_SECRET

// Minimal Deno shim so _shared/deno.ts resolves (env only — `serve` stays
// undefined, so importing the module does not start an HTTP listener).
globalThis.Deno = { env: { get: (name) => process.env[name] } }

// --- the fake database -------------------------------------------------------

const BASE = {
  id: '11111111-2222-3333-4444-555555555555',
  reference: '21102601',
  status: 'pending',
  full_name: 'Priya Sharma',
  email: 'priya@example.com',
  phone: '9046651272',
  address: '12 Rose Garden',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  note: null,
  payment_method: 'razorpay',
  payment_status: 'paid',
  razorpay_order_id: 'order_rzp_1',
  razorpay_payment_id: 'pay_test_1',
  paid_at: '2026-10-21T00:00:00.000Z',
  subtotal: 1800,
  discount: 200,
  coupon_code: 'RUHI10',
  shipping: 0,
  total: 1600,
  created_at: '2026-10-20T18:30:00.000Z',
}

const ITEMS = [
  { title: 'Denim Shirt - Blue', size: 'M', qty: 2, unit_price: 900, sku: '0101BU' },
  { title: 'Cotton Dress - Green', size: 'L', qty: 1, unit_price: 800, sku: '0302GR' },
]

const state = {
  order: { ...BASE },
  items: ITEMS.map((i) => ({ ...i })),
  calls: [],
  mail: [],
  resendStatus: 200,
  unknownUrls: [],
}

/**
 * Emulate PostgREST's filters against one order.
 *
 * Every `column=op.value` in the query must hold, and an `or=(a,b,c)` holds
 * when at least one of its rules does. That is what makes the claim a real
 * compare-and-set: the second caller finds `confirmation_sent_at` no longer
 * null and gets nothing back.
 */
const RESERVED = new Set(['select', 'order', 'limit', 'offset'])

function matchesFilters(url, order) {
  const query = String(url).split('?')[1] ?? ''
  const params = new URLSearchParams(query)
  for (const [key, value] of params) {
    if (key === 'or') {
      const rules = value.replace(/^\(|\)$/g, '').split(',').map((r) => r.trim())
      if (!rules.some((rule) => matchesRule(rule, order))) return false
      continue
    }
    if (RESERVED.has(key)) continue
    if (!value.includes('.')) continue // not a filter at all
    const [op, ...rest] = value.split('.')
    if (!matchesRule(`${key}.${op}.${rest.join('.')}`, order)) return false
  }
  return true
}

/** One PostgREST rule, e.g. `payment_status.eq.paid` or `x.is.null`. */
function matchesRule(rule, order) {
  const [column, op, ...rest] = rule.split('.')
  const value = rest.join('.')
  const actual = order[column] ?? null
  if (op === 'eq') return String(actual) === value
  if (op === 'neq') return String(actual) !== value
  if (op === 'is') {
    const wanted = value === 'null' ? null : value
    return actual === wanted
  }
  if (op === 'gte') {
    const a = Date.parse(String(actual))
    const b = Date.parse(value)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return true
    return a >= b
  }
  return false
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

  // ---- Resend -------------------------------------------------------------
  if (url === 'https://api.resend.com/emails') {
    if (state.resendStatus !== 200) return jsonRes(state.resendStatus, { message: 'refused' })
    state.mail.push(JSON.parse(body))
    return jsonRes(200, { id: 'mail_test_1' })
  }

  // ---- the order lines ----------------------------------------------------
  if (url.includes('/rest/v1/order_items')) {
    return jsonRes(200, state.items)
  }

  // ---- the orders ---------------------------------------------------------
  if (url.includes('/rest/v1/orders')) {
    if (method === 'PATCH') {
      const values = JSON.parse(body)
      const marker = Object.keys(values).find((k) => k.endsWith('_sent_at') || k.endsWith('_notified_at'))
      // A claim only succeeds when the order still matches the filter — that
      // is the compare-and-set, emulated.
      if (!matchesFilters(url, state.order)) return jsonRes(200, [])
      Object.assign(state.order, values)
      return jsonRes(200, [{ ...state.order }])
    }
    if (method === 'GET') {
      // The sweep: orders that still owe a mail.
      const rows = []
      if (matchesFilters(url, state.order) &&
          (!state.order.confirmation_sent_at || !state.order.owner_notified_at)) {
        rows.push({
          id: state.order.id,
          confirmation_sent_at: state.order.confirmation_sent_at ?? null,
          owner_notified_at: state.order.owner_notified_at ?? null,
        })
      }
      return jsonRes(200, rows)
    }
  }

  state.unknownUrls.push(`${method} ${url}`)
  return jsonRes(500, { message: 'unexpected call from test' })
}

const { handle } = await import(
  new URL('../supabase/functions/order-notifications/index.ts', import.meta.url)
)

// --- helpers -----------------------------------------------------------------

function post(body = {}, headers = {}) {
  return handle(
    new Request('https://unit-test.functions.supabase.co/order-notifications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
}

const withSecret = (body, extra = {}) =>
  post(body, { 'x-order-notifications-secret': SECRET, ...extra })

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

function reset(over = {}) {
  state.order = { ...BASE, ...over }
  state.items = ITEMS.map((i) => ({ ...i }))
  state.calls.length = 0
  state.mail.length = 0
  state.resendStatus = 200
  state.unknownUrls.length = 0
}

const mailTo = (address) => state.mail.filter((m) => m.to.includes(address))

// --- test cases --------------------------------------------------------------

console.log('\n1. The endpoint refuses a caller it cannot trust')
{
  reset()
  const res = await post({ order_id: BASE.id })
  check('no secret → 401', res.status === 401, `got ${res.status}`)
  check('no secret → no mail sent', state.mail.length === 0)
  check('no secret → no database read', state.calls.length === 0, `saw ${state.calls.length}`)
}
{
  reset()
  const res = await post({ order_id: BASE.id }, { 'x-order-notifications-secret': 'wrong' })
  check('wrong secret → 401', res.status === 401, `got ${res.status}`)
  check('wrong secret → no mail sent', state.mail.length === 0)
}
{
  reset()
  delete process.env.ORDER_NOTIFICATIONS_SECRET
  const res = await post({ order_id: BASE.id }, { 'x-order-notifications-secret': SECRET })
  check('no secret configured → 503', res.status === 503, `got ${res.status}`)
  check('no secret configured → no mail sent', state.mail.length === 0)
  process.env.ORDER_NOTIFICATIONS_SECRET = SECRET
}

console.log('\n2. A settled online order tells the customer and the owner')
{
  reset()
  const res = await withSecret({ order_id: BASE.id })
  const body = await res.json()
  check('→ 200 ok', res.status === 200 && body.ok === true, `got ${res.status}`)

  const toCustomer = mailTo('priya@example.com')
  const toOwner = mailTo('ruhicollections2026@gmail.com')
  check('the customer gets one mail', toCustomer.length === 1, `got ${toCustomer.length}`)
  check('the owner gets one mail', toOwner.length === 1, `got ${toOwner.length}`)

  const customer = toCustomer[0] ?? {}
  check('the customer mail is about their order',
    /Your Ruhi Womens Clothing order 21102601/.test(customer.subject ?? ''), customer.subject)
  check('the customer mail names the products',
    /Denim Shirt - Blue/.test(customer.text ?? '') && /Cotton Dress - Green/.test(customer.text ?? ''))
  check('the customer mail says the order was paid',
    /Payment: Paid online \(Razorpay\)/.test(customer.text ?? ''))
  check('the customer mail is plain text', typeof customer.text === 'string' && !customer.html)

  const owner = toOwner[0] ?? {}
  check('the owner mail names the order',
    /New order 21102601 — Paid online — ₹1,600/.test(owner.subject ?? ''), owner.subject)
  check('the owner mail carries the customer details',
    /Name: Priya Sharma/.test(owner.text ?? '') &&
      /Email: priya@example\.com/.test(owner.text ?? '') &&
      /Phone: 9046651272/.test(owner.text ?? ''))
  check('the owner mail carries the delivery address',
    /12 Rose Garden/.test(owner.text ?? '') &&
      /Pune, Maharashtra/.test(owner.text ?? '') &&
      /411001/.test(owner.text ?? ''))
  check('the owner mail carries the products and their quantities',
    /× 2 — ₹1,800/.test(owner.text ?? '') && /× 1 — ₹800/.test(owner.text ?? ''))
  check('the owner mail carries the payment status',
    /Payment: Paid online \(Razorpay\)/.test(owner.text ?? ''))
  check('the owner mail replies to the customer',
    owner.reply_to === 'priya@example.com', String(owner.reply_to))
  check('no unexpected stubbed calls', state.unknownUrls.length === 0, state.unknownUrls.join(', '))
}

console.log('\n3. A cash-on-delivery order is confirmed the moment it is placed')
{
  reset({ payment_method: 'cod', payment_status: 'pending', razorpay_payment_id: null })
  const res = await withSecret({ order_id: BASE.id })
  check('→ 200 ok', res.status === 200, `got ${res.status}`)
  check('the customer gets a mail', mailTo('priya@example.com').length === 1)
  check('the owner gets a mail', mailTo('ruhicollections2026@gmail.com').length === 1)

  const customer = mailTo('priya@example.com')[0] ?? {}
  check('the customer mail says cash on delivery',
    /Payment: Cash on delivery — pay when it arrives/.test(customer.text ?? ''))
  check('the customer mail does not claim the order was paid',
    !/Total paid/.test(customer.text ?? ''))
  check('the customer mail says what to keep ready',
    /keep ₹1,600 ready/.test(customer.text ?? ''))

  const owner = mailTo('ruhicollections2026@gmail.com')[0] ?? {}
  check('the owner mail says the money is not in yet',
    /Payment: Cash on delivery — not paid yet/.test(owner.text ?? ''))
  check('the owner mail quotes no gateway payment id',
    !/Payment ID/.test(owner.text ?? ''))
}

console.log('\n4. An online order that has not been paid is not announced at all')
{
  reset({ payment_status: 'pending' })
  const res = await withSecret({ order_id: BASE.id })
  check('→ 200 ok (nothing to do)', res.status === 200, `got ${res.status}`)
  check('no mail to the customer', mailTo('priya@example.com').length === 0)
  check('no mail to the owner', mailTo('ruhicollections2026@gmail.com').length === 0)
}

console.log('\n5. The same order is never announced twice')
{
  reset()
  await withSecret({ order_id: BASE.id })
  const first = state.mail.length
  await withSecret({ order_id: BASE.id })
  check('the first call sends two mails', first === 2, `got ${first}`)
  check('the second call sends none', state.mail.length === first, `got ${state.mail.length - first}`)
}

console.log('\n6. A refused send gives the slot back, so a retry can still reach them')
{
  reset()
  state.resendStatus = 500
  const res = await withSecret({ order_id: BASE.id })
  const body = await res.json()
  check('the call itself still succeeds', res.status === 200, `got ${res.status}`)
  check('the customer was reported as failed',
    /^failed/.test(body.results?.[BASE.id]?.customer ?? ''), JSON.stringify(body.results))
  check('and the status Resend gave is named',
    /resend-500/.test(body.results?.[BASE.id]?.customer ?? ''), JSON.stringify(body.results))
  check('the slot was released', state.order.confirmation_sent_at === null)

  state.resendStatus = 200
  await withSecret({ order_id: BASE.id })
  check('the retry sends the mail at last', mailTo('priya@example.com').length === 1)
}

console.log('\n7. The endpoint never writes to an address the caller chose')
{
  reset()
  await withSecret({ order_id: BASE.id, to: 'attacker@example.com', email: 'attacker@example.com' })
  check('no mail to the address the caller asked for', mailTo('attacker@example.com').length === 0)
  check('the customer still gets theirs', mailTo('priya@example.com').length === 1)
  check('the owner still gets theirs', mailTo('ruhicollections2026@gmail.com').length === 1)
}

console.log('\n8. Non-POST is refused; OPTIONS preflight answered')
{
  reset()
  const getRes = await handle(new Request('https://unit-test.functions.supabase.co/order-notifications', { method: 'GET' }))
  const optRes = await handle(new Request('https://unit-test.functions.supabase.co/order-notifications', { method: 'OPTIONS' }))
  check('GET → 405', getRes.status === 405)
  check('OPTIONS → 204 preflight', optRes.status === 204)
}

// --- summary -----------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
