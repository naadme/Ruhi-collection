import { Link, useLocation, useParams } from 'react-router-dom'
import { Check, Mail, PackageCheck, PhoneCall, Truck } from 'lucide-react'
import usePageTitle from '../hooks/usePageTitle'
import Img from '../components/Img'
import { loadOrder } from '../lib/orderStore'
import { inr, totalFor } from '../lib/pricing'
import { site } from '../data/site'

const STEPS = [
  [PackageCheck, 'We start packing', 'Your order is checked and packed at our studio.'],
  [Truck, 'It ships within 2–3 working days', 'Most orders arrive in 3–7 working days across India.'],
  [PhoneCall, 'Pay on delivery', 'Our delivery partner will call you before arriving.'],
]

export default function OrderConfirmation() {
  const { reference } = useParams()
  const location = useLocation()
  // The order we just placed. Signed-in customers can also find it again from
  // their account page, where it lives permanently in the database.
  const order = location.state?.order || loadOrder(reference)
  usePageTitle(order ? `Order ${order.reference}` : 'Order')

  const subject = encodeURIComponent(`Order ${reference} — Rohi Collection`)
  const body = encodeURIComponent(
    `Hello Rohi Collection,\n\nI'd like to check on order ${reference}.\n\nThank you!`
  )
  const mailHref = `mailto:${site.email}?subject=${subject}&body=${body}`

  if (!order) {
    return (
      <section className="max-w-[720px] mx-auto px-4 py-24 text-center">
        <h1 className="text-[38px]">Order {reference}</h1>
        <p className="text-[17px] text-black/65 mt-4 leading-8">
          We couldn't reopen this order's details on this device. If you placed it,
          it's safely with us — quote the reference above and we'll find it.
        </p>
        <div className="flex flex-wrap gap-3 justify-center mt-8">
          <Link to="/" className="btn-outline">Back to home</Link>
          <Link to="/contact" className="btn-outline">Contact us</Link>
        </div>
      </section>
    )
  }

  const items = order.items || []
  const c = order.customer || {}

  return (
    <section className="max-w-[980px] mx-auto px-4 md:px-7 py-14">
      <div className="text-center">
        <span className="inline-grid place-items-center w-16 h-16 rounded-full bg-brand-green text-white">
          <Check size={32} strokeWidth={2.5} />
        </span>
        <h1 className="text-[38px] md:text-[46px] mt-6">Thank you — your order is in</h1>
        <p className="text-[17px] text-black/65 mt-3">
          Reference <b className="font-ui text-black">{order.reference}</b> ·{' '}
          {new Date(order.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
        <p className="text-[15px] text-black/55 mt-2">Please keep this reference handy if you get in touch.</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mt-10">
        {STEPS.map(([Icon, title, text]) => (
          <div key={title} className="border border-black/10 rounded-xl p-5">
            <Icon size={24} strokeWidth={1.6} className="text-brand-green" />
            <h2 className="text-[17px] font-semibold mt-3">{title}</h2>
            <p className="text-[14px] text-black/60 mt-1.5 leading-6">{text}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-[1.3fr_1fr] gap-6 mt-10 items-start">
        <div className="border border-black/12 rounded-xl bg-white p-5">
          <h2 className="text-[17px] font-semibold">What you ordered</h2>
          <ul className="mt-4 divide-y divide-black/10">
            {items.map((it, i) => (
              <li key={`${it.product_id}-${it.size}-${i}`} className="py-3 flex gap-3">
                <div className="w-14 h-[74px] shrink-0 rounded overflow-hidden bg-neutral-100">
                  <Img src={it.image} alt={it.title} className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link to={`/product/${it.product_id}`} className="text-[15px] leading-snug hover:underline line-clamp-2">{it.title}</Link>
                  <p className="text-[13px] text-black/55 mt-0.5">Size {it.size} · Qty {it.qty}</p>
                </div>
                <p className="font-ui text-[15px] font-semibold shrink-0">{inr(it.unit_price * it.qty)}</p>
              </li>
            ))}
          </ul>
          <dl className="mt-4 pt-4 border-t border-black/10 space-y-2 text-[15px]">
            <div className="flex justify-between"><dt className="text-black/65">Subtotal</dt><dd className="font-ui">{inr(order.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-black/65">Shipping</dt>
              <dd className="font-ui">{order.shipping === 0 ? <span className="text-brand-green font-semibold">Free</span> : inr(order.shipping)}</dd></div>
            <div className="flex justify-between pt-3 border-t border-black/10 text-[18px] font-semibold">
              <dt>Total (cash on delivery)</dt><dd className="font-ui">{inr(order.total ?? totalFor(order.subtotal))}</dd>
            </div>
          </dl>
        </div>

        <div className="space-y-6">
          <div className="border border-black/12 rounded-xl bg-white p-5">
            <h2 className="text-[17px] font-semibold">Delivering to</h2>
            <address className="not-italic text-[15px] leading-7 text-black/70 mt-3">
              <b className="text-black">{c.full_name}</b><br />
              {c.address}<br />
              {c.city}, {c.state} {c.pincode}<br />
              {c.phone}<br />
              {c.email}
            </address>
          </div>
          <div className="border border-black/12 rounded-xl bg-white p-5">
            <h2 className="text-[17px] font-semibold">Need to change something?</h2>
            <p className="text-[14px] text-black/60 mt-2 leading-6">
              Message us as soon as you can and we'll do our best to amend or cancel the order before it ships.
            </p>
            <div className="flex flex-col gap-2.5 mt-4">
              <a href={mailHref} className="inline-flex items-center justify-center gap-2 h-[46px] rounded-lg border border-black/60 text-[15px] hover:bg-black hover:text-white transition">
                <Mail size={16} /> Email us about this order
              </a>
              <Link to="/contact" className="inline-flex items-center justify-center gap-2 h-[46px] rounded-lg border border-black/60 text-[15px] hover:bg-black hover:text-white transition">
                Contact page
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 justify-center mt-12">
        <Link to="/shop" className="bg-brand-green text-white px-10 py-4 rounded-md text-[17px]">Continue shopping</Link>
        <Link to="/account" className="btn-outline">See your orders</Link>
      </div>
    </section>
  )
}
