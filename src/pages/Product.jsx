import usePageTitle from '../hooks/usePageTitle'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ChevronLeft, Heart, Truck } from 'lucide-react'
import { useProducts } from '../context/ProductsContext'
import { useCart } from '../context/CartContext'
import { useWishlist } from '../context/WishlistContext'
import Img from '../components/Img'
import QtyControl from '../components/QtyControl'
import ProductCard from '../components/ProductCard'
import { inr, amountToFreeShipping, FREE_SHIPPING_OVER } from '../lib/pricing'
import { MAX_QTY } from '../lib/checkout'

function Gallery({ product }) {
  const shots = [product.image, product.hover].filter(Boolean)
  const [active, setActive] = useState(0)
  if (!shots.length) {
    return <div className="w-full aspect-[3/4] bg-neutral-100 rounded-sm" role="img" aria-label={product.title} />
  }
  const src = shots[Math.min(active, shots.length - 1)]
  return (
    <div>
      <div className="relative w-full aspect-[3/4] bg-neutral-100 overflow-hidden">
        <Img src={src} alt={`${product.title} — view ${active + 1}`} className="w-full h-full object-cover" />
        {product.badge && (
          <span className="absolute top-3 left-3 bg-brand-badge text-white text-[11px] font-bold px-2 py-1 rounded-sm font-ui">{product.badge}</span>
        )}
      </div>
      {shots.length > 1 && (
        <div className="flex gap-2 mt-3">
          {shots.map((s, i) => (
            <button
              key={s}
              onClick={() => setActive(i)}
              aria-label={`Show image ${i + 1} of ${shots.length}`}
              aria-current={active === i}
              className={`w-20 h-24 overflow-hidden border-2 transition ${active === i ? 'border-black' : 'border-transparent opacity-60 hover:opacity-100'}`}
            >
              <Img src={s} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Product() {
  const { id } = useParams()
  const { getProduct, products, loading } = useProducts()
  const p = getProduct(id)
  const navigate = useNavigate()
  const { add, subtotal } = useCart()
  const { has, toggle } = useWishlist()

  const [size, setSize] = useState(null)
  const [qty, setQty] = useState(1)
  const [problem, setProblem] = useState('')

  usePageTitle(p ? p.title : loading ? 'Product' : 'Product not found')

  // Reset the selections whenever the shopper opens a different product.
  useEffect(() => {
    setSize(null); setQty(1); setProblem('')
  }, [id])

  if (!p && loading) {
    return (
      <section className="max-w-[1300px] mx-auto px-4 md:px-7 py-12 animate-pulse" aria-busy="true" aria-label="Loading product">
        <div className="grid md:grid-cols-2 gap-10 lg:gap-16">
          <div className="w-full aspect-[3/4] bg-neutral-200 rounded" />
          <div className="space-y-4 pt-4">
            <div className="h-4 bg-neutral-200 rounded w-1/3" />
            <div className="h-9 bg-neutral-200 rounded w-3/4" />
            <div className="h-6 bg-neutral-200 rounded w-1/4" />
            <div className="h-14 bg-neutral-200 rounded w-full mt-8" />
          </div>
        </div>
      </section>
    )
  }

  if (!p) {
    return (
      <section className="text-center py-32 px-4">
        <h1 className="text-[42px]">Product not found</h1>
        <p className="text-black/60 mt-3 text-[17px]">It may have sold out or been removed from the store.</p>
        <Link to="/shop" className="btn-outline mt-8">Back to catalog</Link>
      </section>
    )
  }

  const fav = has(p.id)
  const off = p.compare ? Math.round((1 - p.price / p.compare) * 100) : 0
  // Measured against the whole basket, not just this line — otherwise a cart
  // that already qualifies for free shipping still gets told to spend more.
  const gap = amountToFreeShipping(subtotal + p.price * qty)
  const needsSize = p.sizes.length > 1 && !size

  const choose = (s) => { setSize(s); setProblem('') }

  const place = (goToCheckout) => {
    if (needsSize) {
      setProblem('Choose a size before adding this item.')
      document.getElementById('size-options')?.focus()
      return
    }
    if (qty < 1 || qty > MAX_QTY) {
      setProblem(`Quantity must be between 1 and ${MAX_QTY}.`)
      return
    }
    add(p.id, qty, size || p.sizes[0])
    if (goToCheckout) navigate('/checkout')
  }

  const rel = products.filter((x) => x.gender === p.gender && x.id !== p.id).slice(0, 4)
  const fallback = products.filter((x) => x.id !== p.id).slice(0, 4)
  const related = rel.length ? rel : fallback

  return (
    <section className="max-w-[1300px] mx-auto px-4 md:px-7 py-8 md:py-12">
      <nav aria-label="Breadcrumb" className="mb-6 text-[14px] text-black/55">
        <Link to="/" className="hover:text-black">Home</Link>
        <span aria-hidden="true" className="mx-2">/</span>
        <Link to={`/shop?gender=${p.gender}`} className="hover:text-black capitalize">{p.gender}</Link>
        <span aria-hidden="true" className="mx-2">/</span>
        <span className="text-black/80">{p.title}</span>
      </nav>

      <div className="grid md:grid-cols-2 gap-10 lg:gap-16">
        <Gallery key={p.id} product={p} />

        <div>
          <p className="text-sm text-black/60 uppercase tracking-widest">{p.gender}'s {p.type.replace('tshirt', 't-shirt')}</p>
          <div className="flex items-start justify-between gap-4 mt-2">
            <h1 className="text-[32px] md:text-[42px] leading-tight">{p.title}</h1>
            <button
              onClick={() => toggle(p.id)}
              aria-label={fav ? 'Remove from wishlist' : 'Add to wishlist'}
              aria-pressed={fav}
              className="shrink-0 w-11 h-11 rounded-full border border-black/20 grid place-items-center hover:border-black transition"
            >
              <Heart size={19} strokeWidth={1.6} fill={fav ? '#C08576' : 'none'} stroke={fav ? '#C08576' : '#4A2C23'} />
            </button>
          </div>

          {/* aria-label lives on a <span> so screen readers hear the rating
              instead of five separate "star" glyphs. */}
          <p className="font-ui mt-3 text-sm text-black/70">
            <span role="img" aria-label={`Rated ${Math.min(p.rating, 5).toFixed(1)} out of 5`}>
              ★ {Math.min(p.rating, 5).toFixed(1)}
            </span>{' '}
            <span className="text-black/50">({p.reviews} reviews)</span>
          </p>

          <p className="font-ui font-bold text-[26px] mt-4 flex gap-4 items-baseline">
            <span className="text-red-600">{inr(p.price)}</span>
            {p.compare && <>
              <s className="text-gray-400 font-normal text-lg">{inr(p.compare)}</s>
              <span className="text-green-700 text-[17px]">{off}% off</span>
            </>}
          </p>
          <p className="text-black/60 text-sm mt-1">Taxes included. {gap > 0 ? `Add ${inr(gap)} for free shipping.` : 'Free shipping on this item.'}</p>

          <fieldset className="mt-7" id="size-options" tabIndex={-1}>
            <legend className="text-sm mb-2">Size {needsSize && <span className="text-red-600">*</span>}</legend>
            <div className="flex flex-wrap gap-3">
              {p.sizes.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => choose(s)}
                  aria-pressed={size === s}
                  className={`h-11 min-w-[52px] px-4 rounded-full font-ui transition ${size === s ? 'bg-black text-white border-black' : 'border border-black/40 hover:border-black'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </fieldset>

          <p className="mt-6 mb-2 text-sm">Quantity</p>
          <QtyControl qty={qty} onChange={(v) => { setQty(Math.min(MAX_QTY, Math.max(1, v))); setProblem('') }} />

          {problem && (
            <p role="alert" className="mt-4 flex items-center gap-2 text-[15px] text-red-700">
              <AlertTriangle size={16} className="shrink-0" /> {problem}
            </p>
          )}

          <button
            onClick={() => place(false)}
            className="block w-full mt-7 h-14 border-2 border-black text-lg hover:bg-black hover:text-white transition"
          >
            Add to cart
          </button>
          <button onClick={() => place(true)} className="block w-full mt-3 h-14 bg-brand-green text-white text-lg hover:bg-[#A86B5C] transition">
            Buy it now
          </button>

          <p className="mt-6 flex items-start gap-2 text-[14px] text-black/60">
            <Truck size={16} className="mt-[1px] shrink-0 text-brand-green" />
            Free shipping on orders over {inr(FREE_SHIPPING_OVER)} · Delivery in 3–7 working days · 30-day returns
          </p>

          {p.desc && <p className="mt-7 text-[18px] leading-8 text-black/70 border-t border-black/10 pt-6">{p.desc}</p>}
        </div>
      </div>

      {related.length > 0 && (
        <>
          <h2 className="text-[30px] mt-20 mb-6">You may also like</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-1 gap-y-6">
            {related.map((x) => <ProductCard key={x.id} product={x} />)}
          </div>
        </>
      )}

      <Link to={`/shop?gender=${p.gender}`} className="inline-flex items-center gap-1.5 mt-12 text-[15px] text-black/60 hover:text-black">
        <ChevronLeft size={16} /> Back to {p.gender}'s collection
      </Link>
    </section>
  )
}
