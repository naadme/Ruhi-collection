import usePageTitle from '../hooks/usePageTitle'
import { Link } from 'react-router-dom'
import { AlertTriangle, Lock } from 'lucide-react'
import { useCart } from '../context/CartContext'
import Img from '../components/Img'
import QtyControl from '../components/QtyControl'
import { inr, shippingFor, totalFor } from '../lib/pricing'

export default function Cart() {
  usePageTitle('Cart')
  const { lines, unavailable, prune, subtotal, setQty, remove, setOpen, clear } = useCart()
  const shipping = shippingFor()

  if (!lines.length) return (
    <section className="text-center py-24 px-4">
      <h1 className="text-[48px] md:text-[64px]">Your cart is empty</h1>
      <Link to="/shop" onClick={() => { setOpen(false); window.scrollTo(0, 0) }} className="inline-block bg-[#8A6556] text-white px-12 py-5 rounded-lg mt-10 text-lg">Continue shopping</Link>
      <h2 className="text-[38px] mt-24">Have an account?</h2>
      <p className="text-xl mt-4"><Link to="/account" className="underline text-black/60">Log in</Link> to check out faster.</p>
    </section>
  )

  return (
    <section className="max-w-[1100px] mx-auto px-4 py-14">
      <h1 className="text-[40px] mb-8">Your cart</h1>

      {unavailable > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-3 border border-amber-300 bg-amber-50 text-amber-900 rounded-xl px-4 py-3.5 text-[15px]">
          <AlertTriangle size={18} className="shrink-0" />
          <span className="flex-1 min-w-[200px]">
            {unavailable} {unavailable === 1 ? 'item is' : 'items are'} no longer available and {unavailable === 1 ? "can't" : "can't"} be ordered.
          </span>
          <button onClick={prune} className="underline underline-offset-2 font-medium">Remove {unavailable === 1 ? 'it' : 'them'}</button>
        </div>
      )}

      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-8 lg:gap-12 items-start">
        <ul className="divide-y border-t border-black/10">
          {lines.map((l) => (
            <li key={l.id + l.size} className="py-6 flex gap-5 items-center flex-wrap">
              <Img src={l.product.image} alt={l.product.title} className="w-24 h-32 object-cover" />
              <div className="flex-1 min-w-[180px]">
                <Link to={`/product/${l.id}`} className="text-xl hover:underline">{l.product.title}</Link>
                <p className="text-black/60">Size: {l.size}</p>
                <p className="font-ui text-red-600 font-semibold">{inr(l.product.price)}</p>
                <button onClick={() => remove(l.id, l.size)} className="underline text-sm mt-3 hover:text-black">Remove</button>
              </div>
              <div className="flex flex-col items-end gap-3">
                <QtyControl qty={l.qty} onChange={(q) => setQty(l.id, l.size, q)} />
                <p className="font-ui font-semibold w-24 text-right">{inr(l.qty * l.product.price)}</p>
              </div>
            </li>
          ))}
        </ul>

        <aside className="border border-black/10 rounded-xl p-5 lg:sticky lg:top-[130px]">
          <h2 className="text-[18px] font-semibold font-ui">Order summary</h2>
          <dl className="mt-4 space-y-2 text-[16px]">
            <div className="flex justify-between"><dt className="text-black/65">Subtotal</dt><dd className="font-ui">{inr(subtotal)}</dd></div>
            <div className="flex justify-between">
              <dt className="text-black/65">Shipping</dt>
              <dd className="font-ui">{shipping === 0 ? <span className="text-brand-green font-semibold">Free</span> : inr(shipping)}</dd>
            </div>
            <div className="flex justify-between pt-3 border-t border-black/10 text-[20px] font-semibold">
              <dt>Total</dt><dd className="font-ui">{inr(totalFor(subtotal))}</dd>
            </div>
          </dl>

          <Link
            to="/checkout"
            className="mt-5 w-full h-[54px] rounded-lg bg-brand-green text-white text-[17px] font-semibold grid place-items-center hover:bg-[#A86B5C] transition"
          >
            Proceed to checkout
          </Link>
          <p className="text-[13px] text-black/50 mt-3 flex items-center justify-center gap-1.5">
            <Lock size={13} /> Secure checkout
          </p>
          <button onClick={clear} className="w-full mt-3 text-[14px] text-black/50 hover:text-black underline underline-offset-2">Empty the cart</button>
        </aside>
      </div>
    </section>
  )
}
