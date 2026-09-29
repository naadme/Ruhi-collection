// Thin client for the parts of the Razorpay REST API this checkout needs.
//
// Only the public Key ID is ever handed back to the browser; `RAZORPAY_KEY_SECRET`
// is read here and used in-process for Basic auth and HMAC signing.

import { env, requireEnv } from './env.ts'
import { hmacSha256Hex, safeEqualHex } from './crypto.ts'

const API = 'https://api.razorpay.com/v1'

export interface RazorpayOrder {
  id: string
  entity: string
  amount: number
  amount_paid: number
  currency: string
  receipt?: string
  status?: string
  notes?: Record<string, string>
}

/** Raised when Razorpay itself answers with an error (never shown verbatim). */
export class RazorpayApiError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`razorpay-api:${status}`)
    this.name = 'RazorpayApiError'
    this.status = status
  }
}

export function credentials(): { keyId: string; keySecret: string } {
  return {
    keyId: requireEnv('RAZORPAY_KEY_ID'),
    keySecret: requireEnv('RAZORPAY_KEY_SECRET'),
  }
}

/** True when this server is configured with test keys (`rzp_test_…`). */
export function isTestMode(): boolean {
  return env('RAZORPAY_KEY_ID')?.startsWith('rzp_test_') ?? false
}

/**
 * Rupees → paise. Razorpay's amount field is an integer count of the smallest
 * currency unit, so ₹999 must be sent as 99900.
 */
export function toPaise(rupees: number): number {
  return Math.round(Number(rupees) * 100)
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const { keyId, keySecret } = credentials()
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      // Keys are ASCII, so btoa is safe and avoids pulling in an encoder.
      Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  })
}

export async function createRazorpayOrder(input: {
  amountPaise: number
  currency: string
  receipt: string
  notes: Record<string, string>
}): Promise<RazorpayOrder> {
  const res = await call('/orders', {
    method: 'POST',
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
    }),
  })
  if (!res.ok) throw new RazorpayApiError(res.status)
  return (await res.json()) as RazorpayOrder
}

export async function getRazorpayOrder(orderId: string): Promise<RazorpayOrder> {
  const res = await call(`/orders/${encodeURIComponent(orderId)}`)
  if (!res.ok) throw new RazorpayApiError(res.status)
  return (await res.json()) as RazorpayOrder
}

/**
 * `HMAC_SHA256(order_id + '|' + payment_id, KEY_SECRET)` compared against the
 * signature Razorpay's Checkout handed the browser.
 */
export async function verifyPaymentSignature(input: {
  orderId: string
  paymentId: string
  signature: string
}): Promise<boolean> {
  const { keySecret } = credentials()
  const expected = await hmacSha256Hex(keySecret, `${input.orderId}|${input.paymentId}`)
  return safeEqualHex(expected, input.signature)
}

/**
 * `HMAC_SHA256(raw_body + '|' + WEBHOOK_SECRET, WEBHOOK_SECRET)`.
 *
 * Returns `false` when the webhook secret has not been configured: an
 * unverifiable webhook is never accepted.
 */
export async function verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
  const secret = env('RAZORPAY_WEBHOOK_SECRET')
  if (!secret) return false
  const expected = await hmacSha256Hex(secret, rawBody)
  return safeEqualHex(expected, signature)
}
