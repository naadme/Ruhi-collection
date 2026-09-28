import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Lock, ShieldCheck, AlertTriangle, Truck } from 'lucide-react'
import usePageTitle from '../hooks/usePageTitle'
import { useCart } from '../context/CartContext'
import { useProducts } from '../context/ProductsContext'
import { useAuth } from '../context/AuthContext'
import Img from '../components/Img'
import { supabase } from '../lib/supabase'
import { saveOrder } from '../lib/orderStore'
import { SHIPPING_FEE, amountToFreeShipping, inr, shippingFor, totalFor } from '../lib/pricing'
import { EMPTY_ADDRESS, INDIAN_STATES, validateAddress } from '../lib/checkout'

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

function Summary({ lines, subtotal, compact }) {
  const shipping = shippingFor(subtotal)
  const gap = amountToFreeShipping(subtotal)
  return (
    <div className="border border-black/12 rounded-xl bg-white p-5">
      <h2 className="text-[17px] font-semibold">Order summary</h2>
      <ul className="mt-4 space-y-4">
        {lines.map((l) => (
          <li key={l.id + l.size} className="flex gap-3">
            <div className="relative w-14 h-[74px] shrink-0 bg-neutral-100 rounded overflow-hidden">
              <Img src={l.product.image} alt={l.product.title} className="w-full h-full object-cover" />
              {l.qty > 1 && (
                <span className="absolute top-0 right-0 bg-black/75 text-white text-[11px] font-ui px-1.5 py-[1px] rounded-bl">{l.qty}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-snug line-clamp-2">{l.product.title}</p>
              <p className="text-[13px] text-black/55 mt-0.5">Size {l.size} · Qty {l.qty}</p>
            </div>
            <p className="font-ui text-[15px] font-semibold shrink-0">{inr(l.product.price * l.qty)}</p>
          </li>
        ))}
      </ul>

      <dl className="mt-5 pt-5 border-t border-black/10 space-y-2 text-[15px]">
        <div className="flex justify-between"><dt className="text-black/65">Subtotal</dt><dd className="font-ui">{inr(subtotal)}</dd></div>
        <div className="flex justify-between">
          <dt className="text-black/65">Shipping</dt>
          <dd className="font-ui">{shipping === 0 ? <span className="text-brand-green font-semibold">Free</span> : inr(shipping)}</dd>
        </div>
        <div className="flex justify-between pt-3 border-t border-black/10 text-[18px] font-semibold">
          <dt>Total</dt><dd className="font-ui">{inr(totalFor(subtotal))}</dd>
        </div>
      </dl>

      {!compact && gap > 0 && (
        <p className="mt-4 flex items-start gap-2 text-[13px] text-black/60 bg-[#f7f5f2] rounded-lg px-3 py-2.5">
          <Truck size={15} className="mt-[1px] shrink-0 text-brand-green" />
          Add {inr(gap)} more to your order to get free shipping. Otherwise shipping is {inr(SHIPPING_FEE)}.
        </p>
      )}
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

    setSubmitting(true)
    try {
      // Only ids, sizes and quantities leave the browser — the database looks
      // up the real prices and computes the totals.
      const { data, error } = await supabase.rpc('create_order', {
        payload: {
          full_name: f.full_name.trim(),
          email: f.email.trim(),
          phone: f.phone.trim(),
          address: f.address.trim(),
          city: f.city.trim(),
          state: f.state.trim(),
          pincode: f.pincode.trim(),
          note: f.note.trim(),
          payment_method: 'cod',
          items: lines.map((l) => ({ product_id: l.id, size: l.size, qty: l.qty })),
        },
      })
      if (error) throw new Error(error.message)
      if (!data?.reference) throw new Error('The order could not be saved. Please try again.')

      const order = {
        ...data,
        customer: {
          full_name: f.full_name.trim(),
          email: f.email.trim(),
          phone: f.phone.trim(),
          address: f.address.trim(),
          city: f.city.trim(),
          state: f.state.trim(),
          pincode: f.pincode.trim(),
          note: f.note.trim(),
        },
      }
      saveOrder(order)
      clear()
      navigate(`/order/${order.reference}`, { replace: true, state: { order } })
    } catch (err) {
      setFailure(err?.message || 'We could not place your order. Please try again.')
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
        <Link to="/shop" className="inline-block bg-brand-green text-white px-10 py-4 rounded-md mt-8 text-[17px]">Continue shopping</Link>
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
        <form onSubmit={submit} noValidate className="bg-white">
          <Section n="1" title="Contact">
            <Field
              label="Email" name="email" type="email" autoComplete="email"
              placeholder="you@example.com" value={f.email} onChange={on('email')} error={errors.email}
            />
            {!user && (
              <p className="text-[14px] text-black/55 mt-3">
                Already have an account? <Link to="/account" className="underline underline-offset-2 hover:text-black">Sign in</Link> to see your orders later.
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
            <div className="border border-brand-green/40 bg-[#f4f8f5] rounded-xl p-4 flex gap-3">
              <span className="mt-0.5 w-5 h-5 rounded-full border-[6px] border-brand-green bg-white shrink-0" />
              <div>
                <p className="font-semibold text-[16px]">Cash on delivery</p>
                <p className="text-[14px] text-black/65 mt-1">Pay when your order arrives. Please keep exact change ready if you can.</p>
              </div>
            </div>
            <p className="text-[14px] text-black/55 mt-4 flex items-start gap-2">
              <ShieldCheck size={16} className="mt-[1px] shrink-0" />
              Online payment (UPI, cards, net banking) is not connected yet — we will switch it on as soon as the gateway is live.
            </p>
          </Section>

          <button
            type="submit"
            disabled={submitting || !lines.length}
            className="mt-8 w-full h-[56px] rounded-md bg-brand-green text-white text-[17px] font-semibold inline-flex items-center justify-center gap-2 hover:bg-[#12572f] transition disabled:opacity-60"
          >
            {submitting && <Loader2 size={18} className="animate-spin" />}
            {submitting ? 'Placing your order…' : `Place order · ${inr(totalFor(subtotal))}`}
          </button>
          <p className="text-[13px] text-black/50 mt-3 text-center">
            By placing this order you agree to our <Link to="/policies/terms-of-service" className="underline underline-offset-2">terms</Link> and <Link to="/policies/refund-policy" className="underline underline-offset-2">refund policy</Link>.
          </p>
        </form>

        <aside className="lg:sticky lg:top-[120px]">
          <Summary lines={lines} subtotal={subtotal} />
        </aside>
      </div>
    </section>
  )
}
