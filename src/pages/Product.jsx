import usePageTitle from '../hooks/usePageTitle'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getProduct, products } from '../data/products'
import { useCart } from '../context/CartContext'
import Img from '../components/Img'
import QtyControl from '../components/QtyControl'
import ProductCard from '../components/ProductCard'
export default function Product() {
  
  const { id } = useParams(); const p = getProduct(id)
  usePageTitle(p ? p.title : 'Product not found')
  const [size, setSize] = useState('M'); const [qty, setQty] = useState(1); const { add } = useCart()
  if (!p) return <div className="text-center py-32"><h1 className="text-4xl mb-6">Product not found</h1><Link to="/shop" className="btn-outline">Back to catalog</Link></div>
  const rel = products.filter((x) => x.gender === p.gender && x.id !== p.id).slice(0, 4)
  return (
    <section className="max-w-[1300px] mx-auto px-4 md:px-7 py-12">
      <div className="grid md:grid-cols-2 gap-10 lg:gap-16">
        <Img src={p.image} alt={p.title} className="w-full aspect-[3/4] object-cover bg-neutral-100" />
        <div>
          <p className="text-sm text-black/60 uppercase tracking-widest">{p.gender}'s {p.type}</p>
          <h1 className="text-[32px] md:text-[42px] leading-tight mt-2">{p.title}</h1>
          <p className="font-ui mt-2 text-sm">★ {p.rating.toFixed(1)} ({p.reviews} reviews)</p>
          <p className="font-ui font-bold text-[26px] mt-4 flex gap-4 items-baseline"><span className="text-red-600">₹{p.price}</span>{p.compare && <s className="text-gray-400 font-normal text-lg">₹{p.compare}</s>}</p>
          <p className="text-black/60 text-sm mt-1">Taxes included. Free shipping.</p>
          <p className="mt-6 mb-2 text-sm">Size</p>
          <div className="flex gap-3">{p.sizes.map((s) => <button key={s} onClick={() => setSize(s)} className={`h-11 min-w-[52px] px-4 rounded-full border font-ui ${size === s ? 'bg-black text-white border-black' : 'border-black/40'}`}>{s}</button>)}</div>
          <p className="mt-6 mb-2 text-sm">Quantity</p><QtyControl qty={qty} onChange={setQty} />
          <button onClick={() => add(p.id, qty, size)} className="block w-full mt-8 h-14 border-2 border-black text-lg hover:bg-black hover:text-white transition">Add to cart</button>
          <button onClick={() => add(p.id, qty, size)} className="block w-full mt-3 h-14 bg-brand-green text-white text-lg">Buy it now</button>
          <p className="mt-8 text-[18px] leading-8 text-black/70">{p.desc}</p>
        </div>
      </div>
      <h2 className="text-[30px] mt-20 mb-6">You may also like</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-1">{rel.map((x) => <ProductCard key={x.id} product={x} />)}</div>
    </section>
  )
}
