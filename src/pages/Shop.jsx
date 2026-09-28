import { useSearchParams } from 'react-router-dom'
import ProductGrid from '../components/ProductGrid'
import { products } from '../data/products'
import usePageTitle from '../hooks/usePageTitle'
const Sel = ({ label, value, onChange, opts }) => (
  <label className="flex items-center gap-2 font-ui text-sm">{label}<select value={value} onChange={(e) => onChange(e.target.value)} className="border border-black/40 rounded px-3 h-10 bg-white">{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>)
export default function Shop() {
  usePageTitle('Shop')
  const [sp, setSp] = useSearchParams()
  const g = sp.get('gender') || '', t = sp.get('type') || '', q = sp.get('q') || '', sort = sp.get('sort') || ''
  const set = (k) => (v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n) }
  let items = products.filter((p) => (!g || p.gender === g) && (!t || p.type === t) && (!q || p.title.toLowerCase().includes(q.toLowerCase())))
  if (sort === 'low') items = [...items].sort((a, b) => a.price - b.price)
  if (sort === 'high') items = [...items].sort((a, b) => b.price - a.price)
  return (
    <section className="max-w-page mx-auto px-4 md:px-7 py-12">
      <h1 className="text-[36px] md:text-[44px] text-center">{q ? `Results for “${q}”` : 'Shop all'}</h1>
      <div className="flex flex-wrap gap-4 justify-between my-8 border-y border-black/10 py-4">
        <div className="flex flex-wrap gap-4"><Sel label="Gender" value={g} onChange={set('gender')} opts={[['', 'All'], ['men', 'Men'], ['women', 'Women']]} />
          <Sel label="Type" value={t} onChange={set('type')} opts={[['', 'All'], ['shirt', 'Shirts'], ['tshirt', 'T-shirts'], ['pant', 'Pants']]} /></div>
        <div className="flex items-center gap-4"><Sel label="Sort by" value={sort} onChange={set('sort')} opts={[['', 'Featured'], ['low', 'Price, low to high'], ['high', 'Price, high to low']]} /><span className="text-sm text-black/60">{items.length} products</span></div>
      </div>
      <ProductGrid items={items} />
    </section>
  )
}
