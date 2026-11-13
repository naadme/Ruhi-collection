// create-razorpay-order with the A/B tests (orders.experiments), run for real
// against stand-ins for Supabase and Razorpay: the tests are saved in a write
// of their own, nothing else about the order changes, and a failure to save
// them never stands between a shopper and paying.

import test from 'node:test'
import assert from 'node:assert/strict'

const ENV = {
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  RAZORPAY_KEY_ID: 'rzp_live_stub',
  RAZORPAY_KEY_SECRET: 'stub-secret',
}
globalThis.Deno = { env: { get: (name) => ENV[name] } }

const ORDER = {
  id: 'order-uuid-1', reference: '13112601', email: 'shopper@example.com',
  subtotal: 849, shipping: 0, discount: 0, total: 849, coupon_code: null,
  payment_method: 'razorpay', payment_status: 'pending', created_at: '2026-11-13T10:00:00Z',
  razorpay_order_id: null, items: [{ product_id: 'p1', size: 'M', qty: 1 }],
}

let calls = []
let refuseExperiments = false
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  const method = init.method || 'GET'
  const body = init.body ? JSON.parse(init.body) : null
  calls.push({ method, host: u.hostname, path: u.pathname + u.search, body })
  if (u.hostname === 'stub.supabase.co' && u.pathname === '/rest/v1/rpc/create_order') return reply(200, ORDER)
  if (u.hostname === 'stub.supabase.co' && u.pathname === '/rest/v1/orders' && method === 'PATCH') {
    // A database without the column answers as PostgREST does.
    if (refuseExperiments && body && 'experiments' in body) return reply(400, { code: 'PGRST204', message: "Could not find the 'experiments' column of 'orders'" })
    return reply(200, [{ id: ORDER.id }])
  }
  if (u.hostname === 'api.razorpay.com' && u.pathname === '/v1/orders' && method === 'POST') {
    return reply(200, { id: 'order_rzp_1', amount: body.amount, currency: 'INR' })
  }
  throw new Error(`unexpected fetch: ${method} ${url}`)
}

const { handle } = await import('../supabase/functions/create-razorpay-order/index.ts')

const CUSTOMER = {
  email: 'shopper@example.com', full_name: 'Test Shopper', phone: '9876543210',
  address: '12 Test Street', city: 'Pune', state: 'Maharashtra', pincode: '411001',
}

async function place(extra = {}) {
  calls = []
  const res = await handle(new Request('https://stub.supabase.co/functions/v1/create-razorpay-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...CUSTOMER, items: [{ product_id: 'p1', size: 'M', qty: 1 }], attribution: { utm_source: 'Meta_Ads' }, ...extra }),
  }))
  const patches = calls.filter((c) => c.method === 'PATCH').map((c) => c.body)
  return { status: res.status, body: await res.json(), patches }
}

test('the tests are saved on the order in a write of their own', async () => {
  const { status, body, patches } = await place({ experiments: { aa_check: 'b' } })
  assert.equal(status, 200)
  assert.equal(body.razorpay_order_id, 'order_rzp_1')
  assert.deepEqual(patches.filter((p) => 'experiments' in p), [{ experiments: { aa_check: 'b' } }])
  // The ad details' write is as it was, without the tests in it.
  assert.deepEqual(patches.find((p) => 'utm_source' in p), { utm_source: 'Meta_Ads', is_test: false })
})

test('no tests, or a malformed list, means no extra write', async () => {
  for (const extra of [{}, { experiments: { aa_check: 'z' } }, { experiments: 'aa_check:b' }, { experiments: [] }]) {
    const { status, patches } = await place(extra)
    assert.equal(status, 200, JSON.stringify(extra))
    assert.equal(patches.filter((p) => 'experiments' in p).length, 0, JSON.stringify(extra))
  }
})

test('a database that refuses the tests still lets the shopper pay, with the ad details kept', async () => {
  refuseExperiments = true
  try {
    const { status, body, patches } = await place({ experiments: { aa_check: 'a' } })
    assert.equal(status, 200)
    assert.equal(body.razorpay_order_id, 'order_rzp_1')
    assert.ok(patches.some((p) => p.utm_source === 'Meta_Ads'))
  } finally {
    refuseExperiments = false
  }
})
