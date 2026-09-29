// verify-razorpay-payment
//
// The browser reports that Checkout finished; nothing about that report is
// trusted. This function rebuilds the expected signature from its own copy of
// the Razorpay order id and `RAZORPAY_KEY_SECRET`, re-reads the amount from
// Razorpay, and only then writes `payment_status = 'paid'`.
//
// The write goes through the service role — the same privilege no browser
// holds, enforced in the database by `orders_protect_payment_fields`.

import { serve } from '../_shared/deno.ts'
import { MissingConfigError } from '../_shared/env.ts'
import { asString, fail, json, preflight, readJson, type Json } from '../_shared/http.ts'
import { getRazorpayOrder, toPaise, verifyPaymentSignature } from '../_shared/razorpay.ts'
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

export async function handle(req: Request): Promise<Response> {
  const early = preflight(req) ?? (req.method === 'POST' ? null : fail(405, 'Method not allowed.'))
  if (early) return early

  try {
    const body = await readJson(req)
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

    const signatureOk = await verifyPaymentSignature({
      orderId: trustedOrderId,
      paymentId,
      signature,
    })
    if (!signatureOk) return fail(400, BAD_SIGNATURE)

    // Belt and braces: the gateway must have processed exactly our amount.
    let gatewayOrder
    try {
      gatewayOrder = await getRazorpayOrder(trustedOrderId)
    } catch {
      return fail(502, GATEWAY_UNREACHABLE)
    }
    if (gatewayOrder.currency !== 'INR' || gatewayOrder.amount !== toPaise(Number(order.total))) {
      return fail(400, MISMATCH)
    }

    let settled = order
    if (order.payment_status !== 'paid') {
      const res = await serviceFetch(
        `/rest/v1/orders?id=eq.${encodeURIComponent(asString(order.id))}&payment_status=neq.paid`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            payment_status: 'paid',
            paid_at: new Date().toISOString(),
            razorpay_payment_id: paymentId,
          }),
        },
      )
      if (!res.ok) return fail(500, NOT_RECORDED)
      const rows = (await res.json().catch(() => [])) as Json[]
      // Empty means a concurrent callback (or the webhook) won the race and
      // the row is already paid — read it back rather than reporting stale.
      settled = Array.isArray(rows) && rows.length > 0
        ? rows[0]
        : (await fetchOrderByColumn('reference', reference)) ?? order
    }

    const items = await fetchOrderItems(asString(settled.id))
    return json(200, { ok: true, order: { ...settled, items } })
  } catch (error) {
    if (error instanceof MissingConfigError) return fail(503, GATEWAY_UNREACHABLE)
    return fail(500, NOT_RECORDED)
  }
}

serve(handle)
