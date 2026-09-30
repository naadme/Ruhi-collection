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
    let done = false
    const finish = (fn, value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      fn(value)
    }
    const timer = setTimeout(() => {
      if (!window.Razorpay) {
        scriptPromise = null
        finish(reject, new CheckoutUnavailable('We could not open the payment window. Please check your connection and try again.'))
      }
    }, SCRIPT_TIMEOUT_MS)

    el.addEventListener('load', () => finish(resolve), { once: true })
    el.addEventListener(
      'error',
      () => {
        scriptPromise = null
        finish(reject, new CheckoutUnavailable('We could not open the payment window. Please check your connection and try again.'))
      },
      { once: true },
    )

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

    const checkout = new window.Razorpay({
      key,
      amount,
      currency,
      order_id: orderId,
      name: 'Ruhi Womens Clothing',
      description,
      prefill,
      notes,
      // Matches brand-green in tailwind.config.js so Checkout feels native.
      theme: { color: '#C08576' },
      handler: (response) => settle(resolve, response),
      modal: {
        ondismiss: () =>
          settle(reject, new PaymentCancelled('You closed the payment window. Nothing has been charged — you can try again whenever you are ready.')),
      },
    })

    checkout.on('payment.failed', (response) => {
      const reason = response?.error?.reason || ''
      settle(
        reject,
        new PaymentFailed(
          reason === 'instrument_declined'
            ? 'Your bank declined this payment. Nothing has been charged — please try another method.'
            : 'Payment could not be completed. Your order has not been charged. Please try again.',
        ),
      )
    })

    checkout.open()
  })
}
