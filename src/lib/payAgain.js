// Paying again after Razorpay's window was closed mid-payment (22 Nov 2026).
//
// Tapping Pay inside Razorpay's window (PhonePe comes pre-picked there) starts
// a UPI request. A shopper who comes back without approving it, to fix the
// address say, leaves that request open at Razorpay for about 10 minutes. The
// checkout used to lock Pay for all of that time ("Razorpay is still confirming
// your payment"): on 22 Nov a shopper who only wanted to change the address
// reloaded the checkout twice and left.
//
// Paying again is safe when it pays the SAME Razorpay order. Razorpay lets
// only one payment per order succeed, refunds a duplicate on its own, and
// refuses a new attempt while an earlier one is approved (`authorized`), which
// is why an approved payment still holds the page. The same Razorpay order
// comes back when the email is unchanged (`create_order` finds the open order
// by it) and so is the amount (a new amount needs a new Razorpay order, and an
// approval of the old request would then pay an order nobody holds).
//
// Only the checkout imports this file, so it travels in the checkout's own
// chunk, never in the first download of a product page.

/**
 * Whether the server's answer about a saved payment is a request nobody has
 * approved, which leaves Pay free. `pending` must say what that request
 * charges (src/lib/pendingPayment.js); a record saved before 22 Nov 2026
 * doesn't, so the page waits as it always did.
 */
export function isOpenRequest(res, pending) {
  return res?.status === 'processing' && res.stage === 'created' && Number.isInteger(pending?.amount)
}

const sameEmail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

/**
 * Whether paying now uses the open request's Razorpay order: the same email
 * and the same total. `open` is `{ email, amount }` (amount in paise) and
 * `total` is the rupee total on the page.
 */
export function paysSameOrder(open, { email, total }) {
  return !!open && Number.isInteger(open.amount) && sameEmail(open.email, email) &&
    Math.round(Number(total) * 100) === open.amount
}
