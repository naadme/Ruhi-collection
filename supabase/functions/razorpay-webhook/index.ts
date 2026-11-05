// razorpay-webhook
//
// Razorpay's server calls this after the fact — the safety net for a shopper
// who paid and then closed the tab before verification could run.
//
// Three rules, in order:
//   1. the HMAC over the *raw* body is checked before the body is parsed;
//   2. a `RAZORPAY_WEBHOOK_SECRET` that has not been configured means the
//      event is refused, not waved through;
//   3. each event id is consumed once (`razorpay_webhook_events`), and the
//      marker is rolled back if processing fails so Razorpay's retry lands.

import { serve } from '../_shared/deno.ts'
import { env } from '../_shared/env.ts'
import { asString, fail, json, preflight, type Json } from '../_shared/http.ts'
import { verifyWebhookSignature } from '../_shared/razorpay.ts'
import { sendOrderConfirmation } from '../_shared/confirmation.ts'
import { sendOwnerNotification } from '../_shared/ownerNotification.ts'
import { syncSheetQuietly } from '../_shared/sheetSyncTrigger.ts'
import {
  fetchOrderByColumn,
  serviceFetch,
} from '../_shared/supabase.ts'

const PAY_NOT_CONFIGURED = 'Webhook is not configured.'
const PAY_BAD_SIGNATURE = 'Invalid signature.'
const PAY_NOT_RECORDED = 'Could not record this event.'
const PAY_FAILED = 'Could not process this event.'
// The orders a capture may turn paid: never one already paid or refunded.
const SETTLEABLE = 'payment_status=in.(pending,failed)'

/** Look the order up by whichever Razorpay id the event actually carries. */
async function findOrder(event: Json, payment: Json | null): Promise<Json | null> {
  const orderId = asString(payment?.order_id)
  if (orderId) {
    const byOrder = await fetchOrderByColumn('razorpay_order_id', orderId)
    if (byOrder) return byOrder
  }

  const notes = payment?.notes
  const reference = asString(notes && typeof notes === 'object' ? (notes as Json).reference : '')
  if (reference) {
    const byReference = await fetchOrderByColumn('reference', reference)
    if (byReference) return byReference
  }

  // A Razorpay payment entity carries its own id as `id` (pay_…).
  const paymentId = asString(payment?.id)
  if (paymentId) return fetchOrderByColumn('razorpay_payment_id', paymentId)

  // `order.paid` nests the payment entity; some events don't, so fall back to
  // the order id embedded at the top of the payload.
  const payload = event.payload
  const orderEntity = payload && typeof payload === 'object' ? (payload as Json).order : null
  const nested = orderEntity && typeof orderEntity === 'object' ? (orderEntity as Json).entity : null
  const nestedId = asString(nested?.id)
  return nestedId ? fetchOrderByColumn('razorpay_order_id', nestedId) : null
}

async function patchOrder(orderId: string, where: string, values: Json): Promise<void> {
  const res = await serviceFetch(
    `/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&${where}`,
    { method: 'PATCH', body: JSON.stringify(values) },
  )
  // A rejected write must surface so the event marker is released and
  // Razorpay's retry gets another attempt.
  if (!res.ok) throw new Error('order-patch-failed')
}

/** Apply one event. Every write is idempotent, so a repeat is harmless. */
async function applyEvent(eventType: string, event: Json): Promise<void> {
  const payload = event.payload
  const paymentEntity = payload && typeof payload === 'object' ? (payload as Json).payment : null
  const payment = paymentEntity && typeof paymentEntity === 'object'
    ? ((paymentEntity as Json).entity as Json | null) ?? null
    : null

  const order = await findOrder(event, payment)
  if (!order) return
  const orderId = asString(order.id)
  if (!orderId) return

  const paymentId = asString(payment?.id)
  // Writes only touch the order while it still belongs to the Razorpay order
  // this payment was made on — the same rule verify-razorpay-payment uses. A
  // checkout restarted with a different cart gets a new Razorpay order, and a
  // late payment or refund on the old one must not settle or refund the new.
  const rzpOrderId = asString(payment?.order_id)
  const pinned = rzpOrderId ? `&razorpay_order_id=eq.${encodeURIComponent(rzpOrderId)}` : ''

  switch (eventType) {
    case 'order.paid':
    case 'payment.captured': {
      // A refunded order stays refunded. Razorpay can redeliver an old
      // capture event after the owner has refunded; it is acknowledged and
      // changes nothing — no status, and no confirmation mails sent again.
      if (order.payment_status === 'refunded') return
      const paid = {
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        ...(paymentId ? { razorpay_payment_id: paymentId } : {}),
      }
      // How the shopper paid, for the purchase event (tracking brief,
      // Section 3). A database without that column refuses the whole write,
      // so the payment is then recorded without it.
      const method = asString(payment?.method).trim().toLowerCase()
      // Only an order still waiting for money turns paid — the same rule
      // verify-razorpay-payment uses — so a refund landing at the same moment
      // as a redelivered capture cannot be overwritten.
      try {
        await patchOrder(orderId, SETTLEABLE + pinned, method ? { ...paid, payment_type: method } : paid)
      } catch (error) {
        if (!method) throw error
        await patchOrder(orderId, SETTLEABLE + pinned, paid)
      }
      // Tell the customer and the owner, but never at the cost of the
      // acknowledgement: a non-2xx answer here makes Razorpay redeliver this
      // event, and a mail hiccup must not turn into a redelivery storm. The
      // helpers themselves are idempotent, so arriving alongside the browser's
      // verification — or arriving again on Razorpay's retry — is safe.
      try {
        await sendOrderConfirmation(orderId)
      } catch (error) {
        console.warn('[razorpay-webhook] confirmation not sent:', String(error))
      }
      try {
        await sendOwnerNotification(orderId)
      } catch (error) {
        console.warn('[razorpay-webhook] owner notification not sent:', String(error))
      }
      // The payment is settled, so the owner's spreadsheet gets the order now.
      // A failure here is logged and swallowed: the sheet is a record, not
      // part of the payment, and the daily job sends it later.
      const synced = await syncSheetQuietly()
      if (synced) console.log('[razorpay-webhook] sheet:', synced)
      return
    }
    case 'payment.failed': {
      // Never demote an order that already settled through verification.
      await patchOrder(orderId, 'payment_status=eq.pending' + pinned, { payment_status: 'failed' })
      return
    }
    case 'refund.processed':
    case 'refund.updated': {
      // Razorpay refunds an attempt that was authorised after another attempt
      // had already paid the order, on its own; that payment was never
      // captured, never paid for this order, and must not mark it refunded.
      if (payment?.captured === false) return
      // Only a full refund makes the order "refunded". After a partial one
      // (an item returned) the order is still mostly paid, and may still
      // need shipping; the owner sees the partial refund in Razorpay.
      const amount = Number(payment?.amount)
      const refunded = Number(payment?.amount_refunded)
      const full = payment?.refund_status === 'full' || (amount > 0 && refunded >= amount)
      if (!full) return
      // A full refund proves the money was taken and given back, whatever this
      // database has heard so far: Razorpay does not promise delivery order,
      // so the refund can arrive before the capture. It is recorded from any
      // state but `refunded` — a capture arriving later then leaves it alone —
      // but only for the payment the order holds, or none yet: a refund of a
      // different attempt on the same Razorpay order is not this order's.
      const samePayment = paymentId
        ? `&or=(razorpay_payment_id.is.null,razorpay_payment_id.eq.${encodeURIComponent(paymentId)})`
        : ''
      await patchOrder(orderId, 'payment_status=in.(pending,failed,paid)' + pinned + samePayment, { payment_status: 'refunded' })
      return
    }
    default:
      // Events we do not act on are still acknowledged so Razorpay stops retrying.
      return
  }
}

/** Claim the event id. Returns `false` when it was already processed. */
async function claimEvent(eventId: string, eventType: string): Promise<boolean | 'error'> {
  const res = await serviceFetch('/rest/v1/razorpay_webhook_events', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ event_id: eventId, event_type: eventType }),
  })
  // PostgREST answers a repeated primary key with 409 Conflict, not with an
  // empty representation — that *is* the "already claimed" outcome, so a
  // Razorpay retry of a settled event is acknowledged instead of answered
  // with a 500 that would make it retry again.
  if (res.status === 409) return false
  if (!res.ok) return 'error'
  const rows = (await res.json().catch(() => [])) as Json[]
  return Array.isArray(rows) && rows.length > 0
}

async function releaseEvent(eventId: string): Promise<void> {
  await serviceFetch(
    `/rest/v1/razorpay_webhook_events?event_id=eq.${encodeURIComponent(eventId)}`,
    { method: 'DELETE' },
  )
}

export async function handle(req: Request): Promise<Response> {
  const early = preflight(req) ?? (req.method === 'POST' ? null : fail(405, 'Method not allowed.'))
  if (early) return early

  // Read the body first: the signature covers the exact bytes Razorpay sent.
  const rawBody = await req.text()

  // Rule 2 before rule 1: without a configured secret there is nothing to
  // verify against, and an unverifiable webhook is refused outright.
  if (!env('RAZORPAY_WEBHOOK_SECRET')) return fail(503, PAY_NOT_CONFIGURED)

  // Rule 1: the HMAC over the *raw* bytes is checked before the body is even
  // parsed — an unauthenticated payload is never turned into JSON we act on,
  // and nothing has touched the database at this point.
  const signature = req.headers.get('x-razorpay-signature') ?? ''
  const signatureOk = await verifyWebhookSignature(rawBody, signature)
  if (!signatureOk) return fail(401, PAY_BAD_SIGNATURE)

  let event: Json
  try {
    event = JSON.parse(rawBody) as Json
  } catch {
    return fail(400, 'Invalid payload.')
  }

  // Razorpay sends each event's unique id in the `x-razorpay-event-id`
  // header; the body has none. (A body `id` is still accepted for events
  // posted by hand when testing.) Before this was read, every real event was
  // acknowledged below and never applied.
  const eventId = (req.headers.get('x-razorpay-event-id') ?? '').trim() || asString(event.id)
  const eventType = asString(event.event)
  // Without an id there is nothing to deduplicate against; acknowledge it so
  // Razorpay does not retry forever.
  if (!eventId) return json(200, { ok: true })

  try {
    const claimed = await claimEvent(eventId, eventType)
    if (claimed === 'error') return fail(500, PAY_NOT_RECORDED)
    if (!claimed) return json(200, { ok: true, duplicate: true })

    try {
      await applyEvent(eventType, event)
    } catch {
      await releaseEvent(eventId)
      return fail(500, PAY_FAILED)
    }

    return json(200, { ok: true })
  } catch {
    return fail(500, PAY_FAILED)
  }
}

serve(handle)
