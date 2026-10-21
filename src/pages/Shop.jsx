import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ProductGrid, { ResetLink } from '../components/ProductGrid'
import { useProducts } from '../context/ProductsContext'
import { useCategories } from '../context/CategoriesContext'
import { matchesProducts } from '../lib/productSearch'
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

export default function Shop() {
  usePageTitle('Shop', 'Browse every Ruhi Womens Clothing style — co-ord sets, dresses, tops and shirts. Filter by category, sort by price and find your fit. Free shipping for all products.')
  const { products, loading, error, source } = useProducts()
  // The Type filter is the client's own category list, so a category added in
  // the dashboard is filterable here the moment it is saved.
  const { optionsFor, typeLabel } = useCategories()
  const [sp, setSp] = useSearchParams()

  const t = sp.get('type') || ''
  const q = sp.get('q') || ''
  const sort = sp.get('sort') || ''
  const set = (k) => (v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n) }
  // "Clear" empties the whole bar — the search, the category and the sort —
  // and shows the catalogue again. It used to keep the search, which left a
  // button on screen that changed nothing.
  const clearAll = () => setSp(new URLSearchParams())

  // A search and a category are two different ways of looking at the shop.
  //
  // While a search is running it covers the WHOLE catalogue — every category,
  // every size — because a shopper who typed "red" wants every red product,
  // not the red ones inside the category the page was already showing. The
  // category filter is therefore not applied while searching, and the Type
  // box says so by showing "All".
  const searching = q.trim().length > 0

  // Picking a category while a search is running means "browse this
  // category", so the search is dropped rather than silently ignored.
  const setType = (v) => {
    const n = new URLSearchParams(sp)
    n.delete('q')
    v ? n.set('type', v) : n.delete('type')
    setSp(n)
  }

  // Filter + sort only when the catalogue or the filter/sort inputs change —
  // not on every unrelated render of this page.
  const filtered = useMemo(
    // The rule itself lives in src/lib/productSearch.js (matchesProducts, and
    // the matchesProduct rule it is built on), so the header search and this
    // page can never disagree about what a word matches.
    () => matchesProducts(products, { q, type: t, typeLabel }),
    [products, q, t, typeLabel],
  )
  const items = useMemo(() => {
    const sorted = [...filtered]
    if (sort === 'low') sorted.sort((a, b) => a.price - b.price)
    if (sort === 'high') sorted.sort((a, b) => b.price - a.price)
    if (sort === 'rating') sorted.sort((a, b) => b.rating - a.rating)
    if (sort === 'name') sorted.sort((a, b) => a.title.localeCompare(b.title))
    return sorted
  }, [filtered, sort])

  // Unfiltered catalogue reads "All Products"; a category or search still
  // names itself, so only the default label changed.
  const heading = searching
    ? `Results for “${q.trim()}”`
    : t ? typeLabel(t)
    : 'All Products'

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
        <Sel label="Type" value={searching ? '' : t} onChange={setType} opts={[['', 'All'], ...optionsFor(t).map((x) => [x.key, x.label])]} />
        <Sel label="Sort" value={sort} onChange={set('sort')} opts={[
          ['', 'Featured'], ['low', 'Price, low to high'], ['high', 'Price, high to low'],
          ['rating', 'Top rated'], ['name', 'Name, A–Z'],
        ]} />
        {showClear && (
          <button onClick={clearAll} className="text-sm underline underline-offset-2 hover:text-black">
            Clear
          </button>
        )}
        {/* The search covers the whole catalogue, so the category filter is off
            while it runs. Saying so keeps the page honest: the Type box reads
            "All" because every category is being searched. */}
        {searching && (
          <p className="w-full text-[14px] text-black/55">
            Searching every category and every size — the Type filter is off while a search is running.
          </p>
        )}
      </div>

      <ProductGrid
        items={items}
        loading={loading && source !== 'database'}
        empty={{
          title: searching ? `Nothing matches “${q.trim()}”` : 'No products in this view',
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
