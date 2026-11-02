// Thin client for the parts of the Razorpay REST API this checkout needs.
//
// Only the public Key ID is ever handed back to the browser; `RAZORPAY_KEY_SECRET`
// is read here and used in-process for Basic auth and HMAC signing.
//
// Every call runs in one of two modes. `live` uses the shop's own keys. `test`
// uses `RAZORPAY_TEST_KEY_ID` / `RAZORPAY_TEST_KEY_SECRET`, for the test orders
// an admin places to check the site end to end without moving money (tracking
// brief, rule 10). An order remembers its mode in `orders.is_test`.

import { env, MissingConfigError, requireEnv } from './env.ts'
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

export interface RazorpayPayment {
  id: string
  entity: string
  amount: number
  currency: string
  status?: string
  order_id?: string
  method?: string
}

export type RazorpayMode = 'live' | 'test'

/** The mode an order was created in: test only when the order says so. */
export function modeOf(order: { is_test?: unknown } | null | undefined): RazorpayMode {
  return order?.is_test === true ? 'test' : 'live'
}

export function credentials(mode: RazorpayMode = 'live'): { keyId: string; keySecret: string } {
  if (mode === 'test') {
    const keyId = requireEnv('RAZORPAY_TEST_KEY_ID')
    // A live key filed under the test name would take real money for an
    // order marked as a test, so anything but a test key is refused.
    if (!keyId.startsWith('rzp_test_')) throw new MissingConfigError(['RAZORPAY_TEST_KEY_ID'])
    return { keyId, keySecret: requireEnv('RAZORPAY_TEST_KEY_SECRET') }
  }
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

async function call(path: string, init: RequestInit = {}, mode: RazorpayMode = 'live'): Promise<Response> {
  const { keyId, keySecret } = credentials(mode)
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
}, mode: RazorpayMode = 'live'): Promise<RazorpayOrder> {
  const res = await call('/orders', {
    method: 'POST',
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
    }),
  }, mode)
  if (!res.ok) throw new RazorpayApiError(res.status)
  return (await res.json()) as RazorpayOrder
}

export async function getRazorpayOrder(orderId: string, mode: RazorpayMode = 'live'): Promise<RazorpayOrder> {
  const res = await call(`/orders/${encodeURIComponent(orderId)}`, {}, mode)
  if (!res.ok) throw new RazorpayApiError(res.status)
  return (await res.json()) as RazorpayOrder
}

export async function getRazorpayPayment(paymentId: string, mode: RazorpayMode = 'live'): Promise<RazorpayPayment> {
  const res = await call(`/payments/${encodeURIComponent(paymentId)}`, {}, mode)
  if (!res.ok) throw new RazorpayApiError(res.status)
  return (await res.json()) as RazorpayPayment
}

/**
 * How a verified payment was made, in Razorpay's own words — `upi`, `card`,
 * `netbanking`, `wallet`, `emi`, `paylater` … — or `''` when Razorpay cannot be
 * asked right now or the payment belongs to another order. Knowing the method
 * is never a reason to fail a payment that is already proven.
 */
export async function paymentMethodOf(
  paymentId: string,
  orderId: string,
  mode: RazorpayMode = 'live',
): Promise<string> {
  try {
    const payment = await getRazorpayPayment(paymentId, mode)
    if (payment.order_id !== orderId) return ''
    return typeof payment.method === 'string' ? payment.method.trim().toLowerCase() : ''
  } catch {
    return ''
  }
}

/**
 * `HMAC_SHA256(order_id + '|' + payment_id, KEY_SECRET)` compared against the
 * signature Razorpay's Checkout handed the browser.
 */
export async function verifyPaymentSignature(input: {
  orderId: string
  paymentId: string
  signature: string
  mode?: RazorpayMode
}): Promise<boolean> {
  const { keySecret } = credentials(input.mode ?? 'live')
  const expected = await hmacSha256Hex(keySecret, `${input.orderId}|${input.paymentId}`)
  return safeEqualHex(expected, input.signature)
}

/**
 * `HMAC_SHA256(raw_body, WEBHOOK_SECRET)` — the webhook signs the exact bytes
 * of the request body, nothing else.
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
