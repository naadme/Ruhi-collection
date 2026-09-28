import { Link } from 'react-router-dom'
import { Star, Heart } from 'lucide-react'
import Img from './Img'
import { useWishlist } from '../context/WishlistContext'
export default function ProductCard({ product: p }) {
  const { has, toggle } = useWishlist(); const fav = has(p.id)
  const off = p.compare ? Math.round((1 - p.price / p.compare) * 100) : 0
  return (
    <div className="group relative">
      <Link to={`/product/${p.id}`} className="block">
        <div className="relative aspect-[3/4] overflow-hidden bg-neutral-100">
          <Img src={p.image} alt={p.title} className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500 group-hover:opacity-0" />
          <Img src={p.hover} alt="" className="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
          {p.badge && <span className="absolute top-2 left-1 bg-brand-badge text-white text-[10px] font-bold px-1.5 py-[3px] rounded-sm font-ui">{p.badge}</span>}
          <span className="absolute bottom-2 left-2 bg-white/90 rounded-md px-2 py-0.5 text-[11px] flex items-center gap-1 font-ui"><Star size={11} fill="#facc15" stroke="#facc15" />{p.rating.toFixed(1)} ({p.reviews})</span>
        </div>
        <h3 className="text-[19px] md:text-[21px] leading-snug mt-2 pr-1 group-hover:underline underline-offset-2">{p.title}</h3>
        <p className="font-ui font-bold text-[17px] flex gap-3 items-baseline"><span className="text-red-600">₹{p.price}</span>
          {p.compare && <><s className="text-gray-400 font-normal">₹{p.compare}</s><span className="text-green-600">{off}% off</span></>}</p>
      </Link>
      <button onClick={() => toggle(p.id)} aria-label={fav ? 'Remove from wishlist' : 'Add to wishlist'} aria-pressed={fav} className="absolute top-2 right-2 w-9 h-9 rounded-full bg-white/90 grid place-items-center hover:scale-105 transition">
        <Heart size={18} strokeWidth={1.6} fill={fav ? '#dc2626' : 'none'} stroke={fav ? '#dc2626' : '#111'} /></button>
    </div>
  )
}
