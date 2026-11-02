// create-razorpay-order
//
// Turns a validated cart into (a) an application order priced by the database
// and (b) a matching Razorpay order, then hands the browser only what Checkout
// needs: the public Key ID, the amount in paise and the Razorpay order id.
//
// The browser never sends an amount. `public.create_order()` prices every line
// from `public.products` and computes shipping with the same rule the storefront
// displays, and the value this function sends to Razorpay is derived from that
// result — nothing else.
//
// Two things ride along for the tracking brief:
//   * `attribution` — the shopper's latest ad visit (UTM tags, click IDs,
//     landing page), saved on the order before the payment window opens
//     (Section 4, step 4). Saving it never stands between a shopper and paying.
//   * `test: true` — an admin's test order (rule 10): paid with Razorpay's test
//     keys, so no money moves, and marked `is_test` so reports can leave it out.

import { serve } from '../_shared/deno.ts'
import { MissingConfigError } from '../_shared/env.ts'
import { asString, fail, json, preflight, readJson, type Json } from '../_shared/http.ts'
import { attributionColumns } from '../_shared/attribution.mjs'
import {
  createRazorpayOrder,
  credentials,
  getRazorpayOrder,
  RazorpayApiError,
  toPaise,
  type RazorpayMode,
} from '../_shared/razorpay.ts'
import { callerIsAdmin, rpcCreateOrder, serviceFetch } from '../_shared/supabase.ts'

// Shown when the shopper can't actually pay online: the Key ID / Key Secret
// Edge Function secrets are missing, or Razorpay rejected them with a 401.
// It names Razorpay and the environment honestly, and it must never suggest an
// offline payment method — there are none left in this store.
const NOT_CONFIGURED =
  'Razorpay is not switched on in this environment yet, so online payment is unavailable. Please contact us to place your order.'
const UNREACHABLE =
  'We could not reach the payment provider. You have not been charged — please try again.'
const GENERIC =
  'We could not start your payment. You have not been charged — please try again.'
const TOO_SMALL =
  'Online payment starts at ₹1. Please contact us to place this order.'
const TEST_ADMINS_ONLY =
  'Test orders can only be placed by the shop’s admins. Sign in with an admin account, or turn test mode off.'
const TEST_NOT_CONFIGURED =
  'Test payments are not set up yet: the Razorpay test keys are missing from Supabase. Nothing has been charged.'

// Razorpay refuses any order below 100 paise (₹1) with a 400 of its own;
// refusing it here keeps that gateway error out of the shopper's view.
const MIN_AMOUNT_PAISE = 100

/** Cart lines as the checkout sends them: ids, sizes and quantities only. */
function readItems(value: unknown): Json[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null
  const items: Json[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const item = raw as Json
    const productId = asString(item.product_id)
    const size = asString(item.size)
    const qty = Number(item.qty)
    if (!productId || !size || !Number.isInteger(qty)) return null
    items.push({ product_id: productId, size, qty })
  }
  return items
}

function buildPayload(body: Json, items: Json[]): Json {
  return {
    email: asString(body.email),
    full_name: asString(body.full_name),
    phone: asString(body.phone),
    address: asString(body.address),
    city: asString(body.city),
    state: asString(body.state),
    pincode: asString(body.pincode),
    note: asString(body.note),
    payment_method: 'razorpay',
    items,
    // A coupon code is only ever a REQUEST: `create_order()` re-validates it
    // in the database and computes the discount itself.
    coupon_code: asString(body.coupon_code),
  }
}

/**
 * Keep one Razorpay order per application order. A retry with an unchanged
 * cart reuses the gateway order we already made; a changed cart mints a new
 * one so the amount always matches what the database priced.
 */
async function resolveRazorpayOrder(
  orderId: string,
  reference: string,
  email: string,
  amountPaise: number,
  existingId: string,
  mode: RazorpayMode,
): Promise<string> {
  // A gateway order made in the other mode belongs to the other set of keys:
  // asking for it fails, and a fresh one is minted in this mode.
  if (existingId) {
    try {
      const existing = await getRazorpayOrder(existingId, mode)
      if (existing.currency === 'INR' && existing.amount === amountPaise) return existing.id
    } catch {
      /* fall through and mint a fresh one */
    }
  }

  const created = await createRazorpayOrder({
    amountPaise,
    currency: 'INR',
    receipt: reference,
    notes: { reference, email },
  }, mode)

  const res = await serviceFetch(
    `/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&payment_status=neq.paid`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ razorpay_order_id: created.id }),
    },
  )
  if (!res.ok) throw new Error('could-not-record-razorpay-order')
  const rows = (await res.json().catch(() => [])) as Json[]
  // Empty means the order settled between the two calls — never overwrite it.
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('order-already-settled')

  return created.id
}

/**
 * Save the ad visit and the order's mode on the order. Returns whether the
 * write landed; a paid order is never touched.
 */
async function recordOrderContext(orderId: string, values: Json): Promise<boolean> {
  try {
    const res = await serviceFetch(
      `/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&payment_status=neq.paid`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(values),
      },
    )
    if (!res.ok) console.warn('[create-razorpay-order] order context not saved:', res.status)
    return res.ok
  } catch (error) {
    console.warn('[create-razorpay-order] order context not saved:', String(error))
    return false
  }
}

export async function handle(req: Request): Promise<Response> {
  const early = preflight(req) ?? (req.method === 'POST' ? null : fail(405, 'Method not allowed.'))
  if (early) return early

  try {
    const body = await readJson(req)
    const items = readItems(body.items)
    if (!items) {
      return fail(400, 'Your cart is empty. Add a product before checking out.')
    }

    // A test order is an admin's alone, and checked here rather than trusted:
    // anyone else asking for one is refused, never quietly charged for real.
    const authorization = req.headers.get('authorization')
    const mode: RazorpayMode = body.test === true ? 'test' : 'live'
    if (mode === 'test' && !(await callerIsAdmin(authorization))) {
      return fail(403, TEST_ADMINS_ONLY)
    }

    // Fail before anything is written: an unconfigured store must not leave a
    // half-made order behind for the shopper to trip over later.
    let keyId: string
    try {
      keyId = credentials(mode).keyId
    } catch (error) {
      if (mode === 'test' && error instanceof MissingConfigError) return fail(503, TEST_NOT_CONFIGURED)
      throw error
    }

    const created = await rpcCreateOrder(buildPayload(body, items), authorization)
    if (!created.ok || !created.data) {
      return fail(400, created.message ?? GENERIC)
    }

    const order = created.data
    const reference = asString(order.reference)
    const orderId = asString(order.id)
    const email = asString(order.email)
    const total = Number(order.total)
    const amountPaise = toPaise(total)
    if (!reference || !orderId || !Number.isFinite(amountPaise) || amountPaise <= 0) {
      return fail(500, GENERIC)
    }
    if (amountPaise < MIN_AMOUNT_PAISE) {
      return fail(400, TOO_SMALL)
    }

    // The mode is written every time, so a checkout reused after test mode
    // was switched off is a real order again. A test order that cannot be
    // marked must not be paid: verification would use the wrong keys.
    const recorded = await recordOrderContext(orderId, {
      ...attributionColumns(body.attribution),
      is_test: mode === 'test',
    })
    if (!recorded && mode === 'test') return fail(500, GENERIC)

    const razorpayOrderId = await resolveRazorpayOrder(
      orderId,
      reference,
      email,
      amountPaise,
      asString(order.razorpay_order_id),
      mode,
    )

    return json(200, {
      key_id: keyId,
      razorpay_order_id: razorpayOrderId,
      amount: amountPaise,
      currency: 'INR',
      reference,
      subtotal: order.subtotal,
      shipping: order.shipping,
      // The discount `create_order()` itself computed, echoed so Checkout can
      // check that what it shows the shopper matches what Razorpay charges.
      // Absent on a database whose coupon migration has not run, where JSON
      // simply omits the key and Checkout compares totals instead.
      discount: order.discount,
      coupon_code: order.coupon_code,
      total: order.total,
      payment_method: order.payment_method,
      payment_status: order.payment_status,
      created_at: order.created_at,
      items: order.items,
      is_test: mode === 'test',
    })
  } catch (error) {
    if (error instanceof MissingConfigError) return fail(503, NOT_CONFIGURED)
    if (error instanceof RazorpayApiError) {
      // 401 means Razorpay rejected *our* credentials — a configuration fault
      // on this server, not a gateway outage, and never something the shopper
      // can fix or should see raw.
      if (error.status === 401) return fail(503, NOT_CONFIGURED)
      return fail(502, UNREACHABLE)
    }
    return fail(500, GENERIC)
  }
}

serve(handle)
