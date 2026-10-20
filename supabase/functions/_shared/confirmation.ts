// Order confirmation email, shared by the two functions that can be the first
// to know a Razorpay payment succeeded: `verify-razorpay-payment` (called by
// the shopper's browser) and `razorpay-webhook` (called by Razorpay's servers).
//
// There is deliberately NO public endpoint here. A separate HTTP function
// would hand anyone who could reach it a way to make the store email arbitrary
// addresses; this module is imported in-process by code that already runs on
// the payment server with the service role, so no new surface is exposed.
//
// Three rules, all of them load-bearing:
//
//   1. NEVER before verification. The claim query below requires
//      `payment_status = 'paid'`, which only the payment server can write —
//      the database refuses it from every browser session.
//   2. NEVER twice. Both callers race for the same order and either can be
//      retried, so sending is gated by a compare-and-set on
//      `orders.confirmation_sent_at`: exactly one caller ever gets a row back.
//   3. NEVER silently lost. If Resend refuses the send, the claim is rolled
//      back so the next verification or webhook delivery can try again.

import { env, MissingConfigError, requireEnv } from './env.ts'
import { asString, type Json } from './http.ts'
import { serviceFetch } from './supabase.ts'
import { orderItemColour } from './orderItems.mjs'

/**
 * Resend needs a From address on a verified domain. `onboarding@resend.dev`
 * works out of the box during Resend's own onboarding, but it can ONLY reach
 * the account's own address — so until `RESEND_FROM` is set to a verified
 * domain, customer confirmations are refused by Resend and the claim is rolled
 * back rather than lost. That is why this module reports honestly instead of
 * pretending a message went out.
 */
const DEFAULT_FROM = 'Ruhi Collection <onboarding@resend.dev>'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const money = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** ₹1,234 — the same shape the storefront shows. */
const inr = (v: unknown) => `₹${money(v).toLocaleString('en-IN')}`

export type ConfirmationOutcome =
  | { sent: true; reference: string }
  | { sent: false; reason: 'already-sent' | 'not-paid' | 'no-email' | 'not-configured' | 'failed' }

/**
 * Claim the "confirmation sent" slot for this order.
 *
 * Returns the order facts when this caller won the race, or null when the
 * order is not paid, has no usable email, or a confirmation has already gone
 * out. Postgres serialises concurrent updates to the same row, so of the
 * browser's verification call and Razorpay's webhook — which routinely arrive
 * within milliseconds of each other — exactly one receives a row.
 */
async function claim(orderId: string): Promise<Json | null> {
  const res = await serviceFetch(
    `/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}` +
      '&payment_status=eq.paid&confirmation_sent_at=is.null' +
      '&select=id,reference,created_at,email,full_name,phone,address,city,state,pincode,'
      + 'subtotal,discount,coupon_code,shipping,total,status,note',
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

/** The order's lines, as stored — never computed in the browser. */
async function fetchItems(orderId: string): Promise<Json[]> {
  try {
    // Select ONLY columns `public.order_items` actually has. It carries no
    // `colour` column — colour lives inside `products.colour` and inside the
    // title that `create_order()` snapshots (e.g. "Korean Pants - Black").
    // Asking PostgREST for `colour` answers 400, this function then returned
    // `[]`, and every confirmation email went out with an empty "Items" block
    // and no subtotal line at all. The colour is still readable by the
    // shopper, because it is part of the snapshot title below.
    const res = await serviceFetch(
      `/rest/v1/order_items?order_id=${encodeURIComponent(orderId)}` +
        '&select=title,size,qty,unit_price,sku&order=created_at.asc',
    )
    if (!res.ok) {
      console.warn('[confirmation] order_items query failed:', res.status, await res.text())
      return []
    }
    const rows = (await res.json().catch(() => [])) as Json[]
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Received',
  confirmed: 'Confirmed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

/** The order's own date and time, in the shop's time zone (IST).
 *
 *  The store is in India and keeps no daylight saving, so the offset is fixed
 *  and the date needs no timezone database. The date the customer reads here
 *  is the same day the order's ID names — `01102601` is the first order of the
 *  1st of October 2026, and this is that date. */
function formatOrderDate(value: unknown): string {
  const ms = value instanceof Date ? value.getTime() : new Date(String(value ?? '')).getTime()
  if (!Number.isFinite(ms)) return ''
  const shifted = new Date(ms + 5.60 * 60 * 60 * 1000) // +05:30
  const p = (n: number) => String(n).padStart(2, '0')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return (
    `${shifted.getUTCDate()} ${months[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}` +
    `, ${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())} IST`
  )
}

/** The delivery address, as the lines the customer gave. */
function addressLines(order: Json): string[] {
  return [
    asString(order.address),
    [asString(order.city), asString(order.state)].filter(Boolean).join(', '),
    asString(order.pincode),
  ].map((line) => line.trim()).filter(Boolean)
}

/** Plain text only — the shop's own words, never HTML from user input. */
function buildText(order: Json, items: Json[]): string {
  const lines: string[] = [
    'Ruhi Womens Clothing',
    '',
    `Hello ${asString(order.full_name) || 'there'},`,
    '',
    'Thank you for your order with Ruhi Womens Clothing.',
    '',
    `Order ID: ${asString(order.reference)}`,
  ]

  const placed = formatOrderDate(order.created_at)
  if (placed) lines.push(`Order date: ${placed}`)
  lines.push(`Status: ${STATUS_LABEL[asString(order.status)] || asString(order.status) || 'Received'}`)

  const address = addressLines(order)
  if (address.length) {
    lines.push('')
    lines.push('Delivering to')
    for (const line of address) lines.push(line)
  }
  if (asString(order.phone)) lines.push(`Phone: ${asString(order.phone)}`)

  lines.push('')
  lines.push('Items')

  for (const item of items) {
    const colour = orderItemColour(item.title)
    const bits = [
      asString(item.size) && `Size ${asString(item.size)}`,
      colour,
      asString(item.sku) && `Product ID ${asString(item.sku)}`,
    ].filter(Boolean).join(', ')
    const qty = money(item.qty)
    lines.push(
      `- ${asString(item.title)}${bits ? ` (${bits})` : ''}` +
        ` × ${qty}${item.unit_price ? ` — ${inr(money(item.unit_price) * qty)}` : ''}`,
    )
  }

  lines.push('')
  if (money(item0(items))) lines.push(`Subtotal: ${inr(order.subtotal)}`)
  if (money(order.discount)) {
    lines.push(`Discount: −${inr(order.discount)}${asString(order.coupon_code) ? ` (${asString(order.coupon_code)})` : ''}`)
  }
  lines.push(`Shipping: ${money(order.shipping) ? inr(order.shipping) : 'Free'}`)
  lines.push(`Total paid: ${inr(order.total)}`)
  lines.push('')
  lines.push('We will let you know as soon as your order ships.')
  lines.push('')
  lines.push('Any questions? Call or WhatsApp 9046651272, or write to')
  lines.push('ruhicollections2026@gmail.com — we reply within a working day.')
  lines.push('')
  lines.push('— Ruhi Womens Clothing')

  return lines.join('\n')
}

const item0 = (items: Json[]) => items[0] && money(items[0].qty) * money(items[0].unit_price)

/** Send via Resend. Throws MissingConfigError on a bad key. */
async function deliver(to: string, reference: string, text: string): Promise<void> {
  const apiKey = requireEnv('RESEND_API_KEY')
  const from = env('RESEND_FROM') ?? DEFAULT_FROM

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Your Ruhi Womens Clothing order ${reference} — confirmation`,
      text,
    }),
  })

  if (res.ok) return
  if (res.status === 401 || res.status === 403) throw new MissingConfigError(['RESEND_API_KEY'])
  console.warn('[confirmation] Resend answered', res.status)
  throw new Error('resend-rejected')
}

/**
 * Send the confirmation for `orderId` if — and only if — this call is the
 * first to see the payment verified.
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
    await deliver(email, reference, buildText(order, items))
    return { sent: true, reference }
  } catch (error) {
    // A refused or failed send must not permanently silence this order.
    await release(orderId)
    if (error instanceof MissingConfigError) return { sent: false, reason: 'not-configured' }
    console.warn('[confirmation] delivery failed:', String(error))
    return { sent: false, reason: 'failed' }
  }
}
