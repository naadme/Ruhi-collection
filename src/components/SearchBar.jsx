import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import Img from './Img'
import { useProducts } from '../context/ProductsContext'
import { inr } from '../lib/pricing'

export default function SearchBar({ onClose }) {
  const { products, loading } = useProducts()
  const [q, setQ] = useState('')
  const ref = useRef(); const nav = useNavigate()
  useEffect(() => ref.current?.focus(), [])

  const term = q.trim().toLowerCase()
  // Same matching rules as the results page: name, category, collection, id and description.
  const res = term
    ? products.filter((p) =>
        [p.title, p.type, p.gender, p.id, p.badge || '', p.desc || '']
          .join(' ').toLowerCase().includes(term)
      ).slice(0, 6)
    : []

  const go = (e) => { e.preventDefault(); nav(`/shop?q=${encodeURIComponent(term)}`); onClose() }

  return (
    <div className="absolute inset-x-0 top-full bg-white border-b border-black/10 pb-4 shadow">
      <form onSubmit={go} role="search" className="flex items-center gap-6 max-w-[1000px] mx-auto px-4 pt-6">
        <div className="relative flex-1 border-2 border-black/70 rounded-md h-[64px]">
          <label htmlFor="site-search" className="absolute left-4 top-1 text-xs text-black/70">Search</label>
          <input
            id="site-search" ref={ref} value={q} onChange={(e) => setQ(e.target.value)}
            autoComplete="off" className="w-full h-full pt-5 px-4 bg-transparent outline-none"
          />
          <button className="absolute right-4 top-5" aria-label="Search"><Search size={20} strokeWidth={1.4} /></button>
        </div>
        <button type="button" onClick={onClose} aria-label="Close search"><X size={28} strokeWidth={1.2} /></button>
      </form>

      {term && loading && !res.length && (
        <p className="max-w-[1000px] mx-auto px-4 mt-4 text-black/60">Loading products…</p>
      )}

      {res.length > 0 && (
        <ul className="max-w-[1000px] mx-auto px-4 mt-3">
          {res.map((p) => (
            <li key={p.id}>
              <Link to={`/product/${p.id}`} onClick={onClose} className="flex items-center gap-4 py-2 hover:bg-black/5">
                <Img src={p.image} alt={p.title} className="w-12 h-14 object-cover" />
                <span className="flex-1">{p.title}</span>
                <span className="font-ui font-semibold">{inr(p.price)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {term && !res.length && !loading && (
        <p className="max-w-[1000px] mx-auto px-4 mt-4 text-black/60">
          No results for “{q.trim()}”. Try “shirt”, “pants” or a product name.
        </p>
      )}

      {term && res.length > 0 && (
        <div className="max-w-[1000px] mx-auto px-4 mt-3">
          <button type="button" onClick={go} className="text-[15px] underline underline-offset-2">
            See all results for “{q.trim()}”
          </button>
        </div>
      )}
    </div>
  )
}
