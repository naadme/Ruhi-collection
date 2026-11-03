import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCart } from '../context/CartContext'
import { saveOrder } from '../lib/orderStore'
import { checkPendingPayment } from '../lib/payments'
import { clearPendingPayment, loadPendingPayment } from '../lib/pendingPayment'

// The same check Checkout makes, for a shopper who comes back on any other
// page. An in-app browser that was closed while the shopper was in their UPI
// app reopens on whatever the ad links to, not on /checkout. If that payment
// went through, the shopper is taken to their order — the confirmation page
// is where the purchase event fires. Anything short of "paid" is left for
// Checkout, which explains it; a stale record is dropped by loadPendingPayment.
export default function PaymentRecovery() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { clear } = useCart()
  const elsewhere = pathname !== '/checkout' && !pathname.startsWith('/order/')
  // Held in refs so moving between pages does not count as a reason to ask
  // again (react-router hands out a new `navigate` on every route change).
  const actions = useRef({ navigate, clear })
  actions.current = { navigate, clear }

  useEffect(() => {
    if (!elsewhere) return undefined
    let alive = true
    let busy = false
    const check = async () => {
      const pending = loadPendingPayment()
      if (!pending || busy) return
      busy = true
      try {
        const res = await checkPendingPayment(pending)
        if (!alive || loadPendingPayment()?.razorpay_order_id !== pending.razorpay_order_id) return
        if (res?.status === 'paid' && res.order?.reference) {
          clearPendingPayment()
          const order = { ...res.order, customer: pending.customer || {} }
          saveOrder(order)
          actions.current.clear()
          actions.current.navigate(`/order/${order.reference}`, { replace: true, state: { order } })
        } else if (res?.status === 'unpaid') {
          clearPendingPayment()
        }
      } catch (err) {
        // A final answer from the server ends it; anything else is asked again
        // on the next visit, and the webhook records the payment regardless.
        if (alive && err && !err.retryable &&
          loadPendingPayment()?.razorpay_order_id === pending.razorpay_order_id) clearPendingPayment()
      } finally {
        busy = false
      }
    }
    check()
    const onReturn = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [elsewhere])

  return null
}
