import { useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { useCart } from '../context/CartContext'
import useOverlay from '../hooks/useOverlay'
import { amountToFreeShipping, inr, totalFor } from '../lib/pricing'
import Img from './Img'
import QtyControl from './QtyControl'
export default function CartDrawer() {
  const { open, setOpen, lines, subtotal, setQty, remove } = useCart()
  const gap = amountToFreeShipping(subtotal)
  const panel = useRef(null)
  const close = useCallback(() => setOpen(false), [setOpen])
  useOverlay(open, close, panel)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={close}>
      <aside ref={panel} role="dialog" aria-modal="true" aria-label="Your cart" tabIndex={-1} className="absolute right-0 top-0 h-full w-full max-w-[440px] bg-white flex flex-col outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center p-6 border-b"><h2 className="text-2xl">Your cart</h2><button onClick={close} aria-label="Close cart"><X /></button></div>
        {!lines.length ? (
          <div className="flex-1 grid place-items-center text-center p-6"><div><p className="text-3xl mb-6">Your cart is empty</p>
            {/* Close + land on the shop even when we are already on /shop, where a bare Link is a no-op. */}
            <Link to="/shop" onClick={() => { close(); window.scrollTo(0, 0) }} className="inline-block bg-[#8A6556] text-white px-10 py-4 rounded-lg">Continue shopping</Link></div></div>
        ) : (<>
          <ul className="flex-1 overflow-auto p-6 space-y-6">{lines.map((l) => (
            <li key={l.id + l.size} className="flex gap-4"><Img src={l.product.image} alt={l.product.title} className="w-20 h-24 object-cover" />
              <div className="flex-1"><p className="leading-tight">{l.product.title}</p><p className="text-sm text-black/60">Size: {l.size}</p><p className="font-ui font-semibold text-red-600">{inr(l.product.price)}</p>
                <div className="flex items-center gap-4 mt-2"><QtyControl qty={l.qty} onChange={(q) => setQty(l.id, l.size, q)} small /><button onClick={() => remove(l.id, l.size)} className="text-sm underline">Remove</button></div></div></li>))}</ul>
          <div className="p-6 border-t">
            {gap > 0 && <p className="text-[13px] text-black/60 mb-3">Add {inr(gap)} more for free shipping.</p>}
            <div className="flex justify-between text-xl mb-4"><span>Total</span><span className="font-ui font-semibold">{inr(totalFor(subtotal))}</span></div>
            <Link to="/cart" onClick={close} className="block text-center border border-black/60 py-3.5 rounded-lg hover:bg-black hover:text-white transition">View cart</Link>
            <Link to="/checkout" onClick={close} className="block text-center bg-brand-green text-white py-4 rounded-lg mt-3">Check out</Link>
          </div>
        </>)}
      </aside>
    </div>
  )
}
