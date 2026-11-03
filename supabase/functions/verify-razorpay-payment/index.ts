// verify-razorpay-payment
//
// The browser reports that Checkout finished; nothing about that report is
// trusted. This function rebuilds the expected signature from its own copy of
// the Razorpay order id and `RAZORPAY_KEY_SECRET`, re-reads the amount from
// Razorpay, and only then writes `payment_status = 'paid'`.
//
// The write goes through the service role — the same privilege no browser
// holds, enforced in the database by `orders_protect_payment_fields`.
//
// It also records how the shopper paid (`payment_type`, asked of Razorpay),
// and the database decides `new_customer` as the order turns paid; both go
// back to the browser for the purchase event (tracking brief, Section 3). An
// admin's test order (`is_test`) is checked with the test keys it was paid
// with.
//
// `recover: true` is the second way in, for a shopper whose page was reloaded
// while Razorpay's window was open (an Instagram or Facebook in-app browser
// coming back from a UPI app, say): Checkout's signature never reached the
// page, so there is nothing to verify. The browser sends the order reference
// and the Razorpay order id it saved before the window opened, and Razorpay
// itself is asked whether that order was paid. Only a payment Razorpay reports
// as captured, for this order and exactly its amount, settles it.

import { serve } from '../_shared/deno.ts'
import { MissingConfigError } from '../_shared/env.ts'
import { asString, fail, json, preflight, readJson, type Json } from '../_shared/http.ts'
import {
  getRazorpayOrder,
  getRazorpayOrderPayments,
  modeOf,
  paymentMethodOf,
  toPaise,
  verifyPaymentSignature,
} from '../_shared/razorpay.ts'
import { sendOrderConfirmation } from '../_shared/confirmation.ts'
import { sendOwnerNotification } from '../_shared/ownerNotification.ts'
import { syncSheetQuietly } from '../_shared/sheetSyncTrigger.ts'
import { fetchOrderItems, fetchOrderByColumn, serviceFetch } from '../_shared/supabase.ts'

const NOT_FOUND =
  "We couldn't find that order. If you were charged, please contact us quoting your order reference."
const MISMATCH =
  'Payment verification failed. Please contact us quoting your order reference.'
const BAD_SIGNATURE =
  'We could not verify this payment. If you were charged, please contact us quoting your order reference.'
const GATEWAY_UNREACHABLE =
  "We received your payment but could not confirm it with the provider yet. Please don't pay again — try again in a moment."
const NOT_RECORDED =
  "We received your payment but could not record it yet. Please don't pay again — try again in a moment."
// How long a payment attempt counts as still going through.
const IN_FLIGHT_SECONDS = 15 * 60
const CHECK_UNREACHABLE =
  "We couldn't check your payment just now. Please don't pay again — try again in a moment."

export async function handle(req: Request): Promise<Response> {
  const early = preflight(req) ?? (req.method === 'POST' ? null : fail(405, 'Method not allowed.'))
  if (early) return early

  try {
    const body = await readJson(req)
    if (body.recover === true) return await recover(body)

    const reference = asString(body.reference)
    const claimedOrderId = asString(body.razorpay_order_id)
    const paymentId = asString(body.razorpay_payment_id)
    const signature = asString(body.razorpay_signature)

    if (!reference || !claimedOrderId || !paymentId || !signature) {
      return fail(400, MISMATCH)
    }

    const order = await fetchOrderByColumn('reference', reference)
    if (!order) return fail(404, NOT_FOUND)
    if (order.payment_method !== 'razorpay') {
      return fail(400, 'This order was not placed with online payment.')
    }

    // The id we sign with is ours, copied from the database when *we* created
    // the Razorpay order — never the one the browser claims.
    const trustedOrderId = asString(order.razorpay_order_id)
    if (!trustedOrderId || trustedOrderId !== claimedOrderId) return fail(400, MISMATCH)

    // A test order was paid with the test keys, so it is proven with them.
    const mode = modeOf(order)

    const signatureOk = await verifyPaymentSignature({
      orderId: trustedOrderId,
      paymentId,
      signature,
      mode,
    })
    if (!signatureOk) return fail(400, BAD_SIGNATURE)

    // Belt and braces: the gateway must have processed exactly our amount.
    let gatewayOrder
    try {
      gatewayOrder = await getRazorpayOrder(trustedOrderId, mode)
    } catch {
      return fail(502, GATEWAY_UNREACHABLE)
    }
    if (gatewayOrder.currency !== 'INR' || gatewayOrder.amount !== toPaise(Number(order.total))) {
      return fail(400, MISMATCH)
    }

    // UPI, card, netbanking … is chosen inside Razorpay's window, so only
    // Razorpay can say. Empty when it cannot be asked right now.
    const paymentType = await paymentMethodOf(paymentId, trustedOrderId, mode)

    return await settle(order, reference, trustedOrderId, paymentId, paymentType)
  } catch (error) {
    if (error instanceof MissingConfigError) return fail(503, GATEWAY_UNREACHABLE)
    return fail(500, NOT_RECORDED)
  }
}

/**
 * Record a payment that has been proven — by Checkout's signature or by
 * Razorpay itself — and tell the customer and the owner.
 */
async function settle(
  order: Json,
  reference: string,
  razorpayOrderId: string,
  paymentId: string,
  paymentType: string,
): Promise<Response> {
  let settled = order
  if (order.payment_status !== 'paid') {
    const paidAt = new Date().toISOString()
    // Only an order still waiting for money turns paid — never one the owner
    // has refunded meanwhile — and only while it still belongs to the Razorpay
    // order that was paid: a checkout reused with a different cart in the
    // meantime has a new Razorpay order, and its own payment settles it.
    const markPaid = (extra: Json) => serviceFetch(
      `/rest/v1/orders?id=eq.${encodeURIComponent(asString(order.id))}` +
        `&razorpay_order_id=eq.${encodeURIComponent(razorpayOrderId)}&payment_status=in.(pending,failed)`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          payment_status: 'paid',
          paid_at: paidAt,
          razorpay_payment_id: paymentId,
          ...extra,
        }),
      },
    )
    let res = await markPaid(paymentType ? { payment_type: paymentType } : {})
    // A database without the tracking columns refuses the whole write; the
    // payment itself must still be recorded.
    if (!res.ok && paymentType) res = await markPaid({})
    if (!res.ok) return fail(500, NOT_RECORDED)
    const rows = (await res.json().catch(() => [])) as Json[]
    // Empty means a concurrent callback (or the webhook) won the race and
    // the row is already paid — read it back rather than reporting stale.
    settled = Array.isArray(rows) && rows.length > 0
      ? rows[0]
      : (await fetchOrderByColumn('reference', reference)) ?? order
    // The filter can leave the row as it was (refunded, or moved on to
    // another Razorpay order): nothing was settled, so nothing is announced.
    if (settled.payment_status !== 'paid') return json(200, { ok: true, status: 'unpaid' })
  }

  // Already paid without a method on file (the webhook got there first):
  // fill it in. Best effort — the payment itself is settled either way.
  if (paymentType && !asString(settled.payment_type)) {
    try {
      const res = await serviceFetch(
        `/rest/v1/orders?id=eq.${encodeURIComponent(asString(settled.id))}&payment_type=is.null`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ payment_type: paymentType }),
        },
      )
      const rows = res.ok ? ((await res.json().catch(() => [])) as Json[]) : []
      if (Array.isArray(rows) && rows.length > 0) settled = { ...settled, ...rows[0] }
    } catch (error) {
      console.warn('[verify-razorpay-payment] payment type not saved:', String(error))
    }
  }

  // The payment is on file. Telling the customer and telling the owner are
  // separate concerns from proving it, so a mail failure is logged and
  // swallowed — it must never turn a payment we HAVE verified into an error
  // the shopper sees. Both helpers are idempotent, so arriving alongside
  // the webhook — or arriving again on a retry — is safe.
  try {
    await sendOrderConfirmation(asString(settled.id))
  } catch (error) {
    console.warn('[verify-razorpay-payment] confirmation not sent:', String(error))
  }
  try {
    await sendOwnerNotification(asString(settled.id))
  } catch (error) {
    console.warn('[verify-razorpay-payment] owner notification not sent:', String(error))
  }

  // The order is real, so the owner's spreadsheet gets it now. The sheet is
  // a record, not a part of the payment: a failure here is logged and
  // swallowed, and the daily job sends the order later.
  const synced = await syncSheetQuietly()
  if (synced) console.log('[verify-razorpay-payment] sheet:', synced)

  const items = await fetchOrderItems(asString(settled.id))
  return json(200, { ok: true, status: 'paid', order: { ...settled, items } })
}

async function recover(body: Json): Promise<Response> {
  const reference = asString(body.reference)
  const claimedOrderId = asString(body.razorpay_order_id)
  if (!reference || !claimedOrderId) return fail(400, MISMATCH)

  const order = await fetchOrderByColumn('reference', reference)
  if (!order) return fail(404, NOT_FOUND)
  if (order.payment_method !== 'razorpay') {
    return fail(400, 'This order was not placed with online payment.')
  }
  // Knowing both ids is what ties this browser to the order: the Razorpay
  // order id was only ever handed to the page that started the payment.
  const trustedOrderId = asString(order.razorpay_order_id)
  if (!trustedOrderId) return fail(400, MISMATCH)
  if (trustedOrderId !== claimedOrderId) {
    // The checkout was started again with a different cart, which gave the
    // order a new Razorpay order: this browser's saved one is out of date.
    // That is an answer, not an error — Razorpay is never asked about an id
    // the database no longer holds, and nothing about the order is returned.
    return json(200, { ok: true, status: 'unpaid' })
  }

  // The webhook may have settled it already.
  if (order.payment_status === 'paid') {
    const items = await fetchOrderItems(asString(order.id))
    return json(200, { ok: true, status: 'paid', order: { ...order, items } })
  }
  // Refunded (or anything else that is not waiting for money) is final here.
  if (order.payment_status !== 'pending' && order.payment_status !== 'failed') {
    return json(200, { ok: true, status: 'unpaid' })
  }

  const mode = modeOf(order)
  let gatewayOrder
  let payments
  try {
    gatewayOrder = await getRazorpayOrder(trustedOrderId, mode)
    payments = await getRazorpayOrderPayments(trustedOrderId, mode)
  } catch {
    return fail(502, CHECK_UNREACHABLE)
  }
  const amount = toPaise(Number(order.total))
  if (gatewayOrder.currency !== 'INR' || gatewayOrder.amount !== amount) return fail(400, MISMATCH)

  // A partly refunded payment stays `captured` with a `refund_status`, so
  // only one with no refund at all counts.
  const captured = payments.find((p) =>
    p.status === 'captured' && !p.refund_status &&
    p.order_id === trustedOrderId && p.amount === amount && p.currency === 'INR')
  if (captured) {
    const paymentType = typeof captured.method === 'string' ? captured.method.trim().toLowerCase() : ''
    return await settle(order, reference, trustedOrderId, captured.id, paymentType)
  }

  // `created` is a payment still waiting for the shopper (a UPI request not
  // yet approved); `authorized` is one Razorpay is about to capture. The
  // Razorpay order is reused across attempts, so only a recent attempt counts:
  // UPI requests expire within about 10 minutes.
  const since = Math.floor(Date.now() / 1000) - IN_FLIGHT_SECONDS
  const inFlight = payments.some((p) =>
    (p.status === 'created' || p.status === 'authorized') && Number(p.created_at) >= since)
  return json(200, { ok: true, status: inFlight ? 'processing' : 'unpaid' })
}

serve(handle)
