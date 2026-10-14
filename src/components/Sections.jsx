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

export const Hero = () => (
  // Two parts only: the cream poster (unchanged) and the brown area, which is
  // a single edge-to-edge scroller. Below `xl` the hero stacks exactly like
  // the mobile layout — poster first, photos underneath. At `xl`+ the two
  // children are pinned to the *same* grid cell, so the carousel fills the
  // whole brown hero while the poster is centred on top of it: the photos run
  // behind the poster as one continuous track and stay visible on both of its
  // sides. The row is locked to the hero's own height (and both children get
  // `min-h-0`), which stops the panel and the photos from spilling over the
  // "Shop by Category" section underneath.
  <section className="grid min-h-[560px] xl:grid-rows-[684px] xl:h-[684px] bg-[#4A2C23] text-white">
    {/* The poster keeps its size, type and button; only its placement changes
        on desktop. `justify-self`/`self` switch it from the default stretch
        to its natural (fit-content) box, so it can never be pulled wide by
        the hero — it grows with its own content only, and `max-w` caps it at
        46% of the hero so a laptop still shows a full column of photos down
        each side. `z-10` lifts that solid cream box above the track. */}
    <div className="relative p-6 md:p-10 grid place-items-center text-center bg-[#F8EDE6] text-[#4A2C23] m-3 xl:m-0 xl:col-start-1 xl:row-start-1 xl:z-10 xl:justify-self-center xl:self-center xl:max-w-[46%] xl:min-h-0">
      <div><p className="text-xl md:text-2xl">Ruhi Womens Clothing</p>
        {/* The terracotta highlight on "Arrival" is taller than its line box,
            so the original `leading-[.9]` butted it straight into "New".
            `1.12` on small screens / `1.05` from `md` up keeps ~13px of clear
            space under "New" at both sizes. */}
        <h1 className="font-serif font-bold text-[64px] md:text-[104px] leading-[1.12] md:leading-[1.05] mt-8 md:mt-10">New<br /><em className="bg-[#C08576] px-4">Arrival</em></h1>
        <Link to="/shop" className="inline-block bg-[#4A2C23] text-white text-2xl md:text-[30px] px-6 py-3 mt-10 rounded-lg">Shop new arrivals</Link>
        <p className="text-xl md:text-2xl mt-8">Free shipping for all products</p></div></div>
    {/* The brown area of the hero: one continuous, self-running carousel of
        the three category photos, cropped to fill this box edge to edge — and
        at `xl` the box is the *whole* hero, not just the columns to the right
        of the poster, so a single track passes behind the poster instead of
        reading as two separate columns. Each slide is one entry of
        `categories` — the very same list the "Shop by Category" row reads — so
        the label, the photo and the `/shop?type=…` filter it links to can
        never disagree with the rest of the store. `overflow-hidden` clips the
        track *and* is what keeps the cell width honest: a grid item with
        non-visible overflow has an automatic minimum size of 0, so the much
        longer track inside can never widen its cell or push a horizontal
        scrollbar onto the page. */}
    <div className="group relative overflow-hidden h-[440px] md:h-[520px] lg:h-[600px] xl:h-full xl:min-h-0 xl:col-start-1 xl:row-start-1">
      {/* The track holds two identical *visible* sets, so the site's existing
          `marquee` keyframe (translateX 0 → -50%) lands on a perfect seam: no
          jump, no flicker, no blank frame, no pause. Two sets only reach
          1368px wide, which is enough for the stacked hero but would leave a
          bare strip of brown at the right edge of a 1440px+ desktop — so from
          `xl` two more sets join the track (50% of it is then 2736px, wider
          than any desktop viewport) and the extra six slides are hidden below
          `xl`, where they would only make the mobile track longer. Playing the
          same keyframe in reverse from `xl` (a longhand, so it never touches
          the `animation` shorthand and the hover pause or the reduced-motion
          opt-out below stay in charge) runs that identical seam from left to
          right behind the poster; `80s` is the longhand duration covering the
          doubled distance at the same 34px/s the carousel has always moved —
          a shorthand here would outrank `.motion-reduce:animate-none` and put
          the photos back in front of users who asked for less motion.
          Each slide is a 2:3 slot sized off the hero's own height, which is
          the ratio the product photography is shot at, so a photo fills its
          slot at every width instead of being cropped to a letterbox.
          Hovering stops it for a closer look; `motion-reduce` turns it off. */}
      <div className="flex h-full w-max animate-[marquee_40s_linear_infinite] xl:[animation-duration:80s] xl:[animation-direction:reverse] motion-reduce:animate-none group-hover:[animation-play-state:paused]">
        {[...categories, ...categories, ...categories, ...categories].map((c, i) => {
          // Every slide after the first set only exists to close the loop, so
          // it is hidden from screen readers and skipped by the keyboard — the
          // same category is never announced or tabbed to twice. The third and
          // fourth sets are desktop-only (`hidden xl:block`).
          const copy = i >= categories.length
          const extra = i >= categories.length * 2
          return (
            <Link key={`${c.label}-${i}`} to={c.to} aria-hidden={copy || undefined} tabIndex={copy ? -1 : undefined}
              className={`relative shrink-0 h-full aspect-[2/3] ${extra ? 'hidden xl:block' : 'block'}`}>
              <Img src={c.image} alt={copy ? '' : c.label} loading="eager" className="absolute inset-0 w-full h-full object-cover" />
            </Link>
          )
        })}
      </div>
    </div>
  </section>
)
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
    instagram && { label: 'Instagram', href: instagram.href, Icon: Instagram, iconOnly: true },
    whatsapp && { label: 'WhatsApp', href: whatsapp.href, Icon: MessageCircle, iconOnly: true },
    { label: site.email, href: `mailto:${site.email}`, Icon: Mail },
    { label: site.phone, href: `tel:${site.phone}`, Icon: Phone },
  ].filter(Boolean)
  return (
    <section className="max-w-page mx-auto px-4 md:px-7 pb-20">
      <div className="pt-14 text-center">
        <p className="text-brand-yellow font-ui tracking-[.12em] text-lg">GET IN TOUCH</p>
        <h2 className="font-ui text-[34px] md:text-[42px] mt-4 tracking-normal">Follow Ruhi, or just say hello</h2>
        <p className="text-[19px] text-black/70 mt-4 max-w-[760px] mx-auto">
          Message us on Instagram or WhatsApp, email or call — we reply within one working day.
        </p>
        <div className="flex flex-wrap justify-center gap-3 md:gap-4 mt-8">
          {channels.map(({ label, href, Icon, iconOnly }) => {
            const external = /^https?:/.test(href)
            return (
              <a
                key={label}
                href={href}
                {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
                {...(iconOnly ? { 'aria-label': label, title: label } : {})}
                className="inline-flex items-center gap-2.5 border border-black/30 rounded-full px-5 md:px-6 py-3 text-[17px] hover:bg-black hover:text-white transition"
              >
                <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
                {/* `break-all` lets the long e-mail address wrap inside its
                    pill on a 320px screen instead of widening the row past
                    the viewport; short labels never actually break. */}
                {!iconOnly && <span className="break-all">{label}</span>}
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
