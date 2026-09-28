import { Link } from 'react-router-dom'
import ProductCard from './ProductCard'

function Skeleton() {
  return (
    <div className="animate-pulse">
      <div className="aspect-[3/4] bg-neutral-200" />
      <div className="h-4 bg-neutral-200 rounded mt-3 w-5/6" />
      <div className="h-4 bg-neutral-200 rounded mt-2 w-1/3" />
    </div>
  )
}

export default function ProductGrid({ items, loading, empty }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-1 gap-y-6" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <Skeleton key={i} />)}
      </div>
    )
  }
  if (!items.length) {
    return (
      <div className="text-center py-16 border border-dashed border-black/15 rounded-xl">
        <p className="text-[21px]">{empty?.title || 'No products found.'}</p>
        <p className="text-black/55 mt-2 text-[15px]">{empty?.body || 'Try a different search or filter.'}</p>
        {empty?.action}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-1 gap-y-6">
      {items.map((p) => <ProductCard key={p.id} product={p} />)}
    </div>
  )
}

/** Plain "back to everything" link used by the empty states above. */
export const ResetLink = ({ to, label }) => (
  <Link to={to} className="inline-block mt-5 btn-outline">{label}</Link>
)
