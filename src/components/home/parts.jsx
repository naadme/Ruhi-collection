// Small pieces both homepage designs use.
import { Children, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Check, PenLine } from 'lucide-react'
import Img from '../Img'
import ReviewForm from '../ReviewForm'
import ProductCard from '../ProductCard'
import ItemList from '../ItemList'
import { Stars } from '../Stars'
import { inr } from '../../lib/pricing'
import { productHref } from '../../lib/productLinks'
import { site } from '../../data/site'
import { newEventId, trackSafely } from '../../lib/tracking'
import { contactEvent } from '../../lib/trackingItems'

/**
 * A row that scrolls sideways — swiped on a phone, with arrow buttons from
 * `md` up once there is more than fits. Plain CSS scroll-snap: no carousel
 * library, no work on the phone until she swipes. The next card always peeks
 * in at the edge, which is what tells a shopper the row moves.
 * `bleed` lets the row run to the screen edges on a phone while its first
 * card still lines up with the page's text.
 */
export function Rail({ children, className = '', gap = 'gap-3', label, arrowTone = 'light' }) {
  const track = useRef(null)
  const [ends, setEnds] = useState({ start: true, end: true })
  useEffect(() => {
    const el = track.current
    if (!el) return undefined
    const measure = () => setEnds({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 })
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => { el.removeEventListener('scroll', measure); ro?.disconnect() }
  }, [Children.count(children)])
  const step = (d) => {
    const el = track.current
    if (el) el.scrollBy({ left: d * el.clientWidth * 0.8, behavior: 'smooth' })
  }
  const btn = arrowTone === 'dark'
    ? 'bg-white text-black hover:bg-white'
    : 'bg-black text-white hover:bg-gray-700'
  return (
    <div className="relative">
      <div
        ref={track}
        role="group"
        aria-label={label}
        className={`flex ${gap} overflow-x-auto snap-x snap-mandatory scroll-px-4 md:scroll-px-10 px-4 md:px-10 pb-1 overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      >
        {children}
      </div>
      {!ends.start && (
        <button type="button" onClick={() => step(-1)} aria-label="Scroll back"
          className={`hidden md:grid absolute left-3 top-[38%] -translate-y-1/2 w-11 h-11 rounded-full place-items-center shadow-lg transition ${btn}`}>
          <ChevronLeft size={20} strokeWidth={1.6} aria-hidden="true" />
        </button>
      )}
      {!ends.end && (
        <button type="button" onClick={() => step(1)} aria-label="Scroll forward"
          className={`hidden md:grid absolute right-3 top-[38%] -translate-y-1/2 w-11 h-11 rounded-full place-items-center shadow-lg transition ${btn}`}>
          <ChevronRight size={20} strokeWidth={1.6} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/**
 * A row that moves on by one card at a time on its own — the homepage reviews
 * (the owner's call, 21 Nov 2026) — and can still be swiped. Like the hero it
 * holds still while a finger, mouse or keyboard focus is on it, while it is
 * out of view or the tab is hidden, and always for reduced motion; a swipe
 * restarts the wait. After the last card it goes back to the first. The dots
 * underneath only show where the row is (the row itself is what to swipe).
 */
export function AutoRail({ children, label, ms = 4500, gap = 'gap-3' }) {
  const track = useRef(null)
  const count = Children.count(children)
  const [at, setAt] = useState(0)
  const [motionOk] = useState(() => !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches))
  const [holding, setHolding] = useState(false)
  const [onScreen, setOnScreen] = useState(false)
  // Which card is first in view, from the row's own scroll position.
  useEffect(() => {
    const el = track.current
    if (!el) return undefined
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0
        let best = 0
        let dist = Infinity
        Array.from(el.children).forEach((kid, i) => {
          const d = Math.abs(kid.offsetLeft - pad - el.scrollLeft)
          if (d < dist) { dist = d; best = i }
        })
        setAt(best)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame) }
  }, [count])
  // In view, and the tab is showing.
  useEffect(() => {
    const el = track.current
    if (!el || typeof IntersectionObserver === 'undefined') { setOnScreen(true); return undefined }
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting && document.visibilityState !== 'hidden'), { threshold: 0.5 })
    io.observe(el)
    const onVis = () => {
      if (document.visibilityState === 'hidden') { setOnScreen(false); return }
      io.unobserve(el); io.observe(el)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', onVis) }
  }, [])
  // The next card, after a pause on this one.
  useEffect(() => {
    if (!motionOk || holding || !onScreen || count < 2) return undefined
    const t = setTimeout(() => {
      const el = track.current
      if (!el) return
      const kids = el.children
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8
      const next = atEnd ? 0 : Math.min(count - 1, at + 1)
      const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0
      el.scrollTo({ left: kids[next].offsetLeft - pad, behavior: 'smooth' })
    }, ms)
    return () => clearTimeout(t)
  }, [at, holding, onScreen, count, motionOk, ms])
  return (
    <div
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHolding(true) }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHolding(false) }}
      onFocus={(e) => { if (e.target.matches?.(':focus-visible')) setHolding(true) }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHolding(false) }}
    >
      <div
        ref={track}
        role="group"
        aria-label={label}
        onPointerDown={(e) => { if (e.pointerType !== 'mouse') setHolding(true) }}
        onPointerUp={() => setHolding(false)}
        onPointerCancel={() => setHolding(false)}
        className={`relative flex ${gap} overflow-x-auto snap-x snap-mandatory scroll-px-4 md:scroll-px-10 px-4 md:px-10 pb-1 overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
      >
        {children}
      </div>
      {count > 1 && (
        <div aria-hidden="true" className="mt-4 flex justify-center gap-1.5">
          {Array.from({ length: count }, (_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === at ? 'w-5 bg-black' : 'w-1.5 bg-black/25'}`} />
          ))}
        </div>
      )}
    </div>
  )
}

/** A product rail: ProductCards in a Rail, reported to GA4 as one list. */
export function ProductRail({ list, items, loading, cardClass = 'w-[44vw] max-w-[280px] sm:w-[31vw] lg:w-[23%]' }) {
  if (loading) {
    return (
      <Rail label={list.name}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} aria-hidden="true" className={`shrink-0 snap-start animate-pulse ${cardClass}`}>
            <div className="aspect-[3/4] bg-gray-200 rounded-xl" />
            <div className="h-4 bg-gray-200 rounded mt-3 w-5/6" />
            <div className="h-4 bg-gray-200 rounded mt-2 w-1/3" />
          </div>
        ))}
      </Rail>
    )
  }
  if (!items.length) return null
  return (
    <ItemList list={list} products={items}>
      <Rail label={list.name}>
        {items.map((p) => (
          <div key={p.id} className={`shrink-0 snap-start home-card ${cardClass}`}>
            <ProductCard product={p} />
          </div>
        ))}
      </Rail>
    </ItemList>
  )
}

/** A product grid (2 across on a phone, 4 from `lg`), reported to GA4 as one list. */
export function ProductGridList({ list, items, loading, cols = 'grid-cols-2 lg:grid-cols-4' }) {
  if (loading) {
    return (
      <div className={`grid ${cols} gap-x-3 gap-y-7`} aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse">
            <div className="aspect-[3/4] bg-gray-200 rounded-xl" />
            <div className="h-4 bg-gray-200 rounded mt-3 w-5/6" />
          </div>
        ))}
      </div>
    )
  }
  if (!items.length) return null
  return (
    <ItemList list={list} products={items}>
      <div className={`grid ${cols} gap-x-3 gap-y-7`}>
        {items.map((p) => <div key={p.id} className="home-card"><ProductCard product={p} /></div>)}
      </div>
    </ItemList>
  )
}

/** One published review as a card: stars, words, who wrote it, and the product it is about. */
export function QuoteCard({ quote, dark = false, width = 'w-[78vw] max-w-[340px]' }) {
  const href = productHref(quote.product)
  const name = String(quote.customer_name || '').trim() || 'Verified buyer'
  const where = String(quote.reviewer_city || '').trim()
  const title = quote.design?.title || quote.product.title
  return (
    <figure className={`shrink-0 snap-start ${width} rounded-2xl p-5 flex flex-col ${dark ? 'bg-white text-black' : 'bg-white text-black ring-1 ring-black/5'}`}>
      <span role="img" aria-label="Rated 5 out of 5"><Stars value={5} size={14} /></span>
      {quote.title && <p className="mt-3 text-[16px] font-medium leading-snug">{quote.title}</p>}
      <blockquote className="mt-1.5 text-[15px] leading-[1.55] text-black/75 line-clamp-4">{quote.body}</blockquote>
      <figcaption className="mt-auto pt-4 text-[13px] text-black/60">
        <span className="font-medium text-black/85">{name}</span>{where ? ` · ${where}` : ''}
        {quote.verified && <span className="ml-1.5 inline-flex items-center gap-0.5 text-gray-700"><Check size={12} strokeWidth={2.4} aria-hidden="true" />Verified</span>}
      </figcaption>
      {href && (
        <Link to={href} className="mt-3 flex items-center gap-3 border-t border-black/10 pt-3 group">
          <Img src={quote.product.image} alt="" sizes="44px" className="w-11 h-11 rounded-lg object-cover shrink-0" />
          <span className="min-w-0">
            <span className="block text-[14px] leading-tight truncate group-hover:underline underline-offset-2">{title}</span>
            {quote.product.price > 0 && <span className="block text-[13px] font-semibold text-brand-cta mt-0.5">{inr(quote.product.price)}</span>}
          </span>
        </Link>
      )}
    </figure>
  )
}

/** Placeholder cards while the reviews row has not loaded, so the row never jumps. */
export function QuotePlaceholders({ n = 3, width = 'w-[78vw] max-w-[340px]' }) {
  return Array.from({ length: n }, (_, i) => (
    <div key={i} aria-hidden="true" className={`shrink-0 snap-start ${width} h-[262px] rounded-2xl bg-white/70 animate-pulse`} />
  ))
}

/** "Write a review" — opens the shop's own review form in place, as the old homepage did. */
export function WriteReview({ className = '', buttonClass = '' }) {
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)
  if (sent) {
    return (
      <p className={`text-[14px] flex items-start gap-2 ${className}`}>
        <Check size={18} className="mt-[1px] shrink-0" aria-hidden="true" />
        <span>Thank you — your review is with the shop. It will appear here once it has been approved.</span>
      </p>
    )
  }
  if (open) return <div className={className}><ReviewForm onSent={() => { setOpen(false); setSent(true) }} /></div>
  return (
    <div className={className}>
      <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center gap-2 h-11 px-5 rounded-full text-[14px] font-medium transition ${buttonClass}`}>
        <PenLine size={16} strokeWidth={1.8} aria-hidden="true" /> Write a review
      </button>
    </div>
  )
}

/** The Instagram and WhatsApp addresses, from src/data/site.js (one source for the whole site). */
export const socialLink = (label) => site.social.find((s) => s.label === label)?.href || ''

/** Report a tap on a contact link to GA4 (`contact`), as the old homepage strip did. */
export const tappedContact = (href, location = 'home_contact') => () =>
  trackSafely(() => contactEvent(href, { location, eventId: newEventId() }))

/** The Instagram handle shown in the copy, read from the profile address. */
export const instagramHandle = () => {
  const m = /instagram\.com\/([^/?#]+)/.exec(socialLink('Instagram'))
  return m ? `@${m[1]}` : '@ruhi'
}
