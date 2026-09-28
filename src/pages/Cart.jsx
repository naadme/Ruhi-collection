import usePageTitle from '../hooks/usePageTitle'
import { Link } from 'react-router-dom'
import { useCart } from '../context/CartContext'
import Img from '../components/Img'
import QtyControl from '../components/QtyControl'
export default function Cart() {
  usePageTitle('Cart')
  const { lines, total, setQty, remove, setOpen } = useCart()
  if (!lines.length) return (
    <section className="text-center py-24 px-4"><h1 className="text-[48px] md:text-[64px]">Your cart is empty</h1>
      <Link to="/shop" onClick={() => { setOpen(false); window.scrollTo(0, 0) }} className="inline-block bg-[#7a6f68] text-white px-12 py-5 rounded-md mt-10 text-lg">Continue shopping</Link>
      <h2 className="text-[38px] mt-24">Have an account?</h2><p className="text-xl mt-4"><Link to="/account" className="underline text-black/60">Log in</Link> to check out faster.</p></section>)
  return (
    <section className="max-w-[1100px] mx-auto px-4 py-14"><h1 className="text-[40px] mb-8">Your cart</h1>
      <ul className="divide-y">{lines.map((l) => (
        <li key={l.id + l.size} className="py-6 flex gap-6 items-center flex-wrap"><Img src={l.product.image} alt="" className="w-24 h-32 object-cover" />
          <div className="flex-1 min-w-[200px]"><Link to={`/product/${l.id}`} className="text-xl hover:underline">{l.product.title}</Link><p className="text-black/60">Size: {l.size}</p><p className="font-ui text-red-600 font-semibold">₹{l.product.price}</p></div>
          <QtyControl qty={l.qty} onChange={(q) => setQty(l.id, l.size, q)} /><p className="font-ui font-semibold w-24 text-right">₹{l.qty * l.product.price}</p>
          <button onClick={() => remove(l.id, l.size)} className="underline text-sm">Remove</button></li>))}</ul>
      <div className="text-right mt-8"><p className="text-2xl">Estimated total <b className="font-ui">₹{total}</b></p><p className="text-black/60 mt-1">Taxes and shipping included.</p>
        <button onClick={() => alert('Online checkout is coming soon. Please contact us to place your order.')} className="bg-brand-green text-white px-16 h-14 mt-6 rounded-md text-lg">Check out</button></div></section>)
}
