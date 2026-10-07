import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ProductGrid, { ResetLink } from '../components/ProductGrid'
import { useProducts } from '../context/ProductsContext'
import { TYPES, typeLabel } from '../data/products'
import usePageTitle from '../hooks/usePageTitle'

const Sel = ({ label, value, onChange, opts }) => (
  <label className="flex items-center gap-3 font-ui text-sm">
    <span className="sr-only sm:not-sr-only">{label}</span>
    {/* `pr-4` gives the native arrow a slot of its own so it sits centred
        in that slot and can never run into the option text. */}
    <select value={value} onChange={(e) => onChange(e.target.value)} className="border border-black/40 rounded-lg pl-3 pr-4 h-10 bg-white">
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>
)

// Search across everything a shopper might type: product name, category,
// collection, product id, badge, description and — for a grouped design —
// any of the colours it comes in.
const matches = (p, query) => {
  const haystack = [p.title, typeLabel(p.type), p.type, p.id, p.badge || '', p.desc || '',
    ...(p.colors || []).map((c) => c.color)]
    .join(' ').toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((t) => haystack.includes(t))
}

export default function Shop() {
  usePageTitle('Shop', 'Browse every Ruhi Womens Clothing style — co-ord sets, dresses, tops and shirts. Filter by category, sort by price and find your fit. Free shipping for all products.')
  const { products, loading, error, source } = useProducts()
  const [sp, setSp] = useSearchParams()

  const t = sp.get('type') || ''
  const q = sp.get('q') || ''
  const sort = sp.get('sort') || ''
  const set = (k) => (v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n) }
  const clearAll = () => setSp(new URLSearchParams(q ? { q } : {}))

  // Filter + sort only when the catalogue or the filter/sort inputs change —
  // not on every unrelated render of this page.
  const filtered = useMemo(
    () => products.filter((p) => (!t || p.type === t) && (!q || matches(p, q))),
    [products, t, q],
  )
  const items = useMemo(() => {
    const sorted = [...filtered]
    if (sort === 'low') sorted.sort((a, b) => a.price - b.price)
    if (sort === 'high') sorted.sort((a, b) => b.price - a.price)
    if (sort === 'rating') sorted.sort((a, b) => b.rating - a.rating)
    if (sort === 'name') sorted.sort((a, b) => a.title.localeCompare(b.title))
    return sorted
  }, [filtered, sort])

  const heading = q
    ? `Results for “${q}”`
    : t ? typeLabel(t)
    : 'Shop all'

  const hasFilters = !!(t || q)
  // "Clear" has to be on screen whenever anything at all is filtered *or*
  // sorted — a sort on its own used to hide it even though Clear resets it.
  const showClear = !!(t || q || sort)

  return (
    <section className="max-w-page mx-auto px-4 md:px-7 py-12">
      <h1 className="text-[36px] md:text-[44px] text-center">{heading}</h1>
      <p className="text-center text-black/55 mt-3">{loading ? 'Loading the catalogue…' : `${items.length} ${items.length === 1 ? 'style' : 'styles'}`}</p>

      {error && (
        <div className="max-w-[720px] mx-auto mt-6 border border-amber-200 bg-amber-50 text-amber-900 rounded-xl px-4 py-3 text-[14px] text-center" role="status">
          We couldn't reach the live catalogue, so you're seeing our starter selection. Please refresh in a moment.
        </div>
      )}

      {/* Type, Sort and Clear form one filter group on the left of the bar.
          `flex-wrap` means the group wraps as a unit on narrow screens
          instead of ever being pushed out of view. */}
      <div className="flex flex-wrap items-center gap-4 my-8 border-y border-black/10 py-4">
        <Sel label="Type" value={t} onChange={set('type')} opts={[['', 'All'], ...TYPES.map((x) => [x.key, x.label])]} />
        <Sel label="Sort" value={sort} onChange={set('sort')} opts={[
          ['', 'Featured'], ['low', 'Price, low to high'], ['high', 'Price, high to low'],
          ['rating', 'Top rated'], ['name', 'Name, A–Z'],
        ]} />
        {showClear && (
          <button onClick={clearAll} className="text-sm underline underline-offset-2 hover:text-black">
            Clear
          </button>
        )}
      </div>

      <ProductGrid
        items={items}
        loading={loading && source !== 'database'}
        empty={{
          title: q ? `Nothing matches “${q}”` : 'No products in this view',
          body: !loading
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
