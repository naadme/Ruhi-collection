// The payment this browser has open in Razorpay's window, kept so it can be
// found again if the page is reloaded before Checkout reports back.
//
// Instagram's and Facebook's in-app browsers often reload the page when the
// shopper comes back from a UPI app. Everything in memory — including the
// callback Razorpay would have called — is gone by then, so the order
// reference and the Razorpay order id are written down before the window
// opens. With both, the server can ask Razorpay whether the order was paid
// (`recover` in verify-razorpay-payment).
//
// The shopper's own checkout details travel with them, so a recovered order
// shows its delivery address and its purchase event carries the same contact
// details a normal one does. They stay on this device and are dropped as soon
// as the payment is settled, found unpaid, the shopper signs out, or two hours
// have passed.
//
// localStorage rather than sessionStorage: an in-app browser that is closed and
// reopened from the app starts a new session.
const KEY = 'ruhi:pending-payment'
// Comfortably past Razorpay's UPI time limit (about 10 minutes) and a shopper
// who reopens the ad a little later; short enough that the checkout details
// kept with it do not linger on a shared phone.
export const PENDING_PAYMENT_TTL_MS = 2 * 60 * 60 * 1000

export function savePendingPayment({ reference, razorpay_order_id, customer = null }, now = Date.now()) {
  if (!reference || !razorpay_order_id) return
  try {
    localStorage.setItem(KEY, JSON.stringify({ reference, razorpay_order_id, customer, at: now }))
  } catch {
    /* private browsing or a full quota — the webhook still records the payment */
  }
}

/** The saved payment, or `null` when there is none, it is malformed or stale. */
export function loadPendingPayment(now = Date.now()) {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const saved = JSON.parse(raw)
    const fresh = typeof saved?.at === 'number' && now - saved.at >= 0 && now - saved.at < PENDING_PAYMENT_TTL_MS
    if (saved?.reference && saved?.razorpay_order_id && fresh) {
      return {
        reference: String(saved.reference),
        razorpay_order_id: String(saved.razorpay_order_id),
        customer: saved.customer && typeof saved.customer === 'object' ? saved.customer : null,
      }
    }
    localStorage.removeItem(KEY)
    return null
  } catch {
    return null
  }
}

export function clearPendingPayment() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to clear */
  }
}
