import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { useCart } from '../context/CartContext'
import Img from './Img'
import QtyControl from './QtyControl'
export default function CartDrawer() {
  const { open, setOpen, lines, total, setQty, remove } = useCart()
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setOpen(false)}>
      <aside className="absolute right-0 top-0 h-full w-full max-w-[440px] bg-white flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center p-6 border-b"><h2 className="text-2xl">Your cart</h2><button onClick={() => setOpen(false)} aria-label="Close"><X /></button></div>
        {!lines.length ? (
          <div className="flex-1 grid place-items-center text-center p-6"><div><p className="text-3xl mb-6">Your cart is empty</p><Link to="/shop" onClick={() => setOpen(false)} className="inline-block bg-[#7a6f68] text-white px-10 py-4 rounded-md">Continue shopping</Link></div></div>
        ) : (<>
          <ul className="flex-1 overflow-auto p-6 space-y-6">{lines.map((l) => (
            <li key={l.id + l.size} className="flex gap-4"><Img src={l.product.image} alt="" className="w-20 h-24 object-cover" />
              <div className="flex-1"><p className="leading-tight">{l.product.title}</p><p className="text-sm text-black/60">Size: {l.size}</p><p className="font-ui font-semibold text-red-600">₹{l.product.price}</p>
                <div className="flex items-center gap-4 mt-2"><QtyControl qty={l.qty} onChange={(q) => setQty(l.id, l.size, q)} small /><button onClick={() => remove(l.id, l.size)} className="text-sm underline">Remove</button></div></div></li>))}</ul>
          <div className="p-6 border-t"><div className="flex justify-between text-xl mb-4"><span>Estimated total</span><span className="font-ui font-semibold">₹{total}</span></div>
            <Link to="/cart" onClick={() => setOpen(false)} className="block text-center bg-brand-green text-white py-4 rounded-md">View cart & check out</Link></div>
        </>)}
      </aside>
    </div>
  )
}
