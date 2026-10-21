import { Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { Truck, Headset, IndianRupee, Instagram, MessageCircle, Mail, Phone, ChevronLeft, ChevronRight } from 'lucide-react'
import { reviews } from '../data/products'
import { extraCategoryTiles, stockedCategoryTiles } from '../lib/categoryTiles'
import { site } from '../data/site'
import { img } from '../data/images'
import { useProducts } from '../context/ProductsContext'
import { useCategories } from '../context/CategoriesContext'
import { fetchHomeBanners } from '../lib/banners'
import { heroSlides, slideAt } from '../lib/heroSlider'
import { fetchBestsellers, resolveBestsellers } from '../lib/bestsellers'
import { derivedBestsellers } from '../lib/bestsellerRules'
import { inr } from '../lib/pricing'
import { productHref } from '../lib/productLinks'
import Img from './Img'
import ProductGrid from './ProductGrid'
const icons = { Truck, Headset, IndianRupee }

// The homepage's category tiles — the photo each one shows and the shop page
// it points at — are built by src/lib/categoryTiles.js, so the homepage, the
// Collections page and the shop's own Type filter can never disagree about
// where a category goes or which picture represents it. The owner can change
// the picture from the admin panel; until they do, the default photographs
// below are used.

export const Hero = () => {
  // Two halves, side by side from `md` up: the cream poster on the left and
  // exactly ONE photo on the right. Nothing moves on its own — there
  // is no autoplay, no track and no loop; the photo changes only when a
  // shopper clicks an arrow. The photos are either the admin-managed homepage
  // banners (the `banners` table) or — while none are saved — one entry of
  // the stocked categories, the very same list the "Shop by Category" row
  // reads, so the fallback photo, its label and the `/shop?type=…` filter it
  // links to can never disagree with the rest of the store. Below `md` the
  // halves stack (poster first): a phone
  // is far too narrow for a two-line headline and a recognisable photo to
  // share the width, so that is the balanced fallback rather than a clipped
  // layout. The poster copy is a headline broken into two lines ("Ruhi Women's" /
  // "Collection") plus a subheadline, so the type steps at `sm`/`md`/`lg`/
  // `xl` rather than one jump to 104px: the longest line, "Ruhi Women's",
  // has to clear the column at 320px and inside the 384px half a `md`
  // viewport gives it.
  const [atRaw, setAt] = useState(0)
  // Banner photos the admin has saved for the homepage hero. Empty means
  // "none saved" (or Supabase unreachable) — the hero then keeps its original
  // category-photo slider, so the page always renders something meaningful.
  const [banners, setBanners] = useState([])
  // Whether the banner list is known yet.
  //
  // The hero must not show a fallback photograph before that: the fallback is
  // a full-size photograph, and showing it first means every visitor
  // downloads it in full and then throws it away the moment the owner's
  // banner arrives. The fallback is still used when the owner really has no
  // banner — and when the read does not come back, so the hero can never be
  // left empty.
  const [bannersKnown, setBannersKnown] = useState(false)
  const { products } = useProducts()
  const { categories } = useCategories()
  useEffect(() => {
    let alive = true
    const settle = () => { if (alive) setBannersKnown(true) }
    // A read that never answers must not leave the hero empty: after two
    // seconds the fallback photograph is used whatever the answer was.
    const timer = setTimeout(settle, 2000)
    fetchHomeBanners()
      .then((rows) => { if (alive) setBanners(rows); settle() })
      .catch(settle)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])
  // The hero slides the admin's saved banners FIRST — in the order they were
  // saved, opening on the first one — and keeps the stocked-category photos on
  // the END of the list. Keeping them is what stops the arrows from vanishing
  // the moment a banner is saved (see src/lib/heroSlider.js). With no banners
  // saved the list is exactly the original category slider.
  const slides = heroSlides(banners, stockedCategoryTiles(categories, products).map((c) => ({
    key: c.key, image: c.image, to: c.to, label: c.label,
  })))
  const n = slides.length
  // Read-side wrap-around, so the last photo steps back to the first and the
  // first forward to the last without growing the state forever.
  //
  // `n` can legitimately be 0: ProductsContext deliberately lets the catalogue
  // go empty (`setAll([])`) when the database returns no rows, and an empty
  // catalogue leaves no stocked category to fall back on. Without this guard
  // `at % 0` is NaN, `slides[NaN]` is undefined and reading `cur.key` in the
  // markup below takes the entire homepage down. With nothing to show the right
  // half stays blank and the static hero still renders.
  const at = slideAt(atRaw, n)
  const cur = at === null ? null : slides[at]
  const go = (d) => setAt((v) => v + d)
  // Banners are prepended, so a list that changes underneath the visitor must
  // start again from the top rather than landing somewhere in the middle of a
  // set of photos they never saw.
  useEffect(() => { setAt(0) }, [banners.length])
  return (
    <section className="grid min-h-[560px] md:grid-cols-2 md:h-[600px] lg:h-[684px] bg-[#4A2C23] text-white">
      {/* The poster is completely static: same wording, type, colours and
          button as always, filling its half and centred inside it. The
          headline, subheadline and "SHOP NOW" button are the client's
          homepage copy — nothing else about the block changes. */}
      <div className="m-3 md:m-0 p-6 lg:p-10 grid place-items-center text-center bg-[#F8EDE6] text-[#4A2C23]">
        <div>
          {/* Two explicit, centre-aligned lines: "Ruhi Women's" over
              "Collection". The type steps up gently because the longest line
              is "Ruhi Women's" (~6.8em): it has to clear the ~248px column
              at 320px, the 336px half-column from `md` and the 432px column
              from `lg`, with the `xl` step only where there is real room.
              `1.1` leading below `lg` / `1.05` from `lg` keeps the two lines
              tight without touching. */}
          <h1 className="font-serif font-bold text-[34px] sm:text-[42px] md:text-[46px] lg:text-[56px] xl:text-[64px] leading-[1.1] lg:leading-[1.05] mt-2">Ruhi Women's<br />Collection</h1>
          {/* One sentence, centred and left to wrap naturally, so the exact
              wording never depends on where the line breaks. */}
          <p className="text-xl lg:text-2xl mt-5 lg:mt-6">"Style You Love. Prices You’ll Love More."</p>
          <Link to="/shop" className="inline-block bg-[#4A2C23] text-white text-2xl lg:text-[30px] px-6 py-3 mt-8 lg:mt-10 rounded-lg">SHOP NOW</Link>
        </div>
      </div>
      {/* The right half: one photo, `object-cover` so it fills the half at
          every width without distortion. The link is keyed by category, so
          a change of photo remounts it and the `fade` keyframe brings the new
          photo in — instantly, with no motion at all, for anyone who asked
          their device for reduced motion. The arrows are siblings of that
          link, never children, so clicking one can only move the slider and
          can never also follow the category link. At 44px they match the
          touch target the wishlist button already uses. */}
      <div className="relative overflow-hidden h-[380px] md:h-auto">
        {cur && bannersKnown && (
          <Link key={cur.key} to={cur.to} className="absolute inset-0 animate-[fade_.35s_ease] motion-reduce:animate-none">
              <Img src={cur.image} alt={cur.label} loading="eager" className="absolute inset-0 w-full h-full object-cover" />
          </Link>
        )}
        {n > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Show previous photo"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-[#F8EDE6] text-[#4A2C23] grid place-items-center hover:bg-white transition">
              <ChevronLeft size={22} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Show next photo"
              className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-[#F8EDE6] text-[#4A2C23] grid place-items-center hover:bg-white transition">
              <ChevronRight size={22} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </section>
  )
}
export const Categories = () => {
  const { products } = useProducts()
  const { categories } = useCategories()
  return (
    <section className="max-w-[1300px] mx-auto px-4 pt-16 pb-10">
      <h2 className="text-center text-[34px] tracking-wide">Shop by Category</h2>
      {/* The whole card — the photograph and the name under it — is one link to
          that category's own page in the shop, so a tap anywhere on the card
          lands on the products of the category that was pictured. The link is
          built by src/lib/categoryTiles.js, the same place the Collections
          page and the shop filter read it from, so the three can never
          disagree about where a category goes. */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-8 mt-8">{[...stockedCategoryTiles(categories, products), ...extraCategoryTiles(categories, products)].map((c) => (
        <Link
          key={c.key}
          to={c.to}
          className="text-center group block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-black/30"
        >
          <Img src={c.image} alt={c.label} sizes="(max-width: 768px) 45vw, 272px" className="w-full max-w-[272px] mx-auto aspect-square rounded-full object-cover transition group-hover:scale-[1.03]" />
          <p className="mt-4 text-[17px] group-hover:underline underline-offset-4">{c.label}</p>
        </Link>))}</div>
    </section>
  )
}

// Four real catalogue styles, never two colourways of the same garment.
// The rule that picks them lives in src/lib/bestsellerRules.js, so it can be
// tested in plain Node and the homepage cannot drift away from it.
export const BestSellers = () => {
  const { products, loading, source } = useProducts()
  const { categories } = useCategories()
  const catKeys = useMemo(() => categories.map((c) => c.key), [categories])

  // The owner's own picks, saved from the admin Bestsellers tab. Loading
  // failure is swallowed on purpose: the row then simply shows the derived
  // selection below, so a Supabase hiccup can never blank the homepage.
  const [picks, setPicks] = useState([])
  useEffect(() => {
    let alive = true
    fetchBestsellers()
      .then((rows) => { if (alive) setPicks(rows) })
      .catch(() => { if (alive) setPicks([]) })
    return () => { alive = false }
  }, [])

  const derived = useMemo(() => derivedBestsellers(products, catKeys), [products, catKeys])
  // Resolved against the same mapped products every other card uses, so a
  // promoted design is indistinguishable from an ordinary catalogue card —
  // and one that has since been deleted or hidden simply drops out.
  const chosen = useMemo(() => resolveBestsellers(picks, products), [picks, products])

  // No picks saved → the row is derived from the catalogue exactly as it was
  // before this feature existed, so the homepage is unchanged by default.
  const items = chosen.length ? chosen : derived

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
      {/* Compact pair, sized to the site's small reference button (~40px tall,
          tight padding, text-sized type) instead of the old 88px blocks. Both
          share the same fixed height so the filled and the outlined button
          sit level, `gap-3` keeps them side by side, and `flex-wrap` lets the
          row drop to two lines rather than squeeze on a very narrow screen. */}
      <div className="flex flex-wrap gap-3 mt-10"><Link to="/shop" className="inline-flex items-center justify-center h-10 px-6 rounded-lg bg-brand-yellow font-bold text-[15px] transition hover:opacity-90">Shop Now</Link><Link to="/about" className="inline-flex items-center justify-center h-10 px-6 rounded-lg border-2 border-black/10 font-bold text-[15px] transition hover:bg-black/5">About</Link></div>
    </div>
    <Img src={img.story} alt="Our story" className="w-full aspect-square object-cover shadow-[0_30px_60px_rgba(74,44,35,.12)]" />
  </section>
)
export const Reviews = () => {
  // Titles, prices and thumbnails come from the live catalogue rather than
  // hard-coded strings, so a card can never advertise one product and link to
  // another.
  //
  // `getVariant` resolves the EXACT row a review names — usually one colour of
  // a design — so the small photograph beside the review is the photograph
  // the shopper lands on, at that colour's own price. A review whose product
  // has been deleted or hidden resolves to nothing and simply shows no link,
  // rather than pointing at some other product.
  const { getProduct, getVariant } = useProducts()
  return (
    <section className="max-w-page mx-auto px-4 md:px-7 py-10">
      <h2 className="text-center text-[42px] font-medium font-ui">Happy Customers</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-14">{reviews.map((r) => {
        const p = getProduct(r.product)
        const shown = getVariant(r.product) || p
        return (
        <div key={r.name} className="border border-black/10 p-4 hover:shadow-lg transition">
          <Img src={r.img} alt={`Customer wearing ${p ? p.title : 'Ruhi Womens Clothing'}`} className="w-full aspect-[1.1] object-cover" />
          <p className="text-[#C08576] text-[28px] mt-6 tracking-widest">
            <span role="img" aria-label="5 out of 5 stars">★★★★★</span>
          </p>
          <p className="mt-2 text-[22px]"><b className="font-ui">{r.name}</b> <span className="text-black/60 text-[18px] ml-2">✓ Verified Buyer</span></p>
          <p className="text-[18px] leading-[29px] text-black/70 mt-5 pb-4 border-b border-black/10">{r.text}</p>
          {shown ? (
            <Link to={productHref(shown)} className="flex gap-4 mt-4 items-center">
              <Img src={shown.image} alt={p ? p.title : shown.title} className="w-[68px] h-[68px] object-cover rounded" />
              <div><p className="text-[17px] leading-6">{p ? p.title : shown.title}</p>{shown.price > 0 && <p className="font-ui font-semibold text-black/60 mt-2">{inr(shown.price)}</p>}</div>
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
  // single stack below it — a four-up grid would leave one cell empty. Each
  // card is icon + heading + description line (`f.text`), all three supplied.
  <section className="max-w-page mx-auto px-4 md:px-7 py-20 grid grid-cols-1 md:grid-cols-3 gap-8 text-center">{site.features.map((f) => { const I = icons[f.icon]; return (
    <div key={f.title}><I size={64} strokeWidth={1.6} className="mx-auto text-black/60" /><h3 className="text-[28px] font-medium mt-5">{f.title}</h3>{f.text ? <p className="text-[19px] text-black/70 mt-3">{f.text}</p> : null}</div>) })}</section>
)
