import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, Loader2, Lock, MapPin, ShieldCheck, Store, Tag, Truck, X } from 'lucide-react'
import usePageTitle from '../hooks/usePageTitle'
import { useCart } from '../context/CartContext'
import { useProducts } from '../context/ProductsContext'
import { useAuth } from '../context/AuthContext'
import Img from '../components/Img'
import CheckoutHeader from '../components/CheckoutHeader'
import { ShopRatingNote } from '../components/Stars'
import { site } from '../data/site'
import { saveOrder } from '../lib/orderStore'
import { displayedTotalMatchesCharge, inr, shippingFor, totalFor } from '../lib/pricing'
import { couponsAvailable, discountFor, serverHonoursCoupon, validateCoupon } from '../lib/coupons'
import { EMPTY_ADDRESS, INDIAN_STATES, MAX_CART_LINES, mobileOk, mobileProblem, normalizeMobile, validateAddress } from '../lib/checkout'
import { leadItems, leadSource, saveCheckoutLead } from '../lib/checkoutLeads'
import { loadDetails, saveDetails } from '../lib/checkoutMemory'
import { lookupPincode, preloadPincode } from '../lib/pincodes'
import { deliveryWindowText } from '../lib/delivery'
import { suggestEmail } from '../lib/emailTypos'
import { checkoutWhatsAppLink } from '../lib/whatsapp'
import { PaymentCancelled, PaymentFailed, onlinePaymentReady, openRazorpay, preloadRazorpay } from '../lib/razorpay'
import { checkPendingPayment, createRazorpayOrder, verifyRazorpayPayment } from '../lib/payments'
import { clearPendingPayment, loadPendingPayment, savePendingPayment } from '../lib/pendingPayment'
import { newEventId, trackEcommerce, trackSafely } from '../lib/tracking'
import { cartEvent, checkoutErrorEvent, contactEvent, couponEvent, paymentEvent, sameStep, shippingEvent } from '../lib/trackingItems'
import { attributionForOrder } from '../lib/adClicks'
import { experimentsForOrder } from '../lib/experiments'

// GA4 (event schema of 8 Nov 2026): the coupons shoppers try, and what stops
// a checkout — by kind, never with anything the shopper typed.
const checkoutError = (type, details) => trackSafely(() => checkoutErrorEvent(type, { ...details, eventId: newEventId() }))
const couponTried = (code, result) => trackSafely(() => couponEvent(code, result, { eventId: newEventId() }))

// The order the fields appear in, which is also the order Pay moves the
// cursor through when something is missing (validateAddress lists them
// differently).
const FIELD_ORDER = ['phone', 'full_name', 'email', 'pincode', 'city', 'state', 'address', 'note']

// A clear green for "this is fine": ticks, Free, the discount. (The theme's
// own `green` scale is remapped to the brand's browns.)
const OK_GREEN = 'text-[#1F7A34]'

// One labelled input. The tick shows once the value passes the same check Pay
// runs (validateAddress); `hint` is a short line under the field; `prefix` is
// a fixed box in front of it (the +91 of the mobile number). `!pr-10` keeps
// text clear of the tick: `.cfield` (index.css, outside Tailwind's layers)
// would otherwise win with its own padding.
function Field({ label, name, value, onChange, error, valid, hint, prefix, children, ...rest }) {
  const describedBy = [error && `co-${name}-err`, hint && `co-${name}-hint`].filter(Boolean).join(' ') || undefined
  return (
    <div>
      <label className="clabel" htmlFor={`co-${name}`}>{label}</label>
      <div className="relative flex">
        {prefix && (
          <span aria-hidden="true" className="shrink-0 grid place-items-center px-3.5 rounded-l-lg border border-r-0 border-black/30 bg-black/[0.04] font-ui text-[16px] text-black/70">
            {prefix}
          </span>
        )}
        <input
          id={`co-${name}`}
          name={name}
          value={value}
          onChange={onChange}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          className={`cfield !pr-10 min-w-0${prefix ? ' !rounded-l-none' : ''}`}
          {...rest}
        />
        {valid && !error && (
          <Check size={18} strokeWidth={2.5} aria-hidden="true" className={`absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none ${OK_GREEN}`} />
        )}
      </div>
      {hint && <span className="block text-[13px] text-black/60 mt-1.5" id={`co-${name}-hint`}>{hint}</span>}
      {error && <span className="cerror" id={`co-${name}-err`}>{error}</span>}
      {children}
    </div>
  )
}

// The order, first thing on a phone and beside the form on a computer: what
// is being bought, the total with nothing added later, a coupon link only
// while a coupon is live, and the dates the parcel should arrive.
function Summary({
  lines, subtotal, coupon, couponsLive, couponInput, setCouponInput, couponBusy, couponNote, onApply, onRemoveCoupon, delivery,
}) {
  const shipping = shippingFor()
  // Display only — the database recomputes the real discount when the order
  // is created and prices the payment from its own total.
  const discount = coupon ? discountFor(coupon, subtotal) : 0
  const [couponOpen, setCouponOpen] = useState(false)
  return (
    <div className="border border-black/10 rounded-xl bg-white/50 p-4 md:p-5 shadow-[0_1px_2px_rgba(74,44,35,.04)]">
      <h2 className="sr-only">Your order</h2>
      <ul className="space-y-3">
        {lines.map((l) => (
          <li key={l.id + l.size} className="flex gap-3 items-center">
            <div className="relative w-12 h-16 shrink-0 bg-neutral-100 rounded overflow-hidden">
              <Img src={l.image} alt={l.product.title} sizes="48px" className="w-full h-full object-cover" />
              {l.qty > 1 && (
                <span className="absolute top-0 right-0 bg-black/75 text-white text-[11px] font-ui px-1.5 py-[1px] rounded-bl">{l.qty}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium leading-snug line-clamp-2">{l.product.title}</p>
              <p className="text-[13px] text-black/60 mt-0.5">{[l.color, `Size ${l.size}`, `Qty ${l.qty}`].filter(Boolean).join(' · ')}</p>
            </div>
            <p className="font-ui text-[15px] font-semibold shrink-0">{inr(l.price * l.qty)}</p>
          </li>
        ))}
      </ul>

      <dl className="mt-4 pt-3 border-t border-black/10 space-y-1.5 text-[15px]">
        <div className="flex justify-between"><dt className="text-black/65">Subtotal</dt><dd className="font-ui">{inr(subtotal)}</dd></div>
        {discount > 0 && (
          <div className="flex justify-between">
            <dt className="text-black/65">Discount</dt>
            <dd className={`font-ui font-semibold ${OK_GREEN}`}>−{inr(discount)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-black/65">Shipping</dt>
          <dd className="font-ui">{shipping === 0 ? <span className={`font-semibold ${OK_GREEN}`}>Free</span> : inr(shipping)}</dd>
        </div>
        {/* "Taxes included, no extra charges": extra costs at the last step
            are the most common reason people abandon a checkout. */}
        <div className="flex justify-between items-baseline gap-3 pt-2 border-t border-black/10">
          <dt>
            <span className="text-[17px] font-semibold">Total</span>{' '}
            <span className="text-[13px] text-black/60">· taxes included, no extra charges</span>
          </dt>
          <dd className="font-ui text-[18px] font-semibold shrink-0">{inr(totalFor(subtotal, discount))}</dd>
        </div>
      </dl>

      {/* Coupon: offered only while a coupon is live (couponsAvailable), and
          behind a link, so an empty box doesn't send shoppers hunting for
          codes. The code is only ever checked by the database — invalid,
          expired or inactive codes are refused with the server's own message. */}
      {(coupon || couponsLive || couponNote) && (
        <div className="mt-3">
          {coupon ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-[14px] min-w-0 truncate">
                <Tag size={15} className={`inline -mt-0.5 mr-1.5 ${OK_GREEN}`} />
                Coupon <span className="font-mono font-semibold">{coupon.code}</span>
                <span className={`font-semibold ${OK_GREEN}`}> · −{inr(discount)}</span>
              </p>
              <button
                type="button"
                onClick={onRemoveCoupon}
                className="inline-flex items-center gap-1 text-[13px] text-black/55 hover:text-red-600 shrink-0"
              >
                <X size={14} /> Remove
              </button>
            </div>
          ) : couponOpen ? (
            <>
              <label htmlFor="coupon-code" className="sr-only">Coupon code</label>
              <div className="flex gap-2">
                <input
                  id="coupon-code"
                  type="text"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  placeholder="Coupon code"
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoFocus
                  className="flex-1 min-w-0 h-[44px] px-3 rounded-lg border border-black/30 bg-white text-[16px] font-mono outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:font-sans placeholder:text-black/40"
                />
                <button
                  type="button"
                  onClick={onApply}
                  disabled={couponBusy || !couponInput.trim()}
                  className="h-[44px] px-4 rounded-lg border border-black/60 text-[14px] font-semibold inline-flex items-center gap-1.5 hover:bg-black hover:text-white transition disabled:opacity-60"
                >
                  {couponBusy ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} />}
                  {couponBusy ? 'Checking…' : 'Apply'}
                </button>
              </div>
            </>
          ) : couponsLive ? (
            <button
              type="button"
              onClick={() => setCouponOpen(true)}
              className="text-[14px] font-medium text-black/75 underline underline-offset-2 hover:text-black"
            >
              Have a coupon?
            </button>
          ) : null}
          {couponNote && (
            <p role="status" aria-live="polite" className={`mt-2 text-[13px] ${couponNote.kind === 'ok' ? OK_GREEN : 'text-red-600'}`}>
              {couponNote.text}
            </p>
          )}
        </div>
      )}

      <p className="mt-3 pt-3 border-t border-black/10 flex items-center gap-2 text-[14px] text-black/75">
        <Truck size={17} aria-hidden="true" className={`shrink-0 ${OK_GREEN}`} />
        <span>{shipping === 0 ? 'Free delivery' : 'Delivery'} · arrives <b className="font-semibold text-black">{delivery}</b></span>
      </p>
    </div>
  )
}

export default function Checkout() {
  usePageTitle('Checkout')
  const { lines, trackedItems, subtotal, prune, clear } = useCart()
  const { reload, loading, answered, error: catalogueError, source } = useProducts()
  const { user, isAdmin } = useAuth()
  const navigate = useNavigate()

  // What was typed here before (on this phone) comes back: checkoutMemory.js.
  const [f, setF] = useState(() => ({ ...EMPTY_ADDRESS, ...loadDetails() }))
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
  // Whether any coupon is live: "Have a coupon?" is offered only then.
  const [couponsLive, setCouponsLive] = useState(false)
  // Set when the shopper leaves the email field, so "Did you mean …?" is
  // about what they finished typing, not every keystroke.
  const [emailLeft, setEmailLeft] = useState(false)
  // The delivery note stays folded away until it is asked for.
  const [noteOpen, setNoteOpen] = useState(false)
  // The phone Pay bar shows only while the Pay button itself is off screen
  // and the shopper isn't typing (their keyboard is up).
  const [payInView, setPayInView] = useState(true)
  const [typing, setTyping] = useState(false)
  const payWatch = useRef(null)
  // City and state from the PIN code (pincodes.js). 'auto' shows them as one
  // line with Change; 'manual' shows the City and State boxes, which is also
  // where things land when a PIN isn't in India Post's list or the list can't
  // be reached. `place` is the latest lookup: { pin, status, city, state }.
  const [placeMode, setPlaceMode] = useState('auto')
  const [place, setPlace] = useState(null)
  // The PIN whose city and state are on the form, and the PIN that came back
  // from this phone's memory (a city it holds was perhaps typed by hand).
  const placeFor = useRef('')
  const restoredPin = useRef(f.pincode.trim())
  const latest = useRef(f)
  latest.current = f

  // Price against the live catalogue — never against a stale cache — before
  // any money changes hands.
  useEffect(() => { reload() }, [reload])
  // Asked once, alongside the catalogue; nothing on the page waits for it.
  useEffect(() => {
    let alive = true
    couponsAvailable().then((yes) => { if (alive) setCouponsLive(yes) })
    return () => { alive = false }
  }, [])
  // Typing anywhere on the page (address or coupon) hides the Pay bar, so it
  // never sits on top of the field being filled in.
  useEffect(() => {
    const isField = (el) => !!el && (el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(el.type)))
    const onIn = (e) => { if (isField(e.target)) setTyping(true) }
    const onOut = (e) => { if (!isField(e.relatedTarget)) setTyping(false) }
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    return () => {
      document.removeEventListener('focusin', onIn)
      document.removeEventListener('focusout', onOut)
    }
  }, [])
  // Watches the Pay button once it is on the page (a callback ref, because the
  // form only appears after the catalogue answers).
  const payButton = useCallback((el) => {
    payWatch.current?.disconnect()
    payWatch.current = null
    if (!el || typeof IntersectionObserver === 'undefined') return
    payWatch.current = new IntersectionObserver(
      ([entry]) => setPayInView(entry.intersectionRatio >= 0.6),
      { threshold: [0, 0.6, 1] },
    )
    payWatch.current.observe(el)
  }, [])
  // Products the owner hid or deleted cannot be ordered.
  useEffect(() => { prune() }, [prune])
  // Fetch Razorpay's script while the shopper fills in the form, so tapping
  // Pay opens the payment window without waiting for it (preloadRazorpay).
  const hasLines = lines.length > 0
  useEffect(() => { if (hasLines) preloadRazorpay() }, [hasLines])

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

  // Keep what is typed on this phone, a moment after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => saveDetails(f), 400)
    return () => clearTimeout(timer)
  }, [f])

  // PIN code → city and state. The file for the first two digits is fetched
  // while the PIN is being typed, so the answer is ready at the sixth digit.
  const pin = f.pincode.trim()
  useEffect(() => {
    preloadPincode(pin)
    if (!/^[1-9][0-9]{5}$/.test(pin)) { setPlace(null); return undefined }
    let alive = true
    setPlace({ pin, status: 'looking' })
    lookupPincode(pin).then((found) => {
      if (!alive) return
      if (!found) {
        setPlace({ pin, status: 'missing' })
        setPlaceMode('manual')
        return
      }
      setPlace({ pin, status: 'found', ...found })
      if (placeFor.current === pin) return
      placeFor.current = pin
      // A city and state remembered for this same PIN that differ from the
      // list were typed by the shopper: keep them, in the boxes.
      const v = latest.current
      if (pin === restoredPin.current && v.city.trim() && v.state.trim() && (v.city !== found.city || v.state !== found.state)) {
        setPlaceMode('manual')
        return
      }
      setF((cur) => ({ ...cur, city: found.city, state: found.state }))
      setErrors((prev) => (prev.city || prev.state ? { ...prev, city: undefined, state: undefined } : prev))
      setPlaceMode('auto')
    })
    return () => { alive = false }
  }, [pin])

  // Unpaid checkouts (checkoutLeads.js): once the mobile number is a valid
  // Indian mobile and the cart has something in it, the number and the cart
  // are recorded in the background, so the owner can offer help on WhatsApp
  // if the shopper leaves without paying. Sent again only when the number or
  // the cart changes. An admin's own visits are left out.
  const leadKey = !isAdmin && lines.length && mobileOk(f.phone)
    ? `${f.phone}|${lines.map((l) => `${l.id}:${l.size}:${l.qty}`).join(',')}`
    : ''
  const leadSent = useRef('')
  const latestLines = useRef(lines)
  latestLines.current = lines
  useEffect(() => {
    if (!leadKey || leadSent.current === leadKey) return undefined
    const timer = setTimeout(() => {
      leadSent.current = leadKey
      saveCheckoutLead({
        phone: leadKey.split('|')[0],
        items: leadItems(latestLines.current),
        source: leadSource(attributionForOrder()),
      })
    }, 800)
    return () => clearTimeout(timer)
  }, [leadKey])

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
  // The mobile number keeps only its 10 digits as it is typed or pasted
  // (normalizeMobile); leaving it unfinished says what is missing.
  const onPhone = (e) => {
    const phone = normalizeMobile(e.target.value)
    setF((v) => ({ ...v, phone }))
    setErrors((prev) => (prev.phone ? { ...prev, phone: undefined } : prev))
  }
  const phoneLeft = () => {
    const problem = f.phone ? mobileProblem(f.phone) : ''
    if (problem) setErrors((prev) => ({ ...prev, phone: problem }))
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
    // brief, Section 4, step 4). So do the A/B tests this shopper is counted
    // in, so paid orders per version come from the database.
    const started = await createRazorpayOrder(customer, items, couponCode, attributionForOrder(), {
      test: placingTest,
      experiments: experimentsForOrder(),
    })
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
    const firstBad = FIELD_ORDER.find((k) => found[k])
    if (firstBad) {
      checkoutError('invalid_details', { fields: Object.keys(found) })
      if (found.city || found.state) setPlaceMode('manual')
      // After the re-render, so a City or State box that has just appeared can take the cursor.
      setTimeout(() => document.getElementById(`co-${firstBad}`)?.focus(), 0)
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

  // What the page is charging right now: the number in the summary, on Pay,
  // on the phone Pay bar and in the WhatsApp message.
  const total = totalFor(subtotal, coupon ? discountFor(coupon, subtotal) : 0)
  // "Chat with us" opens WhatsApp with the cart already written out.
  const chatHref = checkoutWhatsAppLink({
    number: site.whatsappNumber,
    lines: lines.map((l) => ({ title: l.product.title, color: l.color, size: l.size, qty: l.qty, amount: inr(l.price * l.qty) })),
    total: lines.length ? inr(total) : '',
  })
  // GA4's contact event for a tap on "Chat with us".
  const chatTapped = () => trackSafely(() => contactEvent(chatHref, { location: 'checkout_whatsapp_button', eventId: newEventId() }))
  const header = <CheckoutHeader chatHref={chatHref} onChat={chatTapped} />

  // Until the real catalogue answers, the basket can only be priced from the
  // bundled seed — wrong prices, or "empty" for products it does not know.
  // A shopper whose page reloaded mid-payment lands exactly here.
  // The database could not be read at all: the seed's prices are not the
  // shop's, so nothing is priced from them.
  if (answered && catalogueError && source === 'seed' && !submitting) {
    return (
      <>
        {header}
        <section className="max-w-[720px] mx-auto px-4 py-24 text-center">
          <h1 className="text-[34px]">We couldn't load your checkout</h1>
          <p className="text-black/60 mt-3 text-[17px]">Please check your connection and try again. Nothing has been charged.</p>
          <button type="button" onClick={() => reload()} className="btn-outline mt-8">Try again</button>
        </section>
      </>
    )
  }

  if (!answered && !submitting) {
    return (
      <>
        {header}
        <section className="max-w-[720px] mx-auto px-4 py-24 text-center" aria-busy="true">
          <Loader2 size={28} className="animate-spin mx-auto text-black/50" />
          <p className="text-black/60 mt-4 text-[17px]">Loading your checkout…</p>
        </section>
      </>
    )
  }

  if (!lines.length && !submitting && !recovery) {
    return (
      <>
        {header}
        <section className="max-w-[720px] mx-auto px-4 py-24 text-center">
          <h1 className="text-[38px]">Your cart is empty</h1>
          <p className="text-black/60 mt-3 text-[17px]">Add something you love before checking out.</p>
          <Link to="/shop" className="inline-block bg-brand-green text-white px-10 py-4 rounded-lg mt-8 text-[17px]">Continue shopping</Link>
        </section>
      </>
    )
  }

  // Every field Pay would refuse right now; a field not listed gets its tick.
  const problems = validateAddress(f)
  const ok = (k) => !problems[k]
  // City and state: one line once India Post's list knows the PIN, the two
  // boxes when it doesn't (or the shopper taps Change, or they need fixing).
  const showPlaceLine = placeMode === 'auto' && place?.status === 'found' && place.pin === pin && !!f.city && !!f.state
  const showPlaceBoxes = !showPlaceLine && (placeMode === 'manual' || place?.status === 'missing' || !!errors.city || !!errors.state)
  const emailSuggestion = emailLeft ? suggestEmail(f.email) : null
  const takeSuggestion = () => {
    setF((v) => ({ ...v, email: emailSuggestion }))
    setErrors((prev) => (prev.email ? { ...prev, email: undefined } : prev))
  }
  const payDisabled = submitting || awaitingPayment || !lines.length || !onlinePaymentReady
  const showPayBar = !payInView && !typing && !awaitingPayment && lines.length > 0 && onlinePaymentReady

  return (
    <>
      {header}
      {/* Bottom room on phones for the Pay bar, so the last lines can scroll
          clear of it. */}
      <section className="max-w-[1100px] mx-auto px-4 md:px-7 pt-4 md:pt-8 pb-28 lg:pb-14">
        <h1 className="sr-only">Checkout</h1>

        {recovery && (
          <div role="status" className="mb-4 flex items-start gap-3 border border-black/15 bg-white rounded-xl px-4 py-3.5 text-[15px]">
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
          <div role="alert" className="mb-4 flex items-start gap-3 border border-red-200 bg-red-50 text-red-800 rounded-xl px-4 py-3.5 text-[15px]">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <span>{failure}</span>
          </div>
        )}

        {/* On a phone the order comes first; on a computer it sits beside the
            form. */}
        <div className="grid lg:grid-cols-[1.35fr_1fr] gap-4 lg:gap-12 items-start">
          <div className="lg:col-start-2 lg:row-start-1 lg:sticky lg:top-[84px] min-w-0">
            <Summary
              lines={lines}
              subtotal={subtotal}
              coupon={coupon}
              couponsLive={couponsLive}
              couponInput={couponInput}
              setCouponInput={setCouponInput}
              couponBusy={couponBusy}
              couponNote={couponNote}
              onApply={applyCoupon}
              onRemoveCoupon={removeCoupon}
              delivery={deliveryWindowText()}
            />
            {/* How the shopper will pay, before they start typing. The method
                itself is picked inside Razorpay's window. */}
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[13px] text-black/65">
              <Lock size={13} aria-hidden="true" className="shrink-0" />
              {onlinePaymentReady
                ? 'UPI, cards & net banking · secured by Razorpay'
                : 'Online payment (UPI, cards, net banking) is not connected yet.'}
            </p>
          </div>

          <form id="checkout-form" onSubmit={submit} noValidate className="lg:col-start-1 lg:row-start-1 min-w-0">
            <h2 className="sr-only">Delivery details</h2>
            <div className="border border-black/10 rounded-xl bg-white/50 p-4 md:p-6 space-y-4">
              <Field
                label={<>Mobile number<span className="sr-only"> (India, +91)</span></>}
                name="phone" type="tel" inputMode="numeric" autoComplete="tel-national" prefix="+91"
                placeholder="98765 43210" value={f.phone} onChange={onPhone} onBlur={phoneLeft} error={errors.phone}
                valid={ok('phone')} hint="For order updates only. No spam, promise."
              />
              <Field
                label="Full name" name="full_name" autoComplete="name" autoCapitalize="words" placeholder="Priya Sharma"
                value={f.full_name} onChange={on('full_name')} error={errors.full_name} valid={ok('full_name')}
              />
              <Field
                label={<>Email <span className="font-normal text-black/50">· for your receipt</span></>}
                name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" spellCheck={false}
                placeholder="you@example.com" value={f.email} onChange={on('email')} error={errors.email}
                valid={ok('email') && !emailSuggestion}
                onFocus={() => setEmailLeft(false)} onBlur={() => setEmailLeft(true)}
              >
                {emailSuggestion && (
                  <button type="button" onClick={takeSuggestion} className="block mt-1.5 text-left text-[13px] text-black/70 hover:text-black">
                    Did you mean <b className="font-semibold underline underline-offset-2 break-all">{emailSuggestion}</b>?
                  </button>
                )}
              </Field>
              <Field
                label="PIN code" name="pincode" inputMode="numeric" autoComplete="postal-code" maxLength={6}
                value={f.pincode} onChange={on('pincode')} error={errors.pincode} valid={ok('pincode')}
              >
                {showPlaceLine && (
                  <p className="mt-2 flex items-center gap-1.5 text-[14px] text-black/75" aria-live="polite">
                    <MapPin size={15} aria-hidden="true" className={`shrink-0 ${OK_GREEN}`} />
                    <span className="min-w-0">{f.city}, {f.state}</span>
                    <span aria-hidden="true" className="text-black/35">·</span>
                    <button
                      type="button"
                      onClick={() => { setPlaceMode('manual'); setTimeout(() => document.getElementById('co-city')?.focus(), 0) }}
                      className="font-medium underline underline-offset-2 hover:text-black shrink-0"
                    >
                      Change
                    </button>
                  </p>
                )}
              </Field>
              {showPlaceBoxes && (
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="City" name="city" autoComplete="address-level2"
                    value={f.city} onChange={on('city')} error={errors.city} valid={ok('city')}
                  />
                  <Field
                    label="State" name="state" list="indian-states" autoComplete="address-level1"
                    value={f.state} onChange={on('state')} error={errors.state} valid={ok('state')}
                  />
                </div>
              )}
              <datalist id="indian-states">{INDIAN_STATES.map((s) => <option key={s} value={s} />)}</datalist>
              <Field
                label="House / flat, street, landmark" name="address" autoComplete="street-address"
                placeholder="Flat 12, 3rd Cross, near the temple" value={f.address} onChange={on('address')}
                error={errors.address} valid={ok('address')}
              />
              {noteOpen || f.note ? (
                <div>
                  <label className="clabel" htmlFor="co-note">Delivery note <span className="text-black/40 font-normal">(optional)</span></label>
                  <textarea id="co-note" name="note" className="cfield" maxLength={500} autoFocus={noteOpen}
                    placeholder="Ring the bell twice, leave with the security desk…"
                    value={f.note} onChange={on('note')}
                    aria-invalid={errors.note ? 'true' : undefined}
                    aria-describedby={errors.note ? 'co-note-err' : undefined} />
                  {errors.note && <span className="cerror" id="co-note-err">{errors.note}</span>}
                </div>
              ) : (
                <button type="button" onClick={() => setNoteOpen(true)} className="text-[14px] font-medium text-black/70 hover:text-black">
                  + Add delivery note
                </button>
              )}
            </div>

            {isAdmin && onlinePaymentReady && (
              <label className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[14px] text-amber-900 cursor-pointer">
                <input type="checkbox" className="mt-[3px]" checked={testOrder} onChange={(e) => setTestOrder(e.target.checked)} />
                <span>
                  <span className="font-semibold">Test order (admins only).</span> Paid in Razorpay's test mode, so no money moves, and marked as a test in the admin.
                </span>
              </label>
            )}

            <button
              ref={payButton}
              type="submit"
              disabled={payDisabled}
              className="mt-5 w-full h-[56px] rounded-lg bg-brand-cta text-white text-[17px] font-semibold inline-flex items-center justify-center gap-2 hover:bg-brand-cta-hover transition disabled:opacity-60"
            >
              {submitting ? <Loader2 size={18} className="animate-spin" /> : !placingTest && <Lock size={17} aria-hidden="true" />}
              {submitting ? 'Opening secure payment…' : placingTest ? `Place test order · ${inr(total)}` : `Pay ${inr(total)} securely`}
            </button>

            {/* The reassurance in one place, right under Pay: the shop's
                published rating, what happens if something arrives damaged or
                wrong (the return & refund policy), and who is selling. */}
            <div className="mt-4 rounded-xl border border-black/10 bg-white/50 px-4 py-3 space-y-2 text-[13.5px] text-black/70">
              <ShopRatingNote align="start" />
              <p className="flex items-start gap-2">
                <ShieldCheck size={16} aria-hidden="true" className="mt-[1px] shrink-0 text-black/55" />
                <span>Damaged or wrong item? We'll replace it or refund you.</span>
              </p>
              <p className="flex items-start gap-2">
                <Store size={16} aria-hidden="true" className="mt-[1px] shrink-0 text-black/55" />
                <span>Sold by <b className="font-semibold text-black/80">{site.seller.name}</b>, {site.seller.city} · GSTIN {site.seller.gstin}</span>
              </p>
            </div>
            {/* New tabs, so reading a policy never loses what was typed. */}
            <p className="text-[13px] text-black/55 mt-3 text-center">
              By paying you agree to our <Link to="/policies/terms-of-service" target="_blank" rel="noopener" className="underline underline-offset-2">terms</Link> and <Link to="/policies/refund-policy" target="_blank" rel="noopener" className="underline underline-offset-2">return &amp; refund policy</Link>.
            </p>
          </form>
        </div>
      </section>

      {/* Phones: the total and Pay stay in reach while the Pay button itself
          is off screen, and step aside while a field is being typed in. It
          submits the same form, so every check and event is the same. */}
      {showPayBar && (
        <div
          className="lg:hidden fixed inset-x-0 bottom-0 z-30 bg-white border-t border-black/10 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="max-w-[640px] mx-auto h-[4.5rem] px-4 flex items-center gap-4">
            <div className="font-ui leading-tight min-w-0">
              <p className="font-bold text-[20px] text-black">{inr(total)}</p>
              <p className={`text-[13px] font-medium ${OK_GREEN}`}>{shippingFor() === 0 ? 'Free delivery' : 'Taxes included'}</p>
            </div>
            <button
              type="submit"
              form="checkout-form"
              disabled={payDisabled}
              className="ml-auto h-12 px-6 rounded-lg bg-brand-cta text-white text-[16px] font-semibold inline-flex items-center gap-2 hover:bg-brand-cta-hover transition disabled:opacity-60"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} aria-hidden="true" />}
              {placingTest ? 'Place test order' : 'Pay securely'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
