// The homepage — "Modern": shop-first and app-like (redesign, 21 Nov 2026;
// the owner chose this over an editorial design).
//
// Built like the shopping apps this audience already uses: category chips at
// the very top, a rounded hero card, a bento grid of categories, colour
// swatches and big tappable cards. Jost (the site's own geometric sans) in
// tight, bold headlines; generous 24–28 px corners; cocoa, rose and the creams
// as solid blocks. No new fonts, scripts, sites or reads (see homeData.js).
//
// Order: chips (jump straight to a category) → hero → three promises →
// bestsellers → category bento → "everything under ₹1000" → shop by colour →
// just landed → reviews → Instagram / WhatsApp.
import { useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Truck, BadgeIndianRupee, ShieldCheck, Instagram, MessageCircle } from 'lucide-react'
import HeroCarousel from './HeroCarousel'
import Img from '../Img'
import { Stars } from '../Stars'
import { useRatings } from '../../context/RatingsContext'
import { useProducts } from '../../context/ProductsContext'
import { useCategories } from '../../context/CategoriesContext'
import { categoryShopUrl } from '../../lib/categoryTiles'
import { productIdFromPath } from '../../lib/trackingItems'
import { HERO_RATIO } from '../../lib/heroShape'
import { ratingText } from '../../lib/ratingSummary'
import { inr } from '../../lib/pricing'
import { LISTS } from '../../lib/itemLists'
import { useBestsellers, useCategoryTiles, useColourFamilies, useLowestPrice, useNewArrivals, usePublishedQuotes } from './homeData'
import { AutoRail, ProductGridList, ProductRail, QuoteCard, QuotePlaceholders, Rail, WriteReview, instagramHandle, socialLink, tappedContact } from './parts'

const H2 = ({ children, className = '' }) => (
  <h2 className={`font-sans font-semibold text-[26px] md:text-[38px] leading-[1.08] tracking-[-.02em] text-black ${className}`}>{children}</h2>
)
const Pill = ({ to, children, dark = false }) => (
  <Link to={to} className={`shrink-0 inline-flex items-center gap-1.5 h-11 px-4 rounded-full text-[14px] font-medium transition ${dark ? 'bg-black text-white hover:bg-gray-700' : 'bg-white ring-1 ring-black/10 hover:ring-black/40'}`}>
    {children}<ArrowRight size={15} strokeWidth={1.8} aria-hidden="true" />
  </Link>
)
const Head = ({ title, sub, link }) => (
  <div className="px-4 md:px-10 flex items-end justify-between gap-4">
    <div>
      <H2>{title}</H2>
      {sub && <p className="mt-1.5 text-[14px] md:text-[16px] text-black/60">{sub}</p>}
    </div>
    {link}
  </div>
)

function Chips() {
  const { tiles } = useCategoryTiles()
  const chip = 'shrink-0 snap-start inline-flex items-center h-11 px-4 rounded-full text-[14px] font-medium whitespace-nowrap transition'
  return (
    <nav aria-label="Shop by category" className="pt-3 md:pt-5">
      <Rail label="Categories" gap="gap-2" className="md:justify-center !px-3 md:!px-6">
        <Link to="/shop" className={`${chip} bg-black text-white`}>Shop all</Link>
        {tiles.map((c) => (
          <Link key={c.key} to={c.to} className={`${chip} bg-white ring-1 ring-black/10 hover:ring-black/40`}>{c.label}</Link>
        ))}
      </Rail>
    </nav>
  )
}

// The hero's words follow the photo on screen: a dress photo talks about
// dresses, a winter photo about winter wear. Which category a photo belongs to
// is read from where it links (a category page, or a product and that
// product's category), so the owner sets nothing extra in the admin panel.
// Each headline is short (it reads as one line on most phones); a category
// added later gets its own name as the headline.
const HERO_COPY = {
  coord: { title: ['Co‑ords', 'you’ll live in'], cta: 'Shop co‑ord sets' },
  dress: { title: ['Dresses for', 'every day'], cta: 'Shop dresses' },
  trousers: { title: ['Trousers that', 'go with everything'], cta: 'Shop trousers & pants' },
  'winter-wear': { title: ['Cosy up', 'for winter'], cta: 'Shop winter wear' },
  tops: { title: ['Tops you’ll', 'reach for daily'], cta: 'Shop tops & T‑shirts' },
}
const SHOP_COPY = { key: 'all', title: ['Everyday styles,', 'all under ₹1000'], cta: 'Shop all', to: '/shop' }

function useHeroCopy() {
  const { getProduct } = useProducts()
  const { categories, typeLabel } = useCategories()
  return (slide) => {
    const to = String(slide?.to || '')
    const typed = /[?&]type=([^&#]+)/.exec(to)
    const row = typed ? null : productIdFromPath(to)
    const key = typed ? decodeURIComponent(typed[1]) : (row ? getProduct(row)?.type : '') || ''
    if (!key || !categories.some((c) => c.key === key)) return SHOP_COPY
    const copy = HERO_COPY[key] || { title: [typeLabel(key), 'all under ₹1000'], cta: `Shop ${typeLabel(key)}` }
    return { ...copy, key, to: categoryShopUrl(key) }
  }
}

// Jump to the reviews row from the rating badge on the hero.
const toReviews = () => {
  const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  document.getElementById('home-reviews')?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
}

/**
 * The shop's rating, in a slim strip just under the hero photo (the owner,
 * 21 Nov 2026: keep the focus on the rating, but off the photo — on the
 * photo it covered faces and the clothes). Tapping it jumps to the reviews.
 * Before the ratings arrive the strip keeps its height with the price promise,
 * so nothing below it moves.
 */
function RatingStrip() {
  const { shop } = useRatings()
  const cls = 'flex items-center gap-2 w-full h-[52px] md:h-14 px-5 md:px-7 bg-white text-black text-left'
  if (!shop) return <div className={`${cls} text-[14px] font-medium`}>All under ₹1000 · Free delivery</div>
  return (
    <button type="button" onClick={toReviews} aria-label={`Rated ${ratingText(shop.average)} out of 5 from ${shop.count} reviews. Read the reviews`}
      className={`${cls} hover:bg-amber-50 transition rounded-none`}>
      <Stars value={shop.average} size={15} />
      <span className="text-[17px] font-bold leading-none">{ratingText(shop.average)}</span>
      <span className="text-[13.5px] text-black/60 leading-none">{shop.count.toLocaleString('en-IN')} reviews</span>
      <span className="ml-auto inline-flex items-center gap-1 text-[13.5px] font-medium text-brand-cta">Read <ArrowRight size={14} strokeWidth={2} aria-hidden="true" /></span>
    </button>
  )
}

function Hero() {
  const { tiles, ready } = useCategoryTiles()
  const copyFor = useHeroCopy()
  // Laptop only: the four biggest categories as cards beside the photo.
  const side = [...tiles].filter((t) => t.count > 0).sort((a, b) => b.count - a.count).slice(0, 4)
  return (
    <section className="px-3 md:px-6 pt-3">
      {/* The photo is 3:4 — the shape of an upright phone photo — on every
          screen (src/lib/heroShape.js, the same shape the admin preview
          draws), with the rating strip under it in the same card. On a
          laptop it is as tall as the hero row and the category cards fill the
          rest of the width. */}
      <div className="md:grid md:grid-cols-[auto_1fr] md:gap-4 lg:gap-5">
        <div className="rounded-[28px] overflow-hidden bg-white sm:max-w-[480px] sm:mx-auto md:mx-0 md:max-w-none">
        <HeroCarousel
          className="w-full md:w-auto md:h-[min(78vh,700px)]"
          style={{ aspectRatio: HERO_RATIO }}
          shade="bg-gradient-to-t from-black/85 via-black/55 via-[26%] to-transparent to-[50%]"
          progress="bars"
          autoplay={5000}
        >
          {({ slide }) => {
            const copy = copyFor(slide)
            return (
              <>
                {/* Few words, low on the photo, so the photo leads (the owner,
                    21 Nov 2026): one short line and a small button over a
                    short shade — readable on every banner (contrast checked
                    per photo). Hidden (still read by screen readers) until the
                    first photo is known; then each photo's words fade in. */}
                <div className={`absolute inset-x-0 bottom-0 px-4 pb-4 md:px-8 md:pb-8 text-white transition-opacity duration-300 ${slide ? 'opacity-100' : 'opacity-0'}`}>
                  <div key={copy.key} className="animate-[fade_.35s_ease] motion-reduce:animate-none">
                    <h1 className="font-sans font-semibold text-[min(6.6vw,26px)] md:text-[34px] lg:text-[40px] leading-[1.1] tracking-[-.02em] text-balance max-w-[18ch]">
                      {copy.title[0]} {copy.title[1]}
                    </h1>
                    <Link to={copy.to} className="pointer-events-auto mt-3 md:mt-5 inline-flex items-center gap-1.5 h-11 px-4 rounded-full bg-white text-black text-[14px] font-semibold hover:bg-amber-50 transition">
                      {copy.cta} <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </>
            )
          }}
        </HeroCarousel>
        <RatingStrip />
        </div>
        {/* Four category cards beside the photo from `md` up (a laptop has the room; a phone gets the chips instead). */}
        <div className="hidden md:grid grid-cols-2 grid-rows-2 gap-4 lg:gap-5 md:h-[calc(min(78vh,700px)+3.5rem)]">
          {side.map((c) => (
            <Link key={c.key} to={c.to} className="group relative rounded-[28px] overflow-hidden bg-gray-200">
              {ready && <Img src={c.image} alt="" sizes="25vw" className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-[1.04]" />}
              <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <span className="absolute left-6 bottom-6 text-white">
                <span className="block text-[22px] lg:text-[26px] font-semibold tracking-[-.02em] leading-none">{c.label}</span>
                {ready && c.count > 0 && <span className="block mt-2 text-[14px] text-white/85">{c.count} styles</span>}
              </span>
              <span aria-hidden="true" className="absolute right-5 top-5 w-11 h-11 rounded-full bg-white text-black grid place-items-center transition group-hover:rotate-45">
                <ArrowUpRight size={20} strokeWidth={1.8} />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

function Promises() {
  // The rating now leads on the hero itself (RatingBadge), so this row
  // carries the price promise instead.
  const cells = [
    { Icon: BadgeIndianRupee, title: 'Under ₹1000', text: 'every style' },
    { Icon: Truck, title: 'Free', text: 'delivery' },
    { Icon: ShieldCheck, title: 'Secure', text: 'UPI & cards' },
  ]
  return (
    <ul aria-label="Why shop with Ruhi" className="grid grid-cols-3 gap-2 md:gap-4 px-3 md:px-6 mt-3 md:mt-4 max-w-[1100px] md:mx-auto">
      {cells.map(({ Icon, title, text }) => (
        <li key={text} className="flex items-center gap-3 rounded-2xl bg-white px-3 py-3 md:px-5 md:py-4">
          <span className="hidden md:grid shrink-0 w-10 h-10 rounded-full bg-gray-200 place-items-center text-black">
            <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className="leading-tight min-w-0">
            <Icon size={16} strokeWidth={2} aria-hidden="true" className="md:hidden mb-1 text-brand-cta" />
            <span className="block text-[14px] md:text-[15px] font-semibold whitespace-nowrap">{title}</span>
            <span className="block text-[12px] md:text-[13px] text-black/60 mt-0.5">{text}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function Bestsellers({ best }) {
  return (
    <section className="pt-12 md:pt-20 max-w-page mx-auto">
      <Head title="Bestsellers" sub="Our most-loved styles" link={<Pill to="/shop">View all</Pill>} />
      <div className="mt-6 md:mt-8 px-3 md:px-10">
        <ProductGridList list={LISTS.homeBestSellers} items={best.items.slice(0, 4)} loading={best.loading} />
      </div>
    </section>
  )
}

function Bento() {
  const { tiles: all, ready } = useCategoryTiles()
  // The big tile goes to the category with the most styles in stock; the
  // rest keep the owner's order.
  const tiles = useMemo(() => {
    if (!all.length) return all
    const lead = all.reduce((a, b) => (b.count > a.count ? b : a), all[0])
    return [lead, ...all.filter((t) => t !== lead)]
  }, [all])
  if (!tiles.length) return null
  return (
    <section className="pt-14 md:pt-24 max-w-page mx-auto">
      <Head title="Shop by category" />
      <div className="mt-6 md:mt-8 px-3 md:px-10 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 auto-rows-[44vw] sm:auto-rows-[34vw] md:auto-rows-[19vw] lg:auto-rows-[min(17vw,300px)]">
        {tiles.map((c, i) => (
          <Link key={c.key} to={c.to} className={`group relative rounded-3xl overflow-hidden bg-gray-200 ${i === 0 ? 'row-span-2 md:col-span-2' : ''}`}>
            {ready && <Img src={c.image} alt="" sizes={i === 0 ? '(max-width: 768px) 50vw, 46vw' : '(max-width: 768px) 50vw, 23vw'} className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-[1.04]" />}
            <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
            <span className="absolute left-3 right-3 bottom-3 md:left-5 md:bottom-5 flex items-end justify-between gap-2 text-white">
              <span className="min-w-0">
                <span className={`block font-semibold tracking-[-.01em] leading-tight ${i === 0 ? 'text-[20px] md:text-[30px]' : 'text-[15px] md:text-[20px]'}`}>{c.label}</span>
                {ready && c.count > 0 && <span className="block text-[12px] md:text-[13px] text-white/80 mt-0.5">{c.count} styles</span>}
              </span>
              <span aria-hidden="true" className="shrink-0 w-8 h-8 md:w-10 md:h-10 rounded-full bg-white text-black grid place-items-center transition group-hover:rotate-45">
                <ArrowUpRight size={16} strokeWidth={1.8} />
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function PriceBlock() {
  const lowest = useLowestPrice()
  return (
    <section className="pt-14 md:pt-24 px-3 md:px-10 max-w-page mx-auto">
      <div className="relative overflow-hidden rounded-[28px] bg-black text-white px-6 py-10 md:px-14 md:py-16">
        <span aria-hidden="true" className="absolute -right-16 -top-20 w-64 h-64 md:w-96 md:h-96 rounded-full bg-brand-badge/25" />
        <span aria-hidden="true" className="absolute right-10 -bottom-24 w-40 h-40 md:w-64 md:h-64 rounded-full bg-brand-badge/15" />
        <p className="relative text-[12px] md:text-[13px] font-semibold uppercase tracking-[.2em] text-red-200">Honest prices</p>
        <p className="relative mt-3 font-semibold text-[40px] md:text-[72px] leading-[.98] tracking-[-.035em] max-w-[11ch]">
          Everything under <span className="text-red-200">₹1000</span>
        </p>
        <p className="relative mt-4 text-[15px] md:text-[18px] text-white/80">
          {lowest ? `Styles from ${inr(lowest)}, ` : ''}free delivery on every order.
        </p>
        {/* Opens the shop with the lowest prices first. */}
        <Link to="/shop?sort=low" className="relative mt-7 inline-flex items-center gap-2 h-12 px-6 rounded-full bg-white text-black text-[15px] font-semibold hover:bg-amber-50 transition">
          {lowest ? `Shop styles from ${inr(lowest)}` : 'Shop all styles'} <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>
    </section>
  )
}

function Colours() {
  const colours = useColourFamilies().slice(0, 8)
  if (colours.length < 4) return null
  return (
    <section className="pt-14 md:pt-24 max-w-page mx-auto">
      <Head title="Shop by colour" sub="Most styles come in several colours" />
      <ul className="mt-6 md:mt-8 px-3 md:px-10 grid grid-cols-4 md:grid-cols-8 gap-x-3 gap-y-5">
        {colours.map((c) => (
          <li key={c.q}>
            <Link to={`/shop?q=${encodeURIComponent(c.q)}`} className="group block text-center">
              <span className="block aspect-square rounded-[1.25rem] ring-1 ring-inset ring-black/10 transition group-hover:scale-[1.04]" style={{ background: c.hex }} aria-hidden="true" />
              <span className="block mt-2 text-[14px] font-medium leading-tight">{c.label}</span>
              <span className="block text-[12px] text-black/55">{c.count} styles</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function JustLanded({ best }) {
  const fresh = useNewArrivals(8, best.items.slice(0, 4))
  if (!fresh.loading && !fresh.items.length) return null
  return (
    <section className="pt-14 md:pt-24">
      <Head title="Just landed" sub="The newest styles in the shop" link={<Pill to="/shop">See all</Pill>} />
      <div className="mt-6 md:mt-8">
        <ProductRail list={LISTS.homeNewIn} items={fresh.items} loading={fresh.loading} />
      </div>
    </section>
  )
}

const REVIEW_WIDTH = 'w-full sm:w-[calc(50%-6px)] lg:w-[calc(33.333%-8px)]'

function Reviews() {
  const row = useRef(null)
  const { quotes, loaded } = usePublishedQuotes(row)
  const { shop } = useRatings()
  if (loaded && !quotes.length) return null
  return (
    <section ref={row} id="home-reviews" className="mt-14 md:mt-24 py-12 md:py-20 bg-gray-200 scroll-mt-24 md:scroll-mt-28">
      <div className="px-4 md:px-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <H2>Real reviews, real women</H2>
          <p className="mt-1.5 text-[14px] md:text-[16px] text-black/60">From customers across India</p>
        </div>
        {shop && (
          <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3">
            <span className="text-[34px] font-semibold tracking-[-.03em] leading-none">{ratingText(shop.average)}</span>
            <span className="leading-tight">
              <span role="img" aria-label={`Rated ${ratingText(shop.average)} out of 5`}><Stars value={shop.average} size={14} /></span>
              <span className="block text-[13px] text-black/60 mt-1">{shop.count.toLocaleString('en-IN')} reviews</span>
            </span>
          </div>
        )}
      </div>
      <div className="mt-7">
        {/* One review at a time on a phone (two on a tablet, three on a
            laptop), moving on by one every few seconds. */}
        <AutoRail label="Customer reviews">
          {quotes.length
            ? quotes.map((q) => <QuoteCard key={q.id} quote={q} width={REVIEW_WIDTH} />)
            : <QuotePlaceholders width={REVIEW_WIDTH} n={2} />}
        </AutoRail>
      </div>
      <WriteReview className="mt-7 px-4 md:px-10" buttonClass="bg-black text-white hover:bg-gray-700" />
    </section>
  )
}

function Help() {
  const ig = socialLink('Instagram')
  const wa = socialLink('WhatsApp')
  return (
    <section className="px-3 md:px-10 py-14 md:py-24 max-w-page mx-auto grid md:grid-cols-2 gap-3 md:gap-4">
      {ig && (
        <a href={ig} target="_blank" rel="noreferrer" onClick={tappedContact(ig)} className="group rounded-[28px] bg-black text-white p-6 md:p-10 flex items-start justify-between gap-4">
          <span>
            <Instagram size={26} strokeWidth={1.6} aria-hidden="true" />
            <span className="block mt-6 text-[22px] md:text-[30px] font-semibold tracking-[-.02em] leading-tight">New drops on Instagram first</span>
            <span className="block mt-2 text-[14px] md:text-[16px] text-white/75">Follow {instagramHandle()}</span>
          </span>
          <ArrowUpRight size={24} strokeWidth={1.6} aria-hidden="true" className="shrink-0 transition group-hover:rotate-45" />
        </a>
      )}
      {wa && (
        <a href={wa} target="_blank" rel="noreferrer" onClick={tappedContact(wa)} className="group rounded-[28px] bg-white ring-1 ring-black/10 p-6 md:p-10 flex items-start justify-between gap-4">
          <span>
            <MessageCircle size={26} strokeWidth={1.6} aria-hidden="true" />
            <span className="block mt-6 text-[22px] md:text-[30px] font-semibold tracking-[-.02em] leading-tight">Not sure about a size?</span>
            <span className="block mt-2 text-[14px] md:text-[16px] text-black/65">Chat with us on WhatsApp, 9 AM – 9 PM</span>
          </span>
          <ArrowUpRight size={24} strokeWidth={1.6} aria-hidden="true" className="shrink-0 transition group-hover:rotate-45" />
        </a>
      )}
    </section>
  )
}

export default function HomeModern() {
  const best = useBestsellers()
  return (
    <div className="home-b">
      <Chips />
      <Hero />
      <Promises />
      <Bestsellers best={best} />
      <Bento />
      <PriceBlock />
      <Colours />
      <JustLanded best={best} />
      <Reviews />
      <Help />
    </div>
  )
}
