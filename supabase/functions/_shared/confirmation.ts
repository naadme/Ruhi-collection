// Order confirmation email, shared by the two functions that can be the first
// to know a Razorpay payment succeeded: `verify-razorpay-payment` (called by
// the shopper's browser) and `razorpay-webhook` (called by Razorpay's servers).
// It is also what `order-notifications` uses for a cash-on-delivery order.
//
// There is deliberately NO public endpoint here. A separate HTTP function
// would hand anyone who could reach it a way to make the store email arbitrary
// addresses; this module is imported in-process by code that already runs on
// the payment server with the service role, so no new surface is exposed.
//
// Three rules, all of them load-bearing:
//
//   1. NEVER before verification. The claim query below requires the order to
//      be paid — or to be a cash-on-delivery order, which is confirmed the
//      moment it is placed. An online order that is not paid yet matches
//      neither rule, and the database refuses `payment_status = 'paid'` from
//      every browser session.
//   2. NEVER twice. Both callers race for the same order and either can be
//      retried, so sending is gated by a compare-and-set on
//      `orders.confirmation_sent_at`: exactly one caller ever gets a row back.
//   3. NEVER silently lost. If Resend refuses the send, the claim is rolled
//      back so the next verification or webhook delivery can try again.

import { MissingConfigError, requireEnv } from './env.ts'
import { asString, type Json } from './http.ts'
import { serviceFetch } from './supabase.ts'
import { sendMail, ResendError } from './resend.ts'
import { buildConfirmationSubject, buildConfirmationText } from './orderEmail.mjs'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The orders this module may confirm.
 *
 * Two rules, joined by OR:
 *   * `payment_status = 'paid'` — an online order the gateway has settled;
 *   * `payment_method = 'cod'`  — a cash-on-delivery order, which is real the
 *     moment it is placed and will be paid on arrival.
 *
 * An online order that has not been paid matches neither, so it can never be
 * confirmed: the customer is not told their order is on its way until the
 * money has actually arrived.
 *
 * A CANCELLED order is refused outright, whatever its payment says: it owes
 * its customer an apology, not a "your order is in" mail.
 */
const CONFIRMABLE = 'or=(payment_status.eq.paid,payment_method.eq.cod)&status=neq.cancelled'

export type ConfirmationOutcome =
  | { sent: true; reference: string }
  | {
      sent: false
      reason: 'already-sent' | 'not-paid' | 'no-email' | 'not-configured' | 'failed'
      /** A short, secret-free note about why — e.g. which status Resend gave. */
      detail?: string
    }

/**
 * Claim the "confirmation sent" slot for this order.
 *
 * Returns the order facts when this caller won the race, or null when the
 * order is not paid (and not cash on delivery), has no usable email, or a
 * confirmation has already gone out. Postgres serialises concurrent updates
 * to the same row, so of the browser's verification call and Razorpay's
 * webhook — which routinely arrive within milliseconds of each other — exactly
 * one receives a row.
 */
async function claim(orderId: string): Promise<Json | null> {
  const res = await serviceFetch(
    `/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}` +
      `&confirmation_sent_at=is.null&${CONFIRMABLE}` +
      '&select=id,reference,created_at,email,full_name,phone,address,city,state,pincode,' +
      'subtotal,discount,coupon_code,shipping,total,status,note,payment_method,payment_status,' +
      'razorpay_payment_id',
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ confirmation_sent_at: new Date().toISOString() }),
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
      body: JSON.stringify({ confirmation_sent_at: null }),
    })
  } catch (error) {
    console.warn('[confirmation] could not release claim:', String(error))
  }
}

/**
 * The order's lines, as stored — never computed in the browser.
 *
 * A failed query is NOT an empty order. It throws, so the caller abandons the
 * send instead of posting a confirmation with no products in it — half a truth
 * is worse than no mail — and gives the claim back so a later attempt can try
 * again.
 */
async function fetchItems(orderId: string): Promise<Json[]> {
  // Select ONLY columns `public.order_items` actually has. It carries no
  // `colour` column — colour lives inside `products.colour` and inside the
  // title that `create_order()` snapshots (e.g. "Korean Pants - Black").
  // Asking PostgREST for `colour` answers 400, this function then returned
  // `[]`, and every confirmation email went out with an empty "Items" block
  // and no subtotal line at all. The colour is still readable by the
  // shopper, because it is part of the snapshot title below.
  //
  // The `eq.` matters just as much: PostgREST reads a bare value as
  // "not equal to", so `order_id=<uuid>` is answered with 400
  // ("failed to parse filter") and the lines never arrive. That is exactly
  // what shipped, and it is why the emails went out with no items in them.
  const res = await serviceFetch(
    `/rest/v1/order_items?order_id=eq.${encodeURIComponent(orderId)}` +
      '&select=title,size,qty,unit_price,sku&order=created_at.asc',
  )
  if (!res.ok) {
    console.warn('[confirmation] order_items query failed:', res.status, await res.text())
    throw new Error('order-items-unavailable')
  }
  const rows = (await res.json().catch(() => [])) as Json[]
  return Array.isArray(rows) ? rows : []
}

/**
 * Send the confirmation for `orderId` if — and only if — this call is the
 * first to see the order settle (or to see a cash-on-delivery order placed).
 *
 * Safe to call from both payment paths, in any order, any number of times:
 * every outcome that is not a genuine send leaves the order exactly as it was.
 */
export async function sendOrderConfirmation(orderId: string): Promise<ConfirmationOutcome> {
  if (!orderId) return { sent: false, reason: 'not-paid' }

  // Fail BEFORE claiming when the store has no mail key, so an unconfigured
  // environment never burns the one and only send attempt.
  try {
    requireEnv('RESEND_API_KEY')
  } catch {
    return { sent: false, reason: 'not-configured' }
  }

  const order = await claim(orderId)
  // Not paid, already sent, or no such order — in every case, send nothing.
  if (!order) return { sent: false, reason: 'already-sent' }

  const email = asString(order.email).trim()
  const reference = asString(order.reference)
  if (!EMAIL_RE.test(email)) {
    await release(orderId)
    return { sent: false, reason: 'no-email' }
  }

  try {
    const items = await fetchItems(orderId)
    await sendMail({
      to: email,
      subject: buildConfirmationSubject(reference),
      text: buildConfirmationText(order, items),
    })
    return { sent: true, reference }
  } catch (error) {
    // A refused or failed send must not permanently silence this order.
    await release(orderId)
    if (error instanceof MissingConfigError) return { sent: false, reason: 'not-configured' }
    if (error instanceof ResendError) {
      return { sent: false, reason: 'failed', detail: `resend-${error.status}` }
    }
    console.warn('[confirmation] delivery failed:', String(error))
    return { sent: false, reason: 'failed' }
  }
}
