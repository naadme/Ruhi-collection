import usePageTitle from '../hooks/usePageTitle'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Heart } from 'lucide-react'
import ProductCard from '../components/ProductCard'
import { useProducts } from '../context/ProductsContext'
import { useWishlist } from '../context/WishlistContext'

export default function Wishlist() {
  usePageTitle('Wishlist')
  const { products, loading, source } = useProducts()
  const { ids } = useWishlist()
  // Wishlist ids that no longer resolve are hidden products or deleted ones —
  // they are simply dropped from this view, never shown as broken cards.
  // Re-resolved only when the catalogue or the saved ids actually change, so a
  // heart tap does not re-scan the whole table for every other reason.
  const items = useMemo(
    () => products.filter((p) => ids.includes(p.id)),
    [products, ids],
  )

  return (
    <section className="max-w-page mx-auto px-4 md:px-7 py-12">
      <h1 className="text-[36px] md:text-[44px] text-center">Your wishlist</h1>
      <p className="text-center text-black/55 mt-3">
        {loading ? 'Loading…' : `${items.length} ${items.length === 1 ? 'item' : 'items'} saved · stored on this device`}
      </p>

      <div className="mt-10">
        {loading && !items.length ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-1 gap-y-6" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-[3/4] bg-neutral-200" />
                <div className="h-4 bg-neutral-200 rounded mt-3 w-5/6" />
              </div>
            ))}
          </div>
        ) : items.length ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-1 gap-y-6">
            {items.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        ) : (
          <div className="text-center py-16 border border-dashed border-black/15 rounded-xl">
            <Heart size={32} className="mx-auto text-black/25" strokeWidth={1.4} />
            <p className="text-[21px] mt-4">
              {ids.length && source !== 'database'
                ? 'Your saved items are unavailable right now.'
                : 'Nothing saved yet'}
            </p>
            <p className="text-black/55 mt-2 text-[15px]">
              Tap the heart on any product to keep it here for later.
            </p>
            <Link to="/shop" className="inline-block mt-6 btn-outline">Browse the shop</Link>
          </div>
        )}
      </div>
    </section>
  )
}
