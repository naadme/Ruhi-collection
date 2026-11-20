import { Link } from 'react-router-dom'
import ProductCard from './ProductCard'
import { useProducts } from '../context/ProductsContext'
import { useCategories } from '../context/CategoriesContext'
import { derivedBestsellers } from '../lib/bestsellerRules'

// A link to a style we stopped selling (hidden in the admin) or a mistyped
// one (20 Nov 2026). It used to end at "Product not found" with one button;
// now it offers a way on: live colours of the same design first — their
// address starts the same way — then best sellers in stock. Hidden rows stay
// unreadable to shoppers, as before; nothing here opens another product in
// the missing one's place. Loaded on demand (src/lib/soldOutParts.js).

// The design part of a product address ("solid-shirt-and-pant-combo" of
// "solid-shirt-and-pant-combo-dark-navy-blue"), as the admin builds ids
// (src/lib/productForm.js `slug`).
const slugOf = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export default function NoLongerAvailable({ id }) {
  const { listable } = useProducts()
  const { categories } = useCategories()
  const wanted = String(id || '').toLowerCase()
  const same = listable.filter((x) => {
    const design = slugOf(x.title)
    return design && wanted.startsWith(`${design}-`)
  })
  const seen = new Set()
  const offer = [...same, ...derivedBestsellers(listable, categories.map((c) => c.key))]
    .filter((x) => x?.id && !seen.has(x.id) && seen.add(x.id))
    .slice(0, 4)
  return (
    <section className="max-w-[1300px] mx-auto px-4 md:px-7 py-16">
      <div className="text-center">
        <h1 className="text-[34px] md:text-[42px]">This style is no longer available</h1>
        <p className="text-black/60 mt-3 text-[17px]">{same.length ? 'The same style in other colours, and more in stock now.' : "Here's what's in stock now."}</p>
      </div>
      {offer.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-1 gap-y-6 mt-10">
          {offer.map((x) => <ProductCard key={x.id} product={x} />)}
        </div>
      )}
      <div className="text-center mt-10">
        <Link to="/shop" className="btn-outline">Shop everything</Link>
      </div>
    </section>
  )
}
