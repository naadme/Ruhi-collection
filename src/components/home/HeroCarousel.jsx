// The homepage hero's photos, as a row the shopper swipes through.
//
// Same photos, order, links and framing as the old hero (src/components/
// Sections.jsx `Hero`): the owner's saved banners first, in saved order, with
// the stocked-category photos after them (src/lib/heroSlider.js), each banner
// cropped exactly as she framed it in the admin panel. What changed is how a
// shopper moves between them: on a phone they swipe, the way every shopping
// app and Instagram itself works, with dots that show where they are and can
// be tapped. Nothing moves on its own (no autoplay): an auto-advancing hero
// pulls the photo away while she is looking at it.
//
// The swipe is the browser's own scrolling (CSS scroll-snap), so there is no
// gesture code to download or run, and a tap on a photo is an ordinary link.
//
// Speed: the first photo is THE photo of the page — fetched first
// (`fetchpriority="high"`) with the very same `sizes` as the early preload in
// src/boot/earlyStart.js, so the browser keeps one download. The other photos
// are lazy: they load only as the shopper swipes towards them.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import Img from '../Img'
import { useProducts } from '../../context/ProductsContext'
import { useCategories } from '../../context/CategoriesContext'
import { fetchHomeBanners } from '../../lib/banners'
import { earlyRows } from '../../lib/earlyData'
import { HERO_PHOTO_SIZES } from '../../lib/imageSrcSet'
import { bannerPositionStyle } from '../../lib/bannerPosition'
import { heroFallbackSlides } from '../../lib/heroLinks'
import { heroSlides } from '../../lib/heroSlider'
import { stockedCategoryTiles } from '../../lib/categoryTiles'
import { newEventId, trackSafely } from '../../lib/tracking'
import { heroPromotion, productIdFromPath, promotionEvent, viewedItem } from '../../lib/trackingItems'

/** The hero's slides and whether the banner list is known yet (see the old Hero for why it waits). */
function useHeroSlides() {
  const [banners, setBanners] = useState([])
  const [bannersKnown, setBannersKnown] = useState(false)
  const { listable: products } = useProducts()
  const { categories } = useCategories()
  useEffect(() => {
    let alive = true
    const settle = () => { if (alive) setBannersKnown(true) }
    // A read that never answers must not leave the hero empty.
    const timer = setTimeout(settle, 2000)
    earlyRows('banners')
      .then((rows) => fetchHomeBanners({ rows }))
      .then((rows) => { if (alive) setBanners(rows); settle() })
      .catch(settle)
    return () => { alive = false; clearTimeout(timer) }
  }, [])
  const slides = heroSlides(banners, heroFallbackSlides(stockedCategoryTiles(categories, products), products))
  const bannerKeys = useMemo(() => new Set(banners.map((b) => String(b.id ?? b.image))), [banners])
  return { slides, bannersKnown, bannerKeys }
}

const reduceMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

/**
 * `className` sizes and shapes the frame (height or aspect ratio, corners).
 * `children` is drawn over the photos — the headline and buttons. It may be
 * a function of the photo on screen, `({ slide, index, count }) => …`, so the
 * words can follow the photo; `slide` is null until the owner's banner list
 * is known, so the words never flash a photo that is about to be replaced. It lets
 * swipes through to the photos, and its own links and buttons stay tappable
 * (give them `pointer-events-auto`). `dots` places the position dots:
 * 'bottom-right' (default) or 'bottom-center'. `tone` colours the dots for a
 * light or dark overlay.
 *
 * `progress="bars"` draws Instagram-story style bars across the top instead
 * of dots, and `autoplay` (milliseconds per photo) moves to the next photo on
 * its own (the owner's call, 21 Nov 2026). The bar filling up IS the timer —
 * the next photo comes when it is full — so the bar and the photo can never
 * disagree. It waits for the first photo to arrive, and holds still while a
 * finger or mouse is on the photos, while anything in it has keyboard focus,
 * while the hero is scrolled out of view or the tab is hidden, after the
 * shopper presses Pause, and always for anyone whose phone asks for reduced
 * motion. A swipe simply starts the next photo's bar from the beginning.
 */
export default function HeroCarousel({ className = '', style, children = null, dots = 'bottom-right', tone = 'light', arrows = true, shade = '', progress = 'dots', autoplay = 0 }) {
  const { slides, bannersKnown, bannerKeys } = useHeroSlides()
  const { getProduct, answered } = useProducts()
  const { typeLabel } = useCategories()
  const track = useRef(null)
  const [at, setAt] = useState(0)
  const n = slides.length
  // How far along the row photos may download. A browser's own lazy loading
  // counts photos to the side of a swipeable row as "near" and fetched three
  // more hero photos (~400 KB) during the first load in the lab (21 Nov 2026).
  // So only the first photo loads at first; once it has arrived, the next one
  // is fetched, and each swipe fetches one more ahead.
  const [reach, setReach] = useState(0)
  const [firstIn, setFirstIn] = useState(false)
  useEffect(() => { setReach((r) => Math.max(r, at + (firstIn ? 1 : 0))) }, [at, firstIn])

  // Auto-advance (see the comment above the component).
  const root = useRef(null)
  const [motionOk] = useState(() => !reduceMotion())
  const [paused, setPaused] = useState(false)
  const [holding, setHolding] = useState(false)
  const [onScreen, setOnScreen] = useState(true)
  useEffect(() => {
    if (!autoplay) return undefined
    const el = root.current
    const io = typeof IntersectionObserver !== 'undefined' && el
      ? new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting && document.visibilityState !== 'hidden'), { threshold: 0.4 })
      : null
    io?.observe(el)
    // Hidden tab: stop. Back again: ask the observer afresh whether the hero is in view.
    const onVis = () => {
      if (document.visibilityState === 'hidden') { setOnScreen(false); return }
      if (io && el) { io.unobserve(el); io.observe(el) } else setOnScreen(true)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => { io?.disconnect(); document.removeEventListener('visibilitychange', onVis) }
  }, [autoplay])
  const auto = autoplay > 0 && motionOk && progress === 'bars'
  const playing = auto && n > 1 && firstIn && !paused && !holding && onScreen
  // A finger on the photos holds them; lifting it (or the browser taking over
  // for a swipe) lets go. A mouse holds them while it is over the hero. Only
  // keyboard focus holds them: a tapped button keeps focus on a phone, and
  // must not freeze the photos.
  const hold = { onPointerDown: (e) => { if (e.pointerType !== 'mouse') setHolding(true) }, onPointerUp: () => setHolding(false), onPointerCancel: () => setHolding(false) }

  // Which photo is on screen, from the row's own scroll position.
  useEffect(() => {
    const el = track.current
    if (!el) return undefined
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth))
        setAt(Math.max(0, Math.min(n - 1, i)))
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame) }
  }, [n, bannersKnown])
  // A list that changes underneath (a banner arriving) starts from the first photo.
  useEffect(() => {
    setAt(0)
    if (track.current) track.current.scrollLeft = 0
  }, [bannerKeys.size])
  // A tap on a dot or arrow can jump past `reach`: let the target load.
  const goTo = (i) => setReach((r) => Math.max(r, i + 1))

  const go = (i, { wrapInstant = false } = {}) => {
    const el = track.current
    if (!el || !n) return
    const to = ((i % n) + n) % n
    goTo(to)
    // From the last photo back to the first, an automatic move jumps rather
    // than racing back past every photo.
    const jump = reduceMotion() || (wrapInstant && to === 0 && at === n - 1)
    el.scrollTo({ left: to * el.clientWidth, behavior: jump ? 'auto' : 'smooth' })
  }

  // GA4 view_promotion once per photo per visit, select_promotion on a tap —
  // exactly as the old hero reported them (src/lib/trackingItems.js).
  const promoFor = (slide, i) => (slide ? heroPromotion(slide, i, { banner: bannerKeys.has(slide.key) }) : null)
  const itemFor = (slide) => {
    const row = productIdFromPath(slide?.to)
    const product = row ? getProduct(row) : null
    return product ? viewedItem(product, row, null, { category: typeLabel(product.type) }) : null
  }
  const current = n ? slides[Math.min(at, n - 1)] : null
  const promotion = promoFor(current, at)
  const promoted = useRef(new Set())
  useEffect(() => {
    if (!promotion || !bannersKnown || !answered || promoted.current.has(promotion.id)) return
    promoted.current.add(promotion.id)
    trackSafely(() => promotionEvent('view_promotion', promotion, { eventId: newEventId(), item: itemFor(current) }))
  }, [promotion?.id, bannersKnown, answered])

  const dotWrap = {
    'bottom-center': 'left-1/2 -translate-x-1/2 bottom-4',
    'top-right': 'right-1 top-2 md:right-6 md:top-6',
  }[dots] || 'right-4 bottom-5 md:right-6 md:bottom-6'
  const dotOn = tone === 'light' ? 'bg-white' : 'bg-black'
  const dotOff = tone === 'light' ? 'bg-white/45' : 'bg-black/30'

  return (
    <div
      ref={root}
      className={`relative overflow-hidden bg-gray-200 ${className}`}
      style={style}
      onPointerEnter={auto ? (e) => { if (e.pointerType === 'mouse') setHolding(true) } : undefined}
      onPointerLeave={auto ? (e) => { if (e.pointerType === 'mouse') setHolding(false) } : undefined}
      onFocus={auto ? (e) => { if (e.target.matches?.(':focus-visible')) setHolding(true) } : undefined}
      onBlur={auto ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHolding(false) } : undefined}
    >
      <div
        ref={track}
        {...(auto ? hold : {})}
        className="absolute inset-0 flex overflow-x-auto snap-x snap-mandatory overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-roledescription="carousel"
        aria-label="Featured styles"
      >
        {bannersKnown && slides.map((slide, i) => (
          <Link
            key={slide.key}
            to={slide.to}
            onClick={() => trackSafely(() => promotionEvent('select_promotion', promoFor(slide, i), { eventId: newEventId(), item: itemFor(slide) }))}
            className="relative shrink-0 w-full h-full snap-start snap-always"
            aria-label={`${slide.label}${n > 1 ? ` (photo ${i + 1} of ${n})` : ''}`}
            tabIndex={i === at ? 0 : -1}
          >
            {i <= reach && (
              <Img
                src={slide.image}
                alt=""
                sizes={HERO_PHOTO_SIZES}
                {...(i === 0 ? { loading: 'eager', fetchpriority: 'high', onLoad: () => setFirstIn(true) } : {})}
                style={bannerPositionStyle(slide.position)}
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
          </Link>
        ))}
      </div>
      {shade && <div aria-hidden="true" className={`pointer-events-none absolute inset-0 ${shade}`} />}
      {children && (
        <div className="pointer-events-none absolute inset-0">
          {typeof children === 'function' ? children({ slide: bannersKnown ? current : null, index: at, count: n }) : children}
        </div>
      )}
      {progress === 'bars' && n > 1 && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-4 top-3 md:inset-x-7 md:top-5 flex gap-1">
          {slides.map((s, i) => (
            <span key={s.key} className="h-[3px] flex-1 rounded-full bg-white/35 overflow-hidden">
              {i === at && auto ? (
                <span
                  key={`run-${at}`}
                  className="block h-full w-full bg-white origin-left"
                  style={{ animation: `hero-bar ${autoplay}ms linear forwards`, animationPlayState: playing ? 'running' : 'paused' }}
                  onAnimationEnd={() => go(at + 1, { wrapInstant: true })}
                />
              ) : (
                <span className="block h-full w-full bg-white origin-left" style={{ transform: `scaleX(${i <= at ? 1 : 0})` }} />
              )}
            </span>
          ))}
        </div>
      )}
      {auto && n > 1 && (
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? 'Play the photos' : 'Pause the photos'}
          aria-pressed={paused}
          className="absolute right-2 top-5 md:right-5 md:top-8 w-11 h-11 grid place-items-center rounded-full"
        >
          <span className="w-8 h-8 rounded-full bg-black/35 text-white grid place-items-center">
            {paused ? <Play size={14} strokeWidth={2} fill="currentColor" aria-hidden="true" /> : <Pause size={14} strokeWidth={2} fill="currentColor" aria-hidden="true" />}
          </span>
        </button>
      )}
      {progress !== 'bars' && n > 5 && (
        <div className={`absolute ${dotWrap} flex items-center`}>
          <button type="button" onClick={() => go(at - 1)} aria-label="Previous photo" className={`md:hidden w-11 h-11 grid place-items-center rounded-full ${tone === 'light' ? 'text-white' : 'text-black'}`}>
            <ChevronLeft size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <span aria-live="polite" className={`min-w-[52px] text-center text-[12px] font-medium tabular-nums tracking-[.12em] px-2.5 h-7 grid place-items-center rounded-full ${tone === 'light' ? 'bg-black/35 text-white' : 'bg-white/70 text-black'}`}>
            {String(at + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}
          </span>
          <button type="button" onClick={() => go(at + 1)} aria-label="Next photo" className={`md:hidden w-11 h-11 grid place-items-center rounded-full ${tone === 'light' ? 'text-white' : 'text-black'}`}>
            <ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      )}
      {progress !== 'bars' && n > 1 && n <= 5 && (
        <div className={`absolute ${dotWrap} flex items-center`}>
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show photo ${i + 1} of ${n}`}
              aria-current={i === at ? 'true' : undefined}
              className="grid place-items-center w-9 h-11 rounded-full"
            >
              <span className={`block h-1.5 rounded-full transition-all duration-300 ${i === at ? `w-5 ${dotOn}` : `w-1.5 ${dotOff}`}`} />
            </button>
          ))}
        </div>
      )}
      {arrows && n > 1 && (
        <>
          <button type="button" onClick={() => go(at - 1)} aria-label="Previous photo"
            className="hidden md:grid absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/85 text-black place-items-center hover:bg-white transition">
            <ChevronLeft size={20} strokeWidth={1.6} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => go(at + 1)} aria-label="Next photo"
            className="hidden md:grid absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/85 text-black place-items-center hover:bg-white transition">
            <ChevronRight size={20} strokeWidth={1.6} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  )
}
