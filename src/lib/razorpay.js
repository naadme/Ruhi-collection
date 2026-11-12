// Razorpay Standard Checkout — the browser side only.
//
// The Key ID below is public by design (it identifies the account, it cannot
// authorise anything). The Key Secret never appears here, never appears in
// `VITE_*` variables and never reaches the bundle: every server-side step runs
// in a Supabase Edge Function.

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'
const SCRIPT_TIMEOUT_MS = 12000

/** Public Key ID from `.env`. Empty until the owner connects an account. */
export const RAZORPAY_KEY_ID = (import.meta.env.VITE_RAZORPAY_KEY_ID || '').trim()

/** Whether this build offers "Online payment" at checkout at all. */
export const onlinePaymentReady = RAZORPAY_KEY_ID.length > 0

/**
 * How Razorpay's window introduces the shop: the name the shop is
 * GST-registered under (also the domain), the site logo padded to a square on
 * its own cream (public/images/ruhi-logo-square.jpg, 512×512), and the
 * buy-button colour (`brand.cta` in tailwind.config.js).
 */
export const CHECKOUT_NAME = 'Ruhi Collections'
export const CHECKOUT_LOGO_PATH = '/images/ruhi-logo-square.jpg'
export const CHECKOUT_COLOR = '#9A5E4F'

/** The logo as an absolute address, which Razorpay's window needs. */
const checkoutLogo = () =>
  typeof window !== 'undefined' && window.location?.origin
    ? `${window.location.origin}${CHECKOUT_LOGO_PATH}`
    : undefined

/** The shopper closed Checkout before paying. */
export class PaymentCancelled extends Error {}

/** Razorpay declined or failed the payment. */
export class PaymentFailed extends Error {}

/** Checkout itself could not be opened (offline, blocked script, …). */
export class CheckoutUnavailable extends Error {}

let scriptPromise = null

function loadScript() {
  if (typeof document === 'undefined') {
    return Promise.reject(new CheckoutUnavailable('The payment window is unavailable here.'))
  }

  const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`)
  const el = existing || document.createElement('script')

  return new Promise((resolve, reject) => {
    const UNREACHABLE = 'We could not open the payment window. Please check your connection and try again.'
    let done = false
    let timer
    // A script element that has already failed never fires `load` or `error`
    // again, and the `existing` lookup above would hand the very same dead
    // element straight back on the next attempt — so the browser would never
    // re-fetch, every retry would hang until the timeout, and the shopper
    // could never pay without a full page reload. Detaching it on the way out
    // is what makes a retry an actual retry. (Removing an element does not
    // cancel a fetch already in flight, so a slow-but-arriving script still
    // lands and `window.Razorpay` is still honoured above.)
    const detach = () => {
      if (el.parentNode) el.parentNode.removeChild(el)
    }
    // Named so `finish` can detach them: the element is reused across retries
    // and can outlive the promise (already loaded, or a timeout that rejected
    // while the script was still in flight), which otherwise leaves handlers
    // attached to it for the rest of the page's life.
    const onLoad = () => finish(resolve)
    const onError = () => {
      scriptPromise = null
      detach()
      finish(reject, new CheckoutUnavailable(UNREACHABLE))
    }
    const finish = (fn, value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      el.removeEventListener('load', onLoad)
      el.removeEventListener('error', onError)
      fn(value)
    }
    timer = setTimeout(() => {
      if (!window.Razorpay) {
        scriptPromise = null
        detach()
        finish(reject, new CheckoutUnavailable(UNREACHABLE))
      }
    }, SCRIPT_TIMEOUT_MS)

    el.addEventListener('load', onLoad, { once: true })
    el.addEventListener('error', onError, { once: true })

    if (window.Razorpay) {
      finish(resolve)
      return
    }
    if (!existing) {
      el.src = SCRIPT_SRC
      el.async = true
      document.head.appendChild(el)
    }
  })
}

/** Load checkout.js once per page and reuse it for every retry. */
export function loadRazorpay() {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve()
  if (!scriptPromise) scriptPromise = loadScript()
  return scriptPromise
}

/**
 * Open Razorpay Checkout.
 *
 * Resolves with `{ razorpay_payment_id, razorpay_order_id, razorpay_signature }`
 * once Razorpay says the customer paid, and rejects with {@link PaymentCancelled}
 * or {@link PaymentFailed} otherwise. Nothing here decides that an order is
 * paid — the caller still has to have the server verify the signature.
 */
export async function openRazorpay({
  key,
  amount,
  currency,
  orderId,
  description,
  prefill = {},
  notes = {},
  onFailure,
}) {
  // Checkout must be loaded before it can be opened — and loading it is what
  // proves the window will actually appear rather than failing silently.
  await loadRazorpay()

  if (typeof window === 'undefined' || typeof window.Razorpay !== 'function') {
    throw new CheckoutUnavailable('We could not open the payment window. Please try again.')
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    // A failed attempt does not end the payment: Razorpay keeps its window
    // open and offers a retry, and a retry that succeeds still calls
    // `handler`. So a failure is only remembered here, and reported if the
    // shopper then closes the window without paying.
    let lastFailure = null

    const checkout = new window.Razorpay({
      key,
      amount,
      currency,
      order_id: orderId,
      name: CHECKOUT_NAME,
      image: checkoutLogo(),
      description,
      prefill,
      notes,
      // The site's buy-button colour, so the window looks like the shop's own.
      theme: { color: CHECKOUT_COLOR },
      handler: (response) => settle(resolve, response),
      modal: {
        ondismiss: () =>
          settle(
            reject,
            lastFailure ||
              new PaymentCancelled('You closed the payment window. Nothing has been charged — you can try again whenever you are ready.'),
          ),
      },
    })

    checkout.on('payment.failed', (response) => {
      const reason = response?.error?.reason || ''
      lastFailure = new PaymentFailed(
        reason === 'instrument_declined'
          ? 'Your bank declined this payment. Nothing has been charged — please try another method.'
          : 'Payment could not be completed. Your order has not been charged. Please try again.',
      )
      // Razorpay's reason code (instrument_declined, …), for GA4's checkout_error.
      lastFailure.reason = reason
      // `onFailure` hears about every failed attempt, also one the shopper
      // then retries — and can never interrupt Razorpay's own handling of it.
      try { onFailure?.(reason) } catch { /* measuring must not get in the way of paying */ }
    })

    checkout.open()
  })
}

/**
 * Start fetching checkout.js as soon as the checkout page opens, while the
 * shopper is still typing, so tapping Pay only waits for the shop's own order
 * call — not for Razorpay's script as well. Never throws: a preload that fails
 * or times out clears itself (see loadScript), and Pay loads the script again.
 */
export function preloadRazorpay() {
  if (!onlinePaymentReady) return
  loadRazorpay().catch(() => { /* Pay will try again */ })
}
