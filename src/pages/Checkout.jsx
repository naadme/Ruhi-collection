import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Lock, ShieldCheck, AlertTriangle, Tag, X } from 'lucide-react'
import usePageTitle from '../hooks/usePageTitle'
import { useCart } from '../context/CartContext'
import { useProducts } from '../context/ProductsContext'
import { useAuth } from '../context/AuthContext'
import Img from '../components/Img'
import { ShopRatingNote } from '../components/Stars'
import { saveOrder } from '../lib/orderStore'
import { displayedTotalMatchesCharge, inr, shippingFor, totalFor } from '../lib/pricing'
import { discountFor, serverHonoursCoupon, validateCoupon } from '../lib/coupons'
import { EMPTY_ADDRESS, INDIAN_STATES, MAX_CART_LINES, validateAddress } from '../lib/checkout'
import { PaymentCancelled, PaymentFailed, onlinePaymentReady, openRazorpay } from '../lib/razorpay'
import { checkPendingPayment, createRazorpayOrder, verifyRazorpayPayment } from '../lib/payments'
import { clearPendingPayment, loadPendingPayment, savePendingPayment } from '../lib/pendingPayment'
import { newEventId, trackEcommerce, trackSafely } from '../lib/tracking'
import { cartEvent, checkoutErrorEvent, couponEvent, paymentEvent, sameStep, shippingEvent } from '../lib/trackingItems'
import { attributionForOrder } from '../lib/adClicks'

// GA4 (event schema of 8 Nov 2026): the coupons shoppers try, and what stops
// a checkout — by kind, never with anything the shopper typed.
const checkoutError = (type, details) => trackSafely(() => checkoutErrorEvent(type, { ...details, eventId: newEventId() }))
const couponTried = (code, result) => trackSafely(() => couponEvent(code, result, { eventId: newEventId() }))

const Section = ({ n, title, children }) => (
  <section className="border-t border-black/10 pt-7 mt-7 first:border-0 first:pt-0 first:mt-0">
    <h2 className="flex items-baseline gap-3 text-[20px] font-semibold">
      <span className="font-ui text-[13px] text-white bg-black/70 w-6 h-6 grid place-items-center rounded-full shrink-0 translate-y-[-1px]">{n}</span>
      {title}
    </h2>
    <div className="mt-5">{children}</div>
  </section>
)

function Field({ label, name, value, onChange, error, ...rest }) {
  return (
    <div>
      <label className="clabel" htmlFor={`co-${name}`}>{label}</label>
      <input
        id={`co-${name}`}
        name={name}
        value={value}
        onChange={onChange}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `co-${name}-err` : undefined}
        className="cfield"
        {...rest}
      />
      {error && <span className="cerror" id={`co-${name}-err`}>{error}</span>}
    </div>
  )
}

// One payment choice in Section 3. Native radio input underneath so keyboard,
// screen readers and form semantics all behave; the visual dot matches the
// card styling already used elsewhere on the checkout page.
function PayOption({ value, checked, onChange, title, body }) {
  return (
    <label
      className={`flex gap-3 rounded-xl p-4 border transition cursor-pointer ${
        checked ? 'border-brand-green/40 bg-white' : 'border-black/15 bg-white/40 hover:border-black/30'
      }`}
    >
      <input
        type="radio"
        name="payment-method"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="sr-only peer"
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 w-5 h-5 rounded-full border-[6px] bg-white shrink-0 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-green/60 peer-focus-visible:ring-offset-2 ${
          checked ? 'border-brand-green' : 'border-black/25'
        }`}
      />
      <span className="min-w-0">
        <span className="block font-semibold text-[16px]">{title}</span>
        <span className="block text-[14px] text-black/65 mt-1">{body}</span>
      </span>
    </label>
  )
}

function Summary({
  lines, subtotal, coupon, couponInput, setCouponInput, couponBusy, couponNote, onApply, onRemoveCoupon,
}) {
  const shipping = shippingFor()
  // Display only — the database recomputes the real discount when the order
  // is created and prices the payment from its own total.
  const discount = coupon ? discountFor(coupon, subtotal) : 0
  return (
    <div className="border border-black/10 rounded-xl bg-transparent p-5 shadow-[0_1px_2px_rgba(74,44,35,.04)]">
      <h2 className="text-[17px] font-semibold">Order summary</h2>
      <ul className="mt-4 space-y-4">
        {lines.map((l) => (
          <li key={l.id + l.size} className="flex gap-3">
            <div className="relative w-14 h-[74px] shrink-0 bg-neutral-100 rounded overflow-hidden">
              <Img src={l.image} alt={l.product.title} sizes="56px" className="w-full h-full object-cover" />
              {l.qty > 1 && (
                <span className="absolute top-0 right-0 bg-black/75 text-white text-[11px] font-ui px-1.5 py-[1px] rounded-bl">{l.qty}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-snug line-clamp-2">{l.product.title}</p>
              <p className="text-[13px] text-black/55 mt-0.5">Size {l.size}{l.color ? ` · ${l.color}` : ''} · Qty {l.qty}</p>
            </div>
            <p className="font-ui text-[15px] font-semibold shrink-0">{inr(l.price * l.qty)}</p>
          </li>
        ))}
      </ul>

      {/* Coupon: one input to apply, one button to remove. The code is only
          ever checked by the database — invalid, expired or inactive codes
          are refused with the server's own message. */}
      <div className="mt-5 pt-5 border-t border-black/10">
        {!coupon ? (
          <>
            <label htmlFor="coupon-code" className="block text-[14px] font-medium">Have a coupon code?</label>
            <div className="flex gap-2 mt-2">
              <input
                id="coupon-code"
                type="text"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                placeholder="Coupon code"
                autoCapitalize="characters"
                autoComplete="off"
                className="flex-1 min-w-0 h-[42px] px-3 rounded-lg border border-black/30 bg-white text-[14px] font-mono outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:font-sans placeholder:text-black/35"
              />
              <button
                type="button"
                onClick={onApply}
                disabled={couponBusy || !couponInput.trim()}
                className="h-[42px] px-4 rounded-lg border border-black/60 text-[14px] font-semibold inline-flex items-center gap-1.5 hover:bg-black hover:text-white transition disabled:opacity-60"
              >
                {couponBusy ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} />}
                {couponBusy ? 'Checking…' : 'Apply'}
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[15px] min-w-0 truncate">
              <Tag size={15} className="inline -mt-0.5 mr-1.5 text-brand-green" />
              Coupon <span className="font-mono font-semibold">{coupon.code}</span>
              <span className="text-brand-green font-semibold"> · −{inr(discount)}</span>
            </p>
            <button
              type="button"
              onClick={onRemoveCoupon}
              className="inline-flex items-center gap-1 text-[13px] text-black/50 hover:text-red-600 shrink-0"
            >
              <X size={14} /> Remove
            </button>
          </div>
        )}
        {couponNote && (
          <p role="status" aria-live="polite" className={`mt-2 text-[13px] ${couponNote.kind === 'ok' ? 'text-green-700' : 'text-red-600'}`}>
            {couponNote.text}
          </p>
        )}
      </div>

      <dl className="mt-5 pt-5 border-t border-black/10 space-y-2 text-[15px]">
        <div className="flex justify-between"><dt className="text-black/65">Subtotal</dt><dd className="font-ui">{inr(subtotal)}</dd></div>
        {discount > 0 && (
          <div className="flex justify-between">
            <dt className="text-black/65">Discount</dt>
            <dd className="font-ui text-brand-green font-semibold">−{inr(discount)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-black/65">Shipping</dt>
          <dd className="font-ui">{shipping === 0 ? <span className="text-brand-green font-semibold">Free</span> : inr(shipping)}</dd>
        </div>
        <div className="flex justify-between pt-3 border-t border-black/10 text-[18px] font-semibold">
          <dt>Total</dt><dd className="font-ui">{inr(totalFor(subtotal, discount))}</dd>
        </div>
      </dl>
    </div>
  )
}

export default function Checkout() {
  usePageTitle('Checkout')
  const { lines, trackedItems, subtotal, prune, clear } = useCart()
  const { reload, loading, answered, error: catalogueError, source } = useProducts()
  const { user, isAdmin } = useAuth()
  const navigate = useNavigate()

  const [f, setF] = useState(EMPTY_ADDRESS)
  const [errors, setErrors] = useState({})
  const [failure, setFailure] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // A payment started on an earlier load of this page whose outcome never
  // reached it: { reference, state: 'checking' | 'processing' | 'error', message }.
  const [recovery, setRecovery] = useState(null)
  // True while Razorpay's window is open on THIS load — its own callback will
  // report the outcome, so the recovery check stays out of the way.
  const paying = useRef(false)
  const recovering = useRef(false)
  const [pay, setPay] = useState('razorpay')
  // An admin's test order (tracking brief, rule 10): paid in Razorpay's test
  // mode, so no money moves. The server checks the admin itself.
  const [testOrder, setTestOrder] = useState(false)
  const placingTest = isAdmin && testOrder
  // The applied coupon, exactly as the DATABASE validated it (see
  // src/lib/coupons.js): { valid, code, kind, value, discount, message }.
  const [coupon, setCoupon] = useState(null)
  const [couponInput, setCouponInput] = useState('')
  const [couponBusy, setCouponBusy] = useState(false)
  const [couponNote, setCouponNote] = useState(null)
  const prefilled = useRef(false)
  // The last address step and payment step sent to GTM on this visit, so a
  // retry with nothing changed is not counted twice.
  const sentShipping = useRef(null)
  const sentPayment = useRef(null)

  // Price against the live catalogue — never against a stale cache — before
  // any money changes hands.
  useEffect(() => { reload() }, [reload])
  // Products the owner hid or deleted cannot be ordered.
  useEffect(() => { prune() }, [prune])

  // GTM's begin_checkout (tracking brief, Annexure A7): once per visit to this
  // page, with everything in the basket, once the real catalogue has priced
  // it. No coupon can be applied yet when the page opens.
  const checkoutReady = !loading && trackedItems.length > 0
  useEffect(() => {
    if (!checkoutReady) return undefined
    const timer = setTimeout(() => {
      const message = cartEvent('begin_checkout', trackedItems, { eventId: newEventId() })
      if (message) trackEcommerce(message)
    }, 0)
    return () => clearTimeout(timer)
  }, [checkoutReady])

  // add_shipping_info and add_payment_info (A8, A9) for one checkout step, or
  // nothing when the same step was already sent with the same contents.
  const sendStep = (sent, message) => {
    if (!message || sameStep(sent.current, message)) return
    sent.current = message
    trackEcommerce(message)
  }

  useEffect(() => {
    if (prefilled.current || !user?.email) return
    prefilled.current = true
    setF((v) => ({ ...v, email: v.email || user.email }))
  }, [user])

  // The outcome of a payment never reached this page: it was reloaded while
  // Razorpay's window was open (typically an Instagram or Facebook in-app
  // browser coming back from a UPI app), or the window was closed while a
  // payment may still be completing (src/lib/pendingPayment.js). The server
  // asks Razorpay whether the order was paid — on arrival, whenever the
  // shopper returns to this tab, on "Check again", and on a schedule while
  // Razorpay is still waiting: every 5 s for two minutes, then every 20 s up
  // to the UPI time limit (about 10 minutes).
  const pollTimer = useRef(null)
  const pollSince = useRef(0)
  // Shown when the check finds nothing was paid, after the window was closed.
  const unpaidNote = useRef('')
  const stopPolling = () => {
    clearTimeout(pollTimer.current)
    pollTimer.current = null
  }

  const mounted = useRef(true)
  // Bumped each time a payment starts. The Razorpay order is reused across
  // attempts, so the saved ids alone cannot tell an answer about an earlier
  // attempt from one about the current one.
  const attempt = useRef(0)
  // A check asked for while another is in flight runs once that one is done,
  // so the call after a closed window is never silently dropped.
  const recheck = useRef(false)

  const recoverPayment = useCallback(async ({ scheduled = false } = {}) => {
    if (!mounted.current || paying.current) return
    if (recovering.current) { recheck.current = true; return }
    stopPolling()
    if (!scheduled) pollSince.current = Date.now()
    const pending = loadPendingPayment()
    if (!pending) { setRecovery(null); return }
    recovering.current = true
    const askedFor = attempt.current
    setRecovery((prev) => (prev?.reference === pending.reference && prev.state === 'processing'
      ? prev
      : { reference: pending.reference, state: 'checking' }))
    // An answer only counts for the payment it was asked about: by the time
    // it arrives the page may be gone, or a new payment may have started.
    const current = () => {
      const now = loadPendingPayment()
      return mounted.current && !paying.current && attempt.current === askedFor &&
        now?.reference === pending.reference && now?.razorpay_order_id === pending.razorpay_order_id
    }
    const showUnpaidNote = () => {
      if (!unpaidNote.current) return
      setFailure(unpaidNote.current)
      unpaidNote.current = ''
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    try {
      const res = await checkPendingPayment(pending)
      if (!current()) return
      if (res?.status === 'paid' && res.order?.reference) {
        clearPendingPayment()
        unpaidNote.current = ''
        const order = { ...res.order, customer: pending.customer || {} }
        saveOrder(order)
        clear()
        navigate(`/order/${order.reference}`, { replace: true, state: { order } })
        return
      }
      if (res?.status === 'processing') {
        const waited = Date.now() - pollSince.current
        if (waited < 15 * 60 * 1000) {
          setRecovery({ reference: pending.reference, state: 'processing' })
          pollTimer.current = setTimeout(() => recoverPayment({ scheduled: true }), waited < 2 * 60 * 1000 ? 5000 : 20000)
        } else {
          setRecovery({ reference: pending.reference, state: 'stalled' })
        }
        return
      }
      // Nothing was paid: the shopper simply pays again from this page.
      clearPendingPayment()
      setRecovery(null)
      showUnpaidNote()
    } catch (err) {
      if (!current()) return
      if (err?.retryable) {
        setRecovery({ reference: pending.reference, state: 'error', message: err?.message })
      } else {
        // The server has decided and asking again will not change it: drop
        // the saved payment rather than keep Pay locked on it.
        clearPendingPayment()
        setRecovery(null)
        if (unpaidNote.current) showUnpaidNote()
        else if (err?.message) setFailure(err.message)
      }
    } finally {
      recovering.current = false
      if (recheck.current && mounted.current) {
        recheck.current = false
        recoverPayment()
      }
    }
  }, [clear, navigate])

  useEffect(() => {
    mounted.current = true
    recoverPayment()
    const onReturn = () => { if (document.visibilityState === 'visible') recoverPayment() }
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      mounted.current = false
      document.removeEventListener('visibilitychange', onReturn)
      stopPolling()
    }
  }, [recoverPayment])

  // While a payment may still be going through, a second one is not offered.
  const awaitingPayment = ['checking', 'processing', 'error'].includes(recovery?.state)

  const on = (k) => (e) => {
    const { value } = e.target
    setF((v) => ({ ...v, [k]: value }))
    setErrors((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev))
  }

  // A coupon is only valid for the subtotal it was checked against. When the
  // cart or any quantity changes, the database re-checks the applied code —
  // a code that no longer meets its minimum (or has just expired) is dropped
  // with a message instead of quietly charging a stale discount.
  const appliedCode = coupon?.code
  useEffect(() => {
    if (!appliedCode) return undefined
    let alive = true
    validateCoupon(appliedCode, subtotal)
      .then((res) => {
        if (!alive) return
        if (res.valid) setCoupon(res)
        else {
          setCoupon(null)
          setCouponInput('')
          setCouponNote({ kind: 'err', text: res.message || 'That coupon is no longer valid for this order.' })
        }
      })
      .catch(() => {
        /* keep the current discount display; the server re-checks at payment */
      })
    return () => {
      alive = false
    }
  }, [appliedCode, subtotal])

  const applyCoupon = async () => {
    setCouponNote(null)
    setCouponBusy(true)
    const tried = couponInput
    try {
      const res = await validateCoupon(couponInput, subtotal)
      if (res.valid) {
        setCoupon(res)
        setCouponNote({ kind: 'ok', text: res.message || 'Coupon applied.' })
        couponTried(tried, 'applied')
      } else {
        setCoupon(null)
        setCouponNote({ kind: 'err', text: res.message || 'That coupon code is not valid.' })
        couponTried(tried, 'rejected')
      }
    } catch (err) {
      setCouponNote({ kind: 'err', text: err?.message || 'We could not check that coupon code.' })
      couponTried(tried, 'error')
    } finally {
      setCouponBusy(false)
    }
  }

  const removeCoupon = () => {
    setCoupon(null)
    setCouponInput('')
    setCouponNote(null)
  }

  // Online payment: the server creates (or reuses) the order, prices it from
  // the catalogue and mints the matching Razorpay order. Everything after that
  // — opening Checkout, then having the signature verified — is what turns it
  // into a paid order. The cart is only cleared once verification succeeds.
  const payOnline = async (customer, items, couponCode) => {
    // The ad click IDs and campaign tags travel with the order as it is
    // created, before the shopper leaves for the payment window (tracking
    // brief, Section 4, step 4).
    const started = await createRazorpayOrder(customer, items, couponCode, attributionForOrder(), { test: placingTest })
    if (!started?.razorpay_order_id || !started?.key_id) {
      throw new Error('We could not start your payment. You have not been charged — please try again.')
    }

    // What this page is showing the shopper right now, in rupees — the exact
    // number in the summary and on the Pay button.
    const shownTotal = totalFor(subtotal, coupon ? discountFor(coupon, subtotal) : 0)

    // The gateway charges the total the DATABASE priced, which comes back as
    // `started.total` — never the number this page worked out for itself. If a
    // discount is showing that the server did not price, the shopper would be
    // promised ₹1,000 and asked for ₹1,500 a moment later. Drop the coupon
    // here, before the payment window opens, so the page and Razorpay agree.
    if (!serverHonoursCoupon(coupon, subtotal, started)) {
      setCoupon(null)
      setCouponInput('')
      setCouponNote({
        kind: 'err',
        text: 'That coupon could not be applied to this order — the amount in the payment window is the amount you will be charged.',
      })
    }

    // Hard gate before any gateway window opens: the total on screen must be
    // EXACTLY the paise amount Razorpay was handed. Without this a stale
    // catalogue price slipped through whenever no coupon was showing
    // (`serverHonoursCoupon` returns early in that case), and dropping a
    // mismatched coupon above left the page promising the full price while the
    // window charged the discounted one. Disagreement in either direction is
    // refused — the prices are re-read from the database instead of letting
    // the shopper discover the difference at the payment window.
    if (!displayedTotalMatchesCharge(shownTotal, started)) {
      checkoutError('price_changed')
      reload()
      setFailure('The total changed while you were checking out, so we have refreshed the prices from the store. Please review the amount below and try again — you have not been charged.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    // The shopper is on their way to pay: add_payment_info (A9), with the
    // products' total after the coupon. The method itself (UPI, card, …) is
    // picked inside Razorpay's window, out of this page's sight, so
    // payment_type is left out rather than guessed.
    sendStep(sentPayment, paymentEvent({
      items: trackedItems,
      value: Math.max(0, subtotal - (coupon ? discountFor(coupon, subtotal) : 0)),
      coupon: coupon?.code,
      eventId: newEventId(),
    }))

    // Written down before the window opens, so a reload while it is open can
    // still find out whether the shopper paid.
    attempt.current += 1
    unpaidNote.current = ''
    savePendingPayment({
      reference: started.reference,
      razorpay_order_id: started.razorpay_order_id,
      customer,
    })
    setRecovery(null)
    stopPolling()
    paying.current = true
    try {
      await settlePayment(started, customer)
    } finally {
      paying.current = false
    }
  }

  // Razorpay's window, then the server's verification of what it reports.
  const settlePayment = async (started, customer) => {
    let response
    try {
      response = await openRazorpay({
        key: started.key_id,
        amount: started.amount,
        currency: started.currency,
        orderId: started.razorpay_order_id,
        description: `Order ${started.reference}`,
        prefill: {
          name: customer.full_name,
          email: customer.email,
          contact: customer.phone.replace(/\D/g, ''),
        },
        notes: { reference: started.reference },
        onFailure: (reason) => checkoutError('payment_attempt_failed', { reason }),
      })
    } catch (error) {
      checkoutError(
        error instanceof PaymentCancelled ? 'payment_cancelled'
          : error instanceof PaymentFailed ? 'payment_failed'
            : 'payment_unavailable',
        { reason: error instanceof PaymentFailed ? error.reason : undefined },
      )
      // Closed, declined or offline. Usually nothing was charged — but a UPI
      // payment approved in the shopper's app can still land after the window
      // closes, so Razorpay is asked before the page says so. If nothing was
      // paid the cart stays put, and the next attempt reuses the same order.
      unpaidNote.current = error?.message || 'You closed the payment window. Nothing has been charged — you can try again whenever you are ready.'
      paying.current = false
      await recoverPayment()
      return
    }

    let verified
    try {
      verified = await verifyRazorpayPayment({
        reference: started.reference,
        razorpay_order_id: response.razorpay_order_id || started.razorpay_order_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature,
      })
    } catch (error) {
      // The shopper has paid: keep the saved payment, so "Check again" (and
      // the next visit to this page) can settle it from Razorpay's side.
      checkoutError('payment_unverified')
      setRecovery({ reference: started.reference, state: 'error', message: error?.message })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    if (!verified?.order?.reference) {
      checkoutError('payment_unverified')
      setRecovery({
        reference: started.reference,
        state: 'error',
        message: "We received your payment but could not confirm it yet. Please don't pay again.",
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    clearPendingPayment()
    const order = { ...verified.order, customer }
    saveOrder(order)
    clear()
    navigate(`/order/${order.reference}`, { replace: true, state: { order } })
  }

  const submit = async (e) => {
    e.preventDefault()
    if (awaitingPayment) return
    setFailure('')
    const found = validateAddress(f)
    setErrors(found)
    const firstBad = Object.keys(found)[0]
    if (firstBad) {
      checkoutError('invalid_details', { fields: Object.keys(found) })
      document.getElementById(`co-${firstBad}`)?.focus()
      return
    }
    if (!lines.length) { setFailure('Your cart is empty.'); return }
    if (lines.length > MAX_CART_LINES) {
      checkoutError('too_many_items')
      setFailure(`An order can hold up to ${MAX_CART_LINES} different items, and your basket has ${lines.length}. Please remove a few items before checking out — nothing has been charged.`)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    const customer = {
      full_name: f.full_name.trim(),
      email: f.email.trim(),
      phone: f.phone.trim(),
      address: f.address.trim(),
      city: f.city.trim(),
      state: f.state.trim(),
      pincode: f.pincode.trim(),
      note: f.note.trim(),
    }
    const items = lines.map((l) => ({ product_id: l.id, size: l.size, qty: l.qty }))

    // The address step is complete: add_shipping_info (A8). For a guest this
    // is the first time GTM learns who is buying.
    sendStep(sentShipping, shippingEvent({
      items: trackedItems,
      customer: {
        email: customer.email,
        fullName: customer.full_name,
        phone: customer.phone,
        city: customer.city,
        state: customer.state,
        pincode: customer.pincode,
      },
      value: Math.max(0, subtotal - (coupon ? discountFor(coupon, subtotal) : 0)),
      coupon: coupon?.code,
      eventId: newEventId(),
    }))

    setSubmitting(true)
    try {
      // Every order is paid online — `payOnline` creates (or reuses) the
      // order, opens Razorpay and clears the cart once verification succeeds.
      // The coupon code travels as a request only: the database re-validates
      // it and prices the order itself.
      await payOnline(customer, items, coupon?.code || '')
    } catch (err) {
      checkoutError(/coupon/i.test(err?.message || '') ? 'coupon_refused' : 'order_failed')
      setFailure(err?.message || 'We could not place your order. Please try again.')
      // A coupon the server refused must not stay applied — the customer
      // fixes it (or pays without it) on the next attempt.
      if (/coupon/i.test(err?.message || '')) {
        setCoupon(null)
        setCouponInput('')
        setCouponNote(null)
      }
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSubmitting(false)
    }
  }

  // Until the real catalogue answers, the basket can only be priced from the
  // bundled seed — wrong prices, or "empty" for products it does not know.
  // A shopper whose page reloaded mid-payment lands exactly here.
  // The database could not be read at all: the seed's prices are not the
  // shop's, so nothing is priced from them.
  if (answered && catalogueError && source === 'seed' && !submitting) {
    return (
      <section className="max-w-[720px] mx-auto px-4 py-24 text-center">
        <h1 className="text-[34px]">We couldn't load your checkout</h1>
        <p className="text-black/60 mt-3 text-[17px]">Please check your connection and try again. Nothing has been charged.</p>
        <button type="button" onClick={() => reload()} className="btn-outline mt-8">Try again</button>
      </section>
    )
  }

  if (!answered && !submitting) {
    return (
      <section className="max-w-[720px] mx-auto px-4 py-24 text-center" aria-busy="true">
        <Loader2 size={28} className="animate-spin mx-auto text-black/50" />
        <p className="text-black/60 mt-4 text-[17px]">Loading your checkout…</p>
      </section>
    )
  }

  if (!lines.length && !submitting && !recovery) {
    return (
      <section className="max-w-[720px] mx-auto px-4 py-24 text-center">
        <h1 className="text-[38px]">Your cart is empty</h1>
        <p className="text-black/60 mt-3 text-[17px]">Add something you love before checking out.</p>
        <Link to="/shop" className="inline-block bg-brand-green text-white px-10 py-4 rounded-lg mt-8 text-[17px]">Continue shopping</Link>
      </section>
    )
  }

  return (
    <section className="max-w-[1200px] mx-auto px-4 md:px-7 py-10 md:py-14">
      <Link to="/cart" className="inline-flex items-center gap-1.5 text-[15px] text-black/60 hover:text-black">
        <ArrowLeft size={16} /> Back to cart
      </Link>
      <h1 className="text-[36px] md:text-[44px] mt-4">Checkout</h1>
      <p className="text-black/60 mt-2 flex items-center gap-2 text-[15px]">
        <Lock size={15} /> Your details are sent securely and never shared.
      </p>

      {recovery && (
        <div role="status" className="mt-6 flex items-start gap-3 border border-black/15 bg-white rounded-xl px-4 py-3.5 text-[15px]">
          {recovery.state === 'error' || recovery.state === 'stalled'
            ? <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            : <Loader2 size={18} className="shrink-0 mt-0.5 animate-spin" />}
          <div className="flex-1">
            <p>
              {recovery.state === 'checking' && <>Checking your payment for order <b>{recovery.reference}</b>…</>}
              {recovery.state === 'processing' && (
                <>Razorpay is still confirming your payment for order <b>{recovery.reference}</b>. If you approved it in your UPI app, please don't pay again — this page keeps checking. If you didn't finish paying, the request expires within about 10 minutes and you can pay again then.</>
              )}
              {recovery.state === 'stalled' && (
                <>We haven't heard back from Razorpay about order <b>{recovery.reference}</b>. If you approved the payment, please don't pay again — tap Check again or contact us. If you didn't finish paying, you can pay again below.</>
              )}
              {recovery.state === 'error' && (
                <>{recovery.message || "We couldn't check your payment just now. Please don't pay again."} Your order reference is <b>{recovery.reference}</b>.</>
              )}
            </p>
            {recovery.state !== 'checking' && (
              <button type="button" onClick={() => recoverPayment()} className="mt-2 font-semibold underline underline-offset-2">
                Check again
              </button>
            )}
          </div>
        </div>
      )}

      {failure && (
        <div role="alert" className="mt-6 flex items-start gap-3 border border-red-200 bg-red-50 text-red-800 rounded-xl px-4 py-3.5 text-[15px]">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span>{failure}</span>
        </div>
      )}

      <div className="mt-8 grid lg:grid-cols-[1.35fr_1fr] gap-8 lg:gap-12 items-start">
        {/* No card background: the form sits directly on the page canvas so the
            whole checkout reads as one continuous surface. Section dividers
            (in `Section`) are what separate Contact / Delivery / Payment. */}
        <form onSubmit={submit} noValidate>
          <Section n="1" title="Contact">
            <Field
              label="Email" name="email" type="email" autoComplete="email"
              placeholder="you@example.com" value={f.email} onChange={on('email')} error={errors.email}
            />
            {!user && (
              <p className="text-[14px] text-black/55 mt-3">
                Already have an account? <Link to="/account?next=/checkout" className="underline underline-offset-2 hover:text-black">Sign in</Link> to see your orders later.
              </p>
            )}
          </Section>

          <Section n="2" title="Delivery address">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Field label="Full name" name="full_name" autoComplete="name" placeholder="Priya Sharma"
                  value={f.full_name} onChange={on('full_name')} error={errors.full_name} />
              </div>
              <div className="sm:col-span-2">
                <Field label="Phone" name="phone" type="tel" inputMode="tel" autoComplete="tel"
                  placeholder="98765 43210" value={f.phone} onChange={on('phone')} error={errors.phone} />
              </div>
              <div className="sm:col-span-2">
                <Field label="Address" name="address" autoComplete="street-address"
                  placeholder="House / flat, street, landmark" value={f.address} onChange={on('address')} error={errors.address} />
              </div>
              <Field label="City" name="city" autoComplete="address-level2" placeholder="Mumbai"
                value={f.city} onChange={on('city')} error={errors.city} />
              <Field label="PIN code" name="pincode" inputMode="numeric" autoComplete="postal-code" placeholder="400001"
                value={f.pincode} onChange={on('pincode')} error={errors.pincode} />
              <div className="sm:col-span-2">
                <label className="clabel" htmlFor="co-state">State</label>
                <input
                  id="co-state" name="state" list="indian-states" autoComplete="address-level1"
                  placeholder="Start typing or pick from the list"
                  value={f.state} onChange={on('state')}
                  aria-invalid={errors.state ? 'true' : undefined}
                  aria-describedby={errors.state ? 'co-state-err' : undefined}
                  className="cfield"
                />
                <datalist id="indian-states">{INDIAN_STATES.map((s) => <option key={s} value={s} />)}</datalist>
                {errors.state && <span className="cerror" id="co-state-err">{errors.state}</span>}
              </div>
              <div className="sm:col-span-2">
                <label className="clabel" htmlFor="co-note">Delivery note <span className="text-black/40 font-normal">(optional)</span></label>
                <textarea id="co-note" name="note" className="cfield" maxLength={500}
                  placeholder="Ring the bell twice, leave with the security desk…"
                  value={f.note} onChange={on('note')}
                  aria-invalid={errors.note ? 'true' : undefined}
                  aria-describedby={errors.note ? 'co-note-err' : undefined} />
                {errors.note && <span className="cerror" id="co-note-err">{errors.note}</span>}
              </div>
            </div>
          </Section>

          <Section n="3" title="Payment">
            <div role="radiogroup" aria-label="Payment method" className="space-y-3">
              {onlinePaymentReady && (
                <PayOption
                  value="razorpay"
                  checked={pay === 'razorpay'}
                  onChange={setPay}
                  title="Online payment"
                  body="UPI, cards, net banking and wallets — settled in Razorpay's secure window."
                />
              )}
            </div>
            <p className="text-[14px] text-black/55 mt-4 flex items-start gap-2">
              <ShieldCheck size={16} className="mt-[1px] shrink-0" />
              {onlinePaymentReady
                ? 'Card and bank details are handled entirely by Razorpay — this site never sees or stores them.'
                : 'Online payment (UPI, cards, net banking) is not connected yet — we will switch it on as soon as the gateway is live.'}
            </p>
            {isAdmin && onlinePaymentReady && (
              <label className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[14px] text-amber-900 cursor-pointer">
                <input type="checkbox" className="mt-[3px]" checked={testOrder} onChange={(e) => setTestOrder(e.target.checked)} />
                <span>
                  <span className="font-semibold">Test order (admins only).</span> Paid in Razorpay's test mode, so no money moves, and marked as a test in the admin.
                </span>
              </label>
            )}
          </Section>

          <button
            type="submit"
            disabled={submitting || awaitingPayment || !lines.length || !onlinePaymentReady}
            className="mt-8 w-full h-[56px] rounded-lg bg-brand-cta text-white text-[17px] font-semibold inline-flex items-center justify-center gap-2 hover:bg-brand-cta-hover transition disabled:opacity-60"
          >
            {submitting && <Loader2 size={18} className="animate-spin" />}
            {submitting ? 'Opening secure payment…' : `${placingTest ? 'Place test order' : 'Pay now'} · ${inr(totalFor(subtotal, coupon ? discountFor(coupon, subtotal) : 0))}`}
          </button>
          {/* The shop's published rating, beside the last button. */}
          <ShopRatingNote className="mt-3" />
          <p className="text-[13px] text-black/50 mt-3 text-center">
            By placing this order you agree to our <Link to="/policies/terms-of-service" className="underline underline-offset-2">terms</Link> and <Link to="/policies/refund-policy" className="underline underline-offset-2">return &amp; refund policy</Link>.
          </p>
        </form>

        <aside className="lg:sticky lg:top-[120px]">
          <Summary
            lines={lines}
            subtotal={subtotal}
            coupon={coupon}
            couponInput={couponInput}
            setCouponInput={setCouponInput}
            couponBusy={couponBusy}
            couponNote={couponNote}
            onApply={applyCoupon}
            onRemoveCoupon={removeCoupon}
          />
        </aside>
      </div>
    </section>
  )
}
