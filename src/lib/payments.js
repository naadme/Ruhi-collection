// Talks to the two Razorpay Edge Functions.
//
// Everything the browser sends here is treated as a request, never as a fact:
// the functions re-price the cart from Supabase, re-sign the payment with the
// Key Secret and only then touch `payment_status`.

import { supabase } from './supabase'

const CREATE_FALLBACK =
  'We could not start your payment. You have not been charged — please try again.'
const VERIFY_FALLBACK =
  "We received your payment but could not confirm it yet. Please don't pay again — try again in a moment."

/** A message we are allowed to show the shopper, or `''` if there is none. */
async function messageFrom(response) {
  try {
    const parsed = await response?.json?.()
    const message = parsed?.error
    return typeof message === 'string' && message.trim() ? message.trim() : ''
  } catch {
    return ''
  }
}

/**
 * Invoke an Edge Function.
 *
 * Network failures and 5xx answers are marked `retryable` so the caller can
 * safely repeat an idempotent step; a 4xx answer means the server already
 * decided and must be shown as-is.
 */
async function invoke(name, body, fallback) {
  const { data, error, response } = await supabase.functions.invoke(name, { body })
  if (!error) return data

  const status = typeof response?.status === 'number' ? response.status : 0
  const message = (await messageFrom(response)) || fallback
  const retryable = error?.name === 'FunctionsFetchError' || status >= 500
  throw Object.assign(new Error(message), { retryable, status })
}

/** Create the application order and its matching Razorpay order. The coupon
 *  code, if any, is only a REQUEST: the server re-validates it and prices the
 *  order itself. `attribution` is where the shopper came from (ad click IDs
 *  and campaign tags, src/lib/adClicks.js), for the order record to keep.
 *  `test` asks for an admin's test order, paid in Razorpay's test mode — also
 *  only a request, refused by the server for anyone who is not an admin. */
export function createRazorpayOrder(customer, items, couponCode, attribution, { test = false } = {}) {
  return invoke('create-razorpay-order', {
    ...customer,
    items,
    ...(couponCode ? { coupon_code: couponCode } : {}),
    ...(attribution && Object.keys(attribution).length ? { attribution } : {}),
    ...(test ? { test: true } : {}),
  }, CREATE_FALLBACK)
}

const RECOVER_TIMEOUT_MS = 20000
const RECOVER_FALLBACK =
  "We couldn't check your payment just now. Please don't pay again — try again in a moment."

/**
 * Ask whether a payment whose window this page lost track of went through
 * (src/lib/pendingPayment.js). The server asks Razorpay; the answer is
 * `{ status: 'paid', order }`, `{ status: 'processing' }` or
 * `{ status: 'unpaid' }`.
 */
export function checkPendingPayment({ reference, razorpay_order_id }) {
  // A check that never answers must not leave the page waiting on it: after
  // RECOVER_TIMEOUT_MS it counts as a retryable failure ("Check again").
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error(RECOVER_FALLBACK), { retryable: true, status: 0 })),
      RECOVER_TIMEOUT_MS,
    )
  })
  const check = invoke('verify-razorpay-payment', { reference, razorpay_order_id, recover: true }, RECOVER_FALLBACK)
  return Promise.race([check, timeout]).finally(() => clearTimeout(timer))
}

const VERIFY_ATTEMPTS = 3
const VERIFY_DELAYS = [600, 1500]

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Confirm the payment.
 *
 * Verification is idempotent on the server (the same signature always maps to
 * the same order), so a dropped connection mid-request is simply retried —
 * that is the difference between "temporary glitch" and "double charge".
 */
export async function verifyRazorpayPayment(payload) {
  let lastError
  for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(VERIFY_DELAYS[attempt - 1])
    try {
      return await invoke('verify-razorpay-payment', payload, VERIFY_FALLBACK)
    } catch (error) {
      lastError = error
      if (!error?.retryable) throw error
    }
  }
  throw lastError
}
