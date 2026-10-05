import { Link } from 'react-router-dom'
import Img from '../components/Img'
import { collectionTiles } from '../data/products'
import { useProducts } from '../context/ProductsContext'
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

  return (
    <section className="max-w-page mx-auto px-4 md:px-7 py-14">
      <h1 className="text-[36px] md:text-[44px] text-center">Collections</h1>
      <p className="text-center text-xl text-black/60 mt-3">Pick a collection to start browsing</p>
      <div className="grid sm:grid-cols-3 gap-4 mt-12">
        {collectionTiles.map((c) => {
          const n = countFor(products, c.to)
          return (
            <Link key={c.title} to={c.to} className="group relative block aspect-[4/3] overflow-hidden bg-neutral-200">
              <Img src={c.image} alt={c.title} loading="eager" className="absolute inset-0 w-full h-full object-cover object-top transition-transform duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-0 p-6 md:p-8 text-white">
                <h2 className="text-[30px] md:text-[38px]">{c.title}</h2>
                <p className="text-lg text-white/85">{c.text}</p>
                <span className="underline underline-offset-4 mt-3 inline-block">Shop now{loading ? '' : ` · ${n} ${n === 1 ? 'style' : 'styles'}`}</span>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
