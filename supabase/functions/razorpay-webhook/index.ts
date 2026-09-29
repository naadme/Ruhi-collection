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
import {
  fetchOrderByColumn,
  serviceFetch,
} from '../_shared/supabase.ts'

const PAY_NOT_CONFIGURED = 'Webhook is not configured.'
const PAY_BAD_SIGNATURE = 'Invalid signature.'
const PAY_NOT_RECORDED = 'Could not record this event.'
const PAY_FAILED = 'Could not process this event.'

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

  const paymentId = asString(payment?.payment_id)
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

  const paymentId = asString(payment?.payment_id)

  switch (eventType) {
    case 'order.paid':
    case 'payment.captured': {
      await patchOrder(orderId, 'payment_status=neq.paid', {
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        ...(paymentId ? { razorpay_payment_id: paymentId } : {}),
      })
      return
    }
    case 'payment.failed': {
      // Never demote an order that already settled through verification.
      await patchOrder(orderId, 'payment_status=eq.pending', { payment_status: 'failed' })
      return
    }
    case 'refund.processed':
    case 'refund.updated': {
      await patchOrder(orderId, 'payment_status=eq.paid', { payment_status: 'refunded' })
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

  if (!env('RAZORPAY_WEBHOOK_SECRET')) return fail(503, PAY_NOT_CONFIGURED)

  let event: Json
  try {
    event = JSON.parse(rawBody) as Json
  } catch {
    return fail(400, 'Invalid payload.')
  }

  const signature = req.headers.get('x-razorpay-signature') ?? ''
  const signatureOk = await verifyWebhookSignature(rawBody, signature)
  if (!signatureOk) return fail(401, PAY_BAD_SIGNATURE)

  const eventId = asString(event.id)
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
