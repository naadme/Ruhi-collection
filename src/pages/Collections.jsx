import { Link } from 'react-router-dom'
import Img from '../components/Img'
import { collectionTiles } from '../data/products'
import { categoryImage, categoryShopUrl } from '../lib/categoryTiles'
import { useProducts } from '../context/ProductsContext'
import { useCategories } from '../context/CategoriesContext'
import usePageTitle from '../hooks/usePageTitle'

// Tiles are defined once in src/data/products.js; the style counts come from
// the live catalogue so a tile never promises products the store doesn't have.
const countFor = (products, to) => {
  const params = new URLSearchParams(to.split('?')[1] || '')
  const t = params.get('type')
  return products.filter((p) => (!t || p.type === t)).length
}

export default function Collections() {
  usePageTitle('Collections', 'Browse the Ruhi Womens Clothing ranges — tops and shirts, co-ord sets and dresses.')
  const { products, loading } = useProducts()
  // The four launch collections keep their curated copy and photography; a
  // category the client added later gets a tile of its own — its label, a
  // photo from the products it actually holds — so it is reachable here too.
  const { categories } = useCategories()
  const curated = new Set(collectionTiles.map((c) => c.to))
  const extra = categories
    .filter((c) => !curated.has(categoryShopUrl(c.key)))
    .map((c) => ({
      title: c.label,
      text: 'New in this collection',
      image: categoryImage(c, products),
      to: categoryShopUrl(c.key),
    }))
    .filter((c) => c.image)
  // The photo the owner chose for a category wins here too, so a change made
  // in the admin panel is seen on the homepage AND on this page. A category
  // with no chosen photo keeps the curated photograph below.
  const byKey = new Map(categories.map((c) => [c.key, c]))
  const tiles = [
    ...collectionTiles.map((c) => {
      const key = new URLSearchParams(c.to.split('?')[1] || '').get('type')
      const chosen = String(byKey.get(key)?.image ?? '').trim()
      return { ...c, image: chosen || c.image }
    }),
    ...extra,
  ]

  return (
    <section className="max-w-page mx-auto px-4 md:px-7 py-14">
      <h1 className="text-[36px] md:text-[44px] text-center">Collections</h1>
      <p className="text-center text-xl text-black/60 mt-3">Pick a collection to start browsing</p>
      <div className="grid sm:grid-cols-3 gap-4 mt-12">
        {tiles
          .map((c) => ({ c, n: countFor(products, c.to) }))
          // A tile only advertises a collection the store actually stocks, so
          // a newly added (still empty) category never promises a shopper
          // something the shop does not have. The shop's own Type filter and
          // the shop's own Type filter and the header/footer links, generated
          // from the client's own category list, show every category
          // regardless. With an empty catalogue nothing can be judged, so all
          // tiles are shown.
          .filter(({ n }) => n > 0 || products.length === 0)
          .map(({ c, n }) => (
            <Link key={c.title} to={c.to} className="group relative block aspect-[4/3] overflow-hidden bg-neutral-200">
              <Img src={c.image} alt={c.title} loading="eager" sizes="(max-width: 640px) 100vw, 400px" className="absolute inset-0 w-full h-full object-cover object-top transition-transform duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-0 p-6 md:p-8 text-white">
                <h2 className="text-[30px] md:text-[38px]">{c.title}</h2>
                <p className="text-lg text-white/85">{c.text}</p>
                <span className="underline underline-offset-4 mt-3 inline-block">Shop now{loading ? '' : ` · ${n} ${n === 1 ? 'style' : 'styles'}`}</span>
              </div>
            </Link>
          ))}
      </div>
    </section>
  )
}
