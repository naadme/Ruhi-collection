import { Link, useSearchParams } from 'react-router-dom'
import ProductGrid, { ResetLink } from '../components/ProductGrid'
import { useProducts } from '../context/ProductsContext'
import usePageTitle from '../hooks/usePageTitle'

const Sel = ({ label, value, onChange, opts }) => (
  <label className="flex items-center gap-2 font-ui text-sm">
    <span className="sr-only sm:not-sr-only">{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="border border-black/40 rounded px-3 h-10 bg-white">
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>
)

// Search across everything a shopper might type: product name, category,
// collection, product id, badge and description.
const matches = (p, query) => {
  const haystack = [p.title, p.type, p.gender, p.id, p.badge || '', p.desc || '']
    .join(' ').toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((t) => haystack.includes(t))
}

export default function Shop() {
  usePageTitle('Shop', 'Browse every Rohi Collection style — shirts, T-shirts and pants for men and women. Filter by category, sort by price and find your fit. Free shipping over ₹999.')
  const { products, loading, error, source } = useProducts()
  const [sp, setSp] = useSearchParams()

  const g = sp.get('gender') || ''
  const t = sp.get('type') || ''
  const q = sp.get('q') || ''
  const sort = sp.get('sort') || ''
  const set = (k) => (v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n) }
  const clearAll = () => setSp(new URLSearchParams(q ? { q } : {}))

  const filtered = products.filter(
    (p) => (!g || p.gender === g) && (!t || p.type === t) && (!q || matches(p, q))
  )
  const items = [...filtered]
  if (sort === 'low') items.sort((a, b) => a.price - b.price)
  if (sort === 'high') items.sort((a, b) => b.price - a.price)
  if (sort === 'rating') items.sort((a, b) => b.rating - a.rating)
  if (sort === 'name') items.sort((a, b) => a.title.localeCompare(b.title))

  const heading = q
    ? `Results for “${q}”`
    : g === 'men' && t ? `${t === 'shirt' ? 'Shirts' : t === 'tshirt' ? 'T-shirts' : 'Pants'} for men`
    : g === 'women' && t ? `${t === 'shirt' ? 'Shirts' : t === 'tshirt' ? 'T-shirts' : 'Pants'} for women`
    : g ? (g === 'men' ? "Men's collection" : "Women's collection")
    : t ? (t === 'shirt' ? 'Shirts' : t === 'tshirt' ? 'T-shirts' : 'Pants')
    : 'Shop all'

  const hasFilters = !!(g || t || q)

  return (
    <section className="max-w-page mx-auto px-4 md:px-7 py-12">
      <h1 className="text-[36px] md:text-[44px] text-center">{heading}</h1>
      <p className="text-center text-black/55 mt-3">{loading ? 'Loading the catalogue…' : `${items.length} ${items.length === 1 ? 'style' : 'styles'}`}</p>

      {error && (
        <div className="max-w-[720px] mx-auto mt-6 border border-amber-200 bg-amber-50 text-amber-900 rounded-xl px-4 py-3 text-[14px] text-center" role="status">
          We couldn't reach the live catalogue, so you're seeing our starter selection. Please refresh in a moment.
        </div>
      )}

      <div className="flex flex-wrap gap-4 justify-between my-8 border-y border-black/10 py-4">
        <div className="flex flex-wrap gap-4">
          <Sel label="Gender" value={g} onChange={set('gender')} opts={[['', 'All'], ['men', 'Men'], ['women', 'Women']]} />
          <Sel label="Type" value={t} onChange={set('type')} opts={[['', 'All'], ['shirt', 'Shirts'], ['tshirt', 'T-shirts'], ['pant', 'Pants']]} />
        </div>
        <div className="flex items-center gap-4">
          <Sel label="Sort" value={sort} onChange={set('sort')} opts={[
            ['', 'Featured'], ['low', 'Price, low to high'], ['high', 'Price, high to low'],
            ['rating', 'Top rated'], ['name', 'Name, A–Z'],
          ]} />
          {hasFilters && <button onClick={clearAll} className="text-sm underline underline-offset-2 hover:text-black">Clear</button>}
        </div>
      </div>

      <ProductGrid
        items={items}
        loading={loading && source !== 'database'}
        empty={{
          title: q ? `Nothing matches “${q}”` : 'No products in this view',
          body: source === 'database'
            ? 'Try a different search, or clear the filters to see everything.'
            : 'The catalogue is still loading — please refresh.',
          action: hasFilters ? <ResetLink to="/shop" label="Show all products" /> : null,
        }}
      />

      {source === 'database' && !loading && !items.length && hasFilters && (
        <p className="text-center mt-4 text-[15px] text-black/50">
          Looking for something else? <Link to="/contact" className="underline underline-offset-2">Tell us what you'd like to stock.</Link>
        </p>
      )}
    </section>
  )
}
