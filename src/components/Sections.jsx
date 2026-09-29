import { Link } from 'react-router-dom'
import { Truck, Headset, RefreshCcw, ShieldCheck } from 'lucide-react'
import { categories, reviews } from '../data/products'
import { site } from '../data/site'
import { img } from '../data/images'
import { useProducts } from '../context/ProductsContext'
import { inr } from '../lib/pricing'
import Img from './Img'
const icons = { Truck, Headset, RefreshCcw, ShieldCheck }

export const Hero = () => {
  // The headline discount is read from the live catalogue, so the banner can
  // never promise more than the store is actually offering.
  const { products } = useProducts()
  const best = products.reduce((max, p) => (
    p.compare && p.compare > p.price
      ? Math.max(max, Math.round((1 - p.price / p.compare) * 100))
      : max
  ), 0)
  const promo = best >= 5 ? `UP TO ${best}% OFF!` : 'SHOP THE COLLECTION'
  return (
    <section className="grid md:grid-cols-[1.1fr_1fr_1fr] min-h-[560px] md:h-[684px] bg-[#4a4a46] text-white">
      <div className="relative p-6 md:p-10 grid place-items-center text-center bg-[#e6ded3] text-[#161616] m-3 md:m-0 md:ml-[68px] md:my-[70px]">
        <div><p className="text-xl md:text-2xl">Ruhi Womens Clothing</p>
          <h1 className="font-serif font-bold text-[64px] md:text-[104px] leading-[.9] mt-8 md:mt-10">New<br /><em className="bg-[#bcb3a5] px-4">Arrival</em></h1>
          <Link to="/shop" className="inline-block bg-[#161616] text-white text-2xl md:text-[30px] px-6 py-3 mt-10">Shop new arrivals</Link>
          <p className="text-xl md:text-2xl mt-8">Free shipping over ₹999</p></div></div>
      <Img src={img.heroMen} alt="Men's new arrivals" className="w-full h-[420px] md:h-[calc(100%-140px)] object-cover md:mx-[68px] md:my-0 md:self-start md:mt-0 md:w-[calc(100%-0px)]" />
      <div className="grid grid-rows-[auto_auto_1fr] md:pr-[68px] md:ml-0">
        <Img src={img.heroWomenTop} alt="Women's tops" className="w-full h-[300px] object-cover" />
        <Link to="/shop" className="font-ui italic font-bold text-[40px] md:text-[44px] text-center py-4">{promo}</Link>
        <Img src={img.heroStore} alt="Shop the collection" className="w-full h-[280px] md:h-full object-cover" /></div>
    </section>
  )
}
export const Categories = () => (
  <section className="max-w-[1300px] mx-auto px-4 pt-16 pb-10">
    <h2 className="text-center text-[34px] tracking-wide">Shop by Category</h2>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-8">{categories.map((c, i) => (
      <Link key={i} to={c.to} className="text-center"><Img src={c.image} alt={c.label} className="w-full max-w-[272px] mx-auto aspect-square rounded-full object-cover" /><p className="mt-4 text-[17px]">{c.label}</p></Link>))}</div>
  </section>
)
export const OurStory = () => (
  <section className="max-w-page mx-auto px-4 md:px-7 py-16 grid lg:grid-cols-[1fr_1fr] gap-10 lg:gap-20 items-center">
    <div>
      <p className="text-brand-yellow font-ui tracking-[.12em] text-lg">OUR STORY</p>
      <h2 className="font-ui text-[42px] md:text-[62px] leading-tight mt-6 mb-8 tracking-normal">Crafting fashion with passion</h2>
      <p className="text-[22px] leading-[39px] text-black/70">Ruhi Womens Clothing is a clothing brand dedicated to creating high-quality, stylish apparel that reflects your unique personality. Our journey started with a simple vision: to make fashion accessible, sustainable, and meaningful.</p>
      <p className="text-[22px] leading-[39px] text-black/70 mt-6">Every piece in our collection is carefully designed and crafted with attention to detail, ensuring you look and feel your best every day.</p>
      <div className="flex gap-5 mt-10"><Link to="/shop" className="bg-brand-yellow px-11 h-[88px] grid place-items-center rounded-lg font-bold text-[21px]">Shop Now</Link><Link to="/about" className="border-2 border-black/10 px-11 h-[88px] grid place-items-center rounded-lg font-bold text-[21px]">Learn More</Link></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-14 pt-14 border-t border-black/10 text-center">{site.stats.map(([n, l]) => (
        <div key={l}><p className="font-ui text-brand-yellow text-[46px] font-bold">{n}</p><p className="uppercase text-[18px] text-black/70 mt-4 leading-9">{l}</p></div>))}</div>
    </div>
    <Img src={img.story} alt="Our story" className="w-full aspect-square object-cover shadow-[0_30px_60px_rgba(0,0,0,.12)]" />
  </section>
)
export const Reviews = () => {
  // Titles, prices and thumbnails come from the live catalogue rather than
  // hard-coded strings, so a card can never advertise one product and link to
  // another.
  const { getProduct } = useProducts()
  return (
    <section className="max-w-page mx-auto px-4 md:px-7 py-10">
      <h2 className="text-center text-[42px] font-medium font-ui">Happy Customers</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-14">{reviews.map((r) => {
        const p = getProduct(r.product)
        return (
        <div key={r.name} className="border border-black/10 p-4 hover:shadow-lg transition">
          <Img src={r.img} alt={`Customer wearing ${p ? p.title : 'Ruhi Womens Clothing'}`} className="w-full aspect-[1.1] object-cover" />
          <p className="text-[#f59e0b] text-[28px] mt-6 tracking-widest">
            <span role="img" aria-label="5 out of 5 stars">★★★★★</span>
          </p>
          <p className="mt-2 text-[22px]"><b className="font-ui">{r.name}</b> <span className="text-black/60 text-[18px] ml-2">✓ Verified Buyer</span></p>
          <p className="text-[18px] leading-[29px] text-black/70 mt-5 pb-4 border-b border-black/10">{r.text}</p>
          {p ? (
            <Link to={`/product/${p.id}`} className="flex gap-4 mt-4 items-center">
              <Img src={p.image} alt={p.title} className="w-[68px] h-[68px] object-cover rounded" />
              <div><p className="text-[17px] leading-6">{p.title}</p><p className="font-ui font-semibold text-black/60 mt-2">{inr(p.price)}</p></div>
            </Link>
          ) : null}
        </div>
      )})}</div>
    </section>
  )
}
export const Features = () => (
  <section className="max-w-page mx-auto px-4 md:px-7 py-20 grid grid-cols-2 lg:grid-cols-4 gap-8 text-center">{site.features.map((f) => { const I = icons[f.icon]; return (
    <div key={f.title}><I size={64} strokeWidth={1.6} className="mx-auto text-black/60" /><h3 className="text-[28px] font-medium mt-5">{f.title}</h3><p className="text-[19px] text-black/70 mt-3">{f.text}</p></div>) })}</section>
)
