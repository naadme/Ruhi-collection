import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import Img from './Img'
import { useProducts } from '../context/ProductsContext'
import { useCategories } from '../context/CategoriesContext'
import { matchesProduct, searchPath } from '../lib/productSearch'
import { productHref } from '../lib/productLinks'
import { inr } from '../lib/pricing'

export default function SearchBar({ onClose }) {
  const { products, loading } = useProducts()
  // Search matches the live category label too, so a category the client
  // renamed is found under its new name.
  const { typeLabel } = useCategories()
  const [q, setQ] = useState('')
  const ref = useRef(); const nav = useNavigate()
  // The current address, so a new search can keep the sort and drop the
  // category filter it would narrow.
  const [sp] = useSearchParams()
  useEffect(() => ref.current?.focus(), [])

  const term = q.trim()
  // Same matching rule as the results page (src/lib/productSearch.js), so the
  // header and the shop can never disagree about what a word finds. The live
  // list is taken from the WHOLE catalogue: a search never looks at one
  // category or one size only. A product with no id has no page of its own,
  // so it is never offered as a result.
  const res = term
    ? products.filter((p) => p.id && matchesProduct(p, term, typeLabel)).slice(0, 6)
    : []

  // A submitted search goes to the shop page on its own: the category filter
  // is left behind (a search covers every category) and the sort is kept
  // (sorting never hides a result).
  const go = (e) => { e?.preventDefault?.(); nav(searchPath(term, { sort: sp.get('sort') })); onClose() }

  return (
    <div className="absolute inset-x-0 top-full bg-[#FAF0E7] border-b border-black/10 pb-4 shadow">
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
              <Link to={productHref(p)} onClick={onClose} className="flex items-center gap-4 py-2 hover:bg-black/5">
                <Img src={p.image} alt={p.title} className="w-12 h-14 object-cover" />
                <span className="flex-1">{p.title}</span>
                <span className="font-ui font-semibold">{p.price > 0 ? inr(p.price) : ''}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {term && !res.length && !loading && (
        <p className="max-w-[1000px] mx-auto px-4 mt-4 text-black/60">
          No results for “{q.trim()}”. Try “shirt”, “dress” or a product name.
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
