// The new-order notification the store owner receives.
//
// Same shape as the customer's confirmation and the same three rules, because
// it has exactly the same failure modes:
//
//   1. NEVER for an order that is not real. An online order is announced when
//      the gateway says the money arrived; a cash-on-delivery order is
//      announced the moment it is placed. An abandoned checkout is never
//      announced, because it is not an order yet.
//   2. NEVER twice. The owner's mailbox gets one notification per order, even
//      though the shopper's browser and Razorpay's webhook both reach for the
//      same order and either can be retried. The guard is a compare-and-set on
//      `orders.owner_notified_at`: exactly one caller ever gets a row back.
//   3. NEVER silently lost. If Resend refuses the send, the claim is rolled
//      back so the next attempt can try again.
//
// The recipient is a constant. Nothing a caller can send decides where this
// goes, and nothing a caller can send can make it say anything else: the body
// is built from the order as the database holds it.

import { env, MissingConfigError, requireEnv } from './env.ts'
import { asString, type Json } from './http.ts'
import { serviceFetch } from './supabase.ts'
import { sendMail, ResendError } from './resend.ts'
import {
  buildOwnerNotificationSubject,
  buildOwnerNotificationText,
} from './orderEmail.mjs'

/** The one mailbox that receives new-order notifications. */
const DEFAULT_TO = 'ruhicollections2026@gmail.com'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The orders this module may announce.
 *
 * The same two rules the customer's confirmation uses: a settled online order,
 * or a cash-on-delivery order that has just been placed — and never a
 * cancelled one, which is not something to announce to the owner as a sale.
 */
const ANNOUNCABLE = 'or=(payment_status.eq.paid,payment_method.eq.cod)&status=neq.cancelled'

export type OwnerOutcome =
  | { sent: true; reference: string }
  | {
      sent: false
      reason: 'already-sent' | 'not-paid' | 'no-recipient' | 'not-configured' | 'failed'
      /** A short, secret-free note about why — e.g. which status Resend gave. */
      detail?: string
    }

/** Where the notification goes. The owner may move it with a secret. */
export function ownerAddress(): string {
  return (env('OWNER_EMAIL') ?? DEFAULT_TO).trim()
}

/**
 * Claim the "owner notified" slot for this order.
 *
 * Returns the order facts when this caller won the race, or null when the
 * order is not announceable or has already been announced. Postgres serialises
 * concurrent updates to the same row, so exactly one caller ever gets a row.
 */
async function claim(orderId: string): Promise<Json | null> {
  const res = await serviceFetch(
    `/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}` +
      `&owner_notified_at=is.null&${ANNOUNCABLE}` +
      '&select=id,reference,created_at,email,full_name,phone,address,city,state,pincode,' +
      'subtotal,discount,coupon_code,shipping,total,status,note,payment_method,payment_status,' +
      'razorpay_payment_id',
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ owner_notified_at: new Date().toISOString() }),
    },
  )
  if (!res.ok) return null
  const rows = (await res.json().catch(() => [])) as Json[]
  return Array.isArray(rows) && rows.length ? rows[0] : null
}

/** Give the slot back so a later retry can send. Never throws. */
async function release(orderId: string): Promise<void> {
  try {
    await serviceFetch(`/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ owner_notified_at: null }),
    })
  } catch (error) {
    console.warn('[owner-notification] could not release claim:', String(error))
  }
}

/**
 * The order's lines, as stored — never computed in the browser.
 *
 * A failed query is NOT an empty order. It throws, so the caller abandons the
 * send instead of telling the owner about an order with no products in it.
 */
async function fetchItems(orderId: string): Promise<Json[]> {
  // Only columns `public.order_items` actually has — see the note in
  // `confirmation.ts`: asking for a column the table does not carry makes
  // PostgREST answer 400 and the mail goes out with no items at all. The
  // `eq.` matters for the same reason: a bare value is read by PostgREST as
  // "not equal to" and the filter is refused.
  const res = await serviceFetch(
    `/rest/v1/order_items?order_id=eq.${encodeURIComponent(orderId)}` +
      '&select=title,size,qty,unit_price,sku&order=created_at.asc',
  )
  if (!res.ok) {
    console.warn('[owner-notification] order_items query failed:', res.status, await res.text())
    throw new Error('order-items-unavailable')
  }
  const rows = (await res.json().catch(() => [])) as Json[]
  return Array.isArray(rows) ? rows : []
}

/**
 * Tell the owner about `orderId` if — and only if — this call is the first to
 * see the order settle (or to see a cash-on-delivery order placed).
 */
export async function sendOwnerNotification(orderId: string): Promise<OwnerOutcome> {
  if (!orderId) return { sent: false, reason: 'not-paid' }

  // Fail BEFORE claiming when the store has no mail key, so an unconfigured
  // environment never burns the one and only send attempt.
  try {
    requireEnv('RESEND_API_KEY')
  } catch {
    return { sent: false, reason: 'not-configured' }
  }

  const to = ownerAddress()
  if (!EMAIL_RE.test(to)) return { sent: false, reason: 'no-recipient' }

  const order = await claim(orderId)
  // Not announceable, already announced, or no such order.
  if (!order) return { sent: false, reason: 'already-sent' }

  const reference = asString(order.reference)

  try {
    const items = await fetchItems(orderId)
    await sendMail({
      to,
      subject: buildOwnerNotificationSubject(order),
      text: buildOwnerNotificationText(order, items),
      // Answering the notification answers the customer directly.
      replyTo: asString(order.email).trim() || undefined,
    })
    return { sent: true, reference }
  } catch (error) {
    // A refused or failed send must not permanently silence this order.
    await release(orderId)
    if (error instanceof MissingConfigError) return { sent: false, reason: 'not-configured' }
    if (error instanceof ResendError) {
      return { sent: false, reason: 'failed', detail: `resend-${error.status}` }
    }
    console.warn('[owner-notification] delivery failed:', String(error))
    return { sent: false, reason: 'failed' }
  }
}
