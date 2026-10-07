import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { Truck, Headset, Zap, Instagram, MessageCircle, Mail, Phone } from 'lucide-react'
import { categories, reviews, TYPES } from '../data/products'
import { site } from '../data/site'
import { img } from '../data/images'
import { useProducts } from '../context/ProductsContext'
import { inr } from '../lib/pricing'
import Img from './Img'
import ProductGrid from './ProductGrid'
const icons = { Truck, Headset, Zap }

export const Hero = () => {
  // The headline discount is read from the live catalogue, so the banner can
  // never promise more than the store is actually offering.
  const { products } = useProducts()
  const best = useMemo(() => products.reduce((max, p) => (
    p.compare && p.compare > p.price
      ? Math.max(max, Math.round((1 - p.price / p.compare) * 100))
      : max
  ), 0), [products])
  const promo = best >= 5 ? `UP TO ${best}% OFF!` : 'SHOP THE COLLECTION'
  return (
    // The 3-column composition needs ~1280px before the headline, the promo
    // line and the centre photo all fit side by side without colliding, so
    // below `xl` the hero stacks exactly like the mobile layout. At `xl`+ the
    // row is locked to the hero's own height (and the columns get `min-h-0`),
    // which stops the panel and the two photos from spilling over the
    // "Shop by Category" section underneath.
    <section className="grid min-h-[560px] xl:grid-cols-[1.1fr_1fr_1fr] xl:grid-rows-[684px] xl:h-[684px] bg-[#4A2C23] text-white">
      <div className="relative p-6 md:p-10 grid place-items-center text-center bg-[#F8EDE6] text-[#4A2C23] m-3 xl:m-0 xl:ml-[68px] xl:my-[70px] xl:min-h-0">
        <div><p className="text-xl md:text-2xl">Ruhi Womens Clothing</p>
          {/* The terracotta highlight on "Arrival" is taller than its line box,
              so the original `leading-[.9]` butted it straight into "New".
              `1.12` on small screens / `1.05` from `md` up keeps ~13px of clear
              space under "New" at both sizes. */}
          <h1 className="font-serif font-bold text-[64px] md:text-[104px] leading-[1.12] md:leading-[1.05] mt-8 md:mt-10">New<br /><em className="bg-[#C08576] px-4">Arrival</em></h1>
          <Link to="/shop" className="inline-block bg-[#4A2C23] text-white text-2xl md:text-[30px] px-6 py-3 mt-10 rounded-lg">Shop new arrivals</Link>
          <p className="text-xl md:text-2xl mt-8">Free shipping for all products</p></div></div>
      {/* `w-full` + `mx` (100% + 136px of margins) made the photo 68px too
          wide, pushing it into the promo column; size it to the space the
          two side margins leave. */}
      <Img src={img.heroMain} alt="New arrivals" loading="eager" className="w-full h-[420px] object-cover xl:h-[calc(100%-140px)] xl:mx-[68px] xl:w-[calc(100%-136px)] xl:self-start" />
      <div className="grid grid-rows-[auto_auto_minmax(0,1fr)] xl:pr-[68px] xl:min-h-0">
        <Img src={img.heroTop} alt="Women's coord set" loading="eager" className="w-full h-[300px] object-cover" />
        <Link to="/shop" className="font-ui italic font-bold text-[40px] md:text-[44px] text-center py-4">{promo}</Link>
        <Img src={img.heroStore} alt="Shop the collection" loading="eager" className="w-full h-[280px] object-cover xl:h-full xl:min-h-0" /></div>
    </section>
  )
}
export const Categories = () => (
  <section className="max-w-[1300px] mx-auto px-4 pt-16 pb-10">
    <h2 className="text-center text-[34px] tracking-wide">Shop by Category</h2>
    <div className="grid grid-cols-2 md:grid-cols-3 gap-8 mt-8">{categories.map((c, i) => (
      <Link key={i} to={c.to} className="text-center"><Img src={c.image} alt={c.label} className="w-full max-w-[272px] mx-auto aspect-square rounded-full object-cover" /><p className="mt-4 text-[17px]">{c.label}</p></Link>))}</div>
  </section>
)

// Four real catalogue styles, never two colourways of the same garment.
// `styleKey` drops the trailing " - Colour", so "Denim Shirt - Black" and
// "Denim Shirt - Blue" are one style and only the first colourway is a
// candidate. Selection runs purely over the live catalogue, so the row can
// never advertise a product the store does not have.
const styleKey = (title) => (title.includes(' - ') ? title.slice(0, title.lastIndexOf(' - ')) : title)

const bestSellers = (list, n = 4) => {
  // One entry per style, grouped by category.
  const styleBuckets = TYPES.map((t) => {
    const first = new Map()
    for (const p of list) {
      if (p.type !== t.key) continue
      const key = styleKey(p.title)
      if (!first.has(key)) first.set(key, p)
    }
    return [...first.values()]
  })

  const out = []
  const seen = new Set()
  // Round-robin: every category gets one style before any category gets a
  // second, so the row always reads as Tops + Co-ord Sets + Dresses + one more.
  for (let round = 0; out.length < n && round < n; round++) {
    for (const bucket of styleBuckets) {
      const cand = bucket[round]
      if (!cand || seen.has(styleKey(cand.title))) continue
      seen.add(styleKey(cand.title))
      out.push(cand)
      if (out.length >= n) break
    }
  }
  return out
}

export const BestSellers = () => {
  const { products, loading, source } = useProducts()
  const items = useMemo(() => bestSellers(products), [products])
  return (
    <section className="max-w-page mx-auto px-4 md:px-7 pt-14 pb-10">
      <h2 className="text-center text-[30px] md:text-[34px] font-normal tracking-wide">Best Sellers</h2>
      <div className="mt-10">
        <ProductGrid
          items={items}
          loading={loading && source !== 'database'}
          empty={{
            title: 'Nothing here yet',
            body: 'The catalogue is still loading — please refresh.',
          }}
        />
      </div>
      <div className="text-center mt-14"><Link to="/shop" className="btn-outline">Shop all products</Link></div>
    </section>
  )
}
export const OurStory = () => (
  <section className="max-w-page mx-auto px-4 md:px-7 py-16 grid lg:grid-cols-[1fr_1fr] gap-10 lg:gap-20 items-center">
    <div>
      <p className="text-brand-yellow font-ui tracking-[.12em] text-lg">OUR STORY</p>
      <h2 className="font-ui text-[42px] md:text-[62px] leading-tight mt-6 mb-8 tracking-normal">Crafting fashion with passion</h2>
      <p className="text-[22px] leading-[39px] text-black/70">Ruhi Womens Clothing is a clothing brand dedicated to creating high-quality, stylish apparel that reflects your unique personality. Our journey started with a simple vision: to make fashion accessible, sustainable, and meaningful.</p>
      <p className="text-[22px] leading-[39px] text-black/70 mt-6">Every piece in our collection is carefully designed and crafted with attention to detail, ensuring you look and feel your best every day.</p>
      <div className="flex gap-5 mt-10"><Link to="/shop" className="bg-brand-yellow px-11 h-[88px] grid place-items-center rounded-lg font-bold text-[21px]">Shop Now</Link><Link to="/about" className="border-2 border-black/10 px-11 h-[88px] grid place-items-center rounded-lg font-bold text-[21px]">Learn More</Link></div>
    </div>
    <Img src={img.story} alt="Our story" className="w-full aspect-square object-cover shadow-[0_30px_60px_rgba(74,44,35,.12)]" />
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
          <p className="text-[#C08576] text-[28px] mt-6 tracking-widest">
            <span role="img" aria-label="5 out of 5 stars">★★★★★</span>
          </p>
          <p className="mt-2 text-[22px]"><b className="font-ui">{r.name}</b> <span className="text-black/60 text-[18px] ml-2">✓ Verified Buyer</span></p>
          <p className="text-[18px] leading-[29px] text-black/70 mt-5 pb-4 border-b border-black/10">{r.text}</p>
          {p ? (
            <Link to={`/product/${p.id}`} className="flex gap-4 mt-4 items-center">
              <Img src={p.image} alt={p.title} className="w-[68px] h-[68px] object-cover rounded" />
              <div><p className="text-[17px] leading-6">{p.title}</p>{p.price > 0 && <p className="font-ui font-semibold text-black/60 mt-2">{inr(p.price)}</p>}</div>
            </Link>
          ) : null}
        </div>
      )})}</div>
    </section>
  )
}

// One consolidated "Instagram / WhatsApp / email / phone" strip for the
// homepage. Every value comes from src/data/site.js — the same source the
// footer and contact page read — so a number or social URL is written once.
export const ContactStrip = () => {
  const fromSocial = (label) => site.social.find((s) => s.label === label)
  const instagram = fromSocial('Instagram')
  const whatsapp = fromSocial('WhatsApp')
  const channels = [
    instagram && { label: 'Instagram', href: instagram.href, Icon: Instagram },
    whatsapp && { label: 'WhatsApp', href: whatsapp.href, Icon: MessageCircle },
    { label: site.email, href: `mailto:${site.email}`, Icon: Mail },
    { label: site.phone, href: `tel:${site.phone}`, Icon: Phone },
  ].filter(Boolean)
  return (
    <section className="max-w-page mx-auto px-4 md:px-7 pb-20">
      <div className="border-t border-black/10 pt-14 text-center">
        <p className="text-brand-yellow font-ui tracking-[.12em] text-lg">GET IN TOUCH</p>
        <h2 className="font-ui text-[34px] md:text-[42px] mt-4 tracking-normal">Follow Ruhi, or just say hello</h2>
        <p className="text-[19px] text-black/70 mt-4 max-w-[760px] mx-auto">
          Message us on Instagram or WhatsApp, email or call — we reply within one working day.
        </p>
        <div className="flex flex-wrap justify-center gap-3 md:gap-4 mt-8">
          {channels.map(({ label, href, Icon }) => {
            const external = /^https?:/.test(href)
            return (
              <a
                key={label}
                href={href}
                {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
                className="inline-flex items-center gap-2.5 border border-black/30 rounded-full px-5 md:px-6 py-3 text-[17px] hover:bg-black hover:text-white transition"
              >
                <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
                {/* `break-all` lets the long e-mail address wrap inside its
                    pill on a 320px screen instead of widening the row past
                    the viewport; short labels never actually break. */}
                <span className="break-all">{label}</span>
              </a>
            )
          })}
        </div>
      </div>
    </section>
  )
}
export const Features = () => (
  // Three benefits only, so the row is three equal tracks from `md` up and a
  // single stack below it — a four-up grid would leave one cell empty.
  <section className="max-w-page mx-auto px-4 md:px-7 py-20 grid grid-cols-1 md:grid-cols-3 gap-8 text-center">{site.features.map((f) => { const I = icons[f.icon]; return (
    <div key={f.title}><I size={64} strokeWidth={1.6} className="mx-auto text-black/60" /><h3 className="text-[28px] font-medium mt-5">{f.title}</h3><p className="text-[19px] text-black/70 mt-3">{f.text}</p></div>) })}</section>
)
