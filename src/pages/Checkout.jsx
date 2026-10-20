import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Lock, ShieldCheck, AlertTriangle, Tag, X } from 'lucide-react'
import usePageTitle from '../hooks/usePageTitle'
import { useCart } from '../context/CartContext'
import { useProducts } from '../context/ProductsContext'
import { useAuth } from '../context/AuthContext'
import Img from '../components/Img'
import { saveOrder } from '../lib/orderStore'
import { displayedTotalMatchesCharge, inr, shippingFor, totalFor } from '../lib/pricing'
import { discountFor, serverHonoursCoupon, validateCoupon } from '../lib/coupons'
import { EMPTY_ADDRESS, INDIAN_STATES, MAX_CART_LINES, validateAddress } from '../lib/checkout'
import { onlinePaymentReady, openRazorpay } from '../lib/razorpay'
import { createRazorpayOrder, verifyRazorpayPayment } from '../lib/payments'

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
              <Img src={l.image} alt={l.product.title} className="w-full h-full object-cover" />
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
  const { lines, subtotal, prune, clear } = useCart()
  const { reload } = useProducts()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [f, setF] = useState(EMPTY_ADDRESS)
  const [errors, setErrors] = useState({})
  const [failure, setFailure] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pay, setPay] = useState('razorpay')
  // The applied coupon, exactly as the DATABASE validated it (see
  // src/lib/coupons.js): { valid, code, kind, value, discount, message }.
  const [coupon, setCoupon] = useState(null)
  const [couponInput, setCouponInput] = useState('')
  const [couponBusy, setCouponBusy] = useState(false)
  const [couponNote, setCouponNote] = useState(null)
  const prefilled = useRef(false)

  // Price against the live catalogue — never against a stale cache — before
  // any money changes hands.
  useEffect(() => { reload() }, [reload])
  // Products the owner hid or deleted cannot be ordered.
  useEffect(() => { prune() }, [prune])

  useEffect(() => {
    if (prefilled.current || !user?.email) return
    prefilled.current = true
    setF((v) => ({ ...v, email: v.email || user.email }))
  }, [user])

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
    try {
      const res = await validateCoupon(couponInput, subtotal)
      if (res.valid) {
        setCoupon(res)
        setCouponNote({ kind: 'ok', text: res.message || 'Coupon applied.' })
      } else {
        setCoupon(null)
        setCouponNote({ kind: 'err', text: res.message || 'That coupon code is not valid.' })
      }
    } catch (err) {
      setCouponNote({ kind: 'err', text: err?.message || 'We could not check that coupon code.' })
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
    const started = await createRazorpayOrder(customer, items, couponCode)
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
      reload()
      setFailure('The total changed while you were checking out, so we have refreshed the prices from the store. Please review the amount below and try again — you have not been charged.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

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
      })
    } catch (error) {
      // Closed, declined or offline: nothing was charged, the cart stays put,
      // and the next attempt reuses the same order instead of making another.
      setFailure(error?.message || 'You closed the payment window. Nothing has been charged — you can try again whenever you are ready.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    const verified = await verifyRazorpayPayment({
      reference: started.reference,
      razorpay_order_id: response.razorpay_order_id || started.razorpay_order_id,
      razorpay_payment_id: response.razorpay_payment_id,
      razorpay_signature: response.razorpay_signature,
    })

    if (!verified?.order?.reference) {
      throw new Error("We received your payment but could not confirm it yet. Please don't pay again — contact us quoting your order reference.")
    }

    const order = { ...verified.order, customer }
    saveOrder(order)
    clear()
    navigate(`/order/${order.reference}`, { replace: true, state: { order } })
  }

  const submit = async (e) => {
    e.preventDefault()
    setFailure('')
    const found = validateAddress(f)
    setErrors(found)
    const firstBad = Object.keys(found)[0]
    if (firstBad) {
      document.getElementById(`co-${firstBad}`)?.focus()
      return
    }
    if (!lines.length) { setFailure('Your cart is empty.'); return }
    if (lines.length > MAX_CART_LINES) {
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

    setSubmitting(true)
    try {
      // Every order is paid online — `payOnline` creates (or reuses) the
      // order, opens Razorpay and clears the cart once verification succeeds.
      // The coupon code travels as a request only: the database re-validates
      // it and prices the order itself.
      await payOnline(customer, items, coupon?.code || '')
    } catch (err) {
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

  if (!lines.length && !submitting) {
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
          </Section>

          <button
            type="submit"
            disabled={submitting || !lines.length || !onlinePaymentReady}
            className="mt-8 w-full h-[56px] rounded-lg bg-brand-green text-white text-[17px] font-semibold inline-flex items-center justify-center gap-2 hover:bg-[#A86B5C] transition disabled:opacity-60"
          >
            {submitting && <Loader2 size={18} className="animate-spin" />}
            {submitting ? 'Opening secure payment…' : `Pay now · ${inr(totalFor(subtotal, coupon ? discountFor(coupon, subtotal) : 0))}`}
          </button>
          <p className="text-[13px] text-black/50 mt-3 text-center">
            By placing this order you agree to our <Link to="/policies/terms-of-service" className="underline underline-offset-2">terms</Link> and <Link to="/policies/refund-policy" className="underline underline-offset-2">refund policy</Link>.
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
