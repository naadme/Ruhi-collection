import ProductCard from './ProductCard'
export default function ProductGrid({ items }) {
  if (!items.length) return <p className="text-center py-16 text-black/60">No products found.</p>
  return <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-1 gap-y-6">{items.map((p) => <ProductCard key={p.id} product={p} />)}</div>
}
