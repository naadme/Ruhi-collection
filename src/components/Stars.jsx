// The star ratings the storefront draws, in one place so every touchpoint —
// card, product photo, title, buy bar, cart, checkout — looks and reads the
// same. Numbers come from src/lib/ratingSummary.js (published reviews only).

import { Star } from 'lucide-react'
import { useRatings } from '../context/RatingsContext'
import { ratingAria, ratingText, reviewCountText, shortCount, starFills } from '../lib/ratingSummary'

/** The colour of a filled star — the same amber the review list uses. */
export const STAR_FILL = '#f59e0b'
const STAR_EMPTY = '#e5e5e5'

/** Five stars, filled to the tenth of a star. Decorative: the caller's label
 *  says the rating in words. */
export function Stars({ value, size = 14, className = '' }) {
  return (
    <span aria-hidden="true" className={`inline-flex items-center gap-[1px] align-middle ${className}`}>
      {starFills(value).map((fill, i) => (
        <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
          <Star size={size} strokeWidth={0} fill={STAR_EMPTY} className="absolute inset-0" />
          {fill > 0 && (
            <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star size={size} strokeWidth={0} fill={STAR_FILL} />
            </span>
          )}
        </span>
      ))}
    </span>
  )
}

/**
 * The compact "4.8 ★ | 12" badge that sits on a product photo — the way Indian
 * shopping apps show a rating on a picture. With `onClick` it is a button (the
 * product page uses it to jump to the reviews).
 */
export function RatingPill({ rating, onClick, large = false, className = '' }) {
  if (!rating) return null
  const body = (
    <>
      <b className="font-semibold">{ratingText(rating.average)}</b>
      <Star size={large ? 13 : 11} strokeWidth={0} fill={STAR_FILL} aria-hidden="true" />
      <span className="text-black/25" aria-hidden="true">|</span>
      <span className="text-black/65">{shortCount(rating.count)}</span>
    </>
  )
  const cls = `inline-flex items-center gap-1 bg-white/90 rounded-md leading-none font-ui text-black/85 shadow-sm ${large ? 'px-2.5 py-1.5 text-[14px]' : 'px-2 py-[3px] text-[12px]'} ${className}`
  return onClick ? (
    <button type="button" onClick={onClick} aria-label={`${ratingAria(rating)}. Read the reviews`} className={`${cls} hover:bg-white transition`}>
      {body}
    </button>
  ) : (
    <span role="img" aria-label={ratingAria(rating)} className={cls}>{body}</span>
  )
}

/**
 * Stars, the average and the review count on one line — under the product
 * title, and beside the buy buttons. With `onClick` the count is a link-style
 * button that jumps to the reviews.
 */
export function RatingLine({ rating, onClick, size = 15, className = '' }) {
  if (!rating) return null
  return (
    <p className={`font-ui flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-black/70 ${className}`}>
      <span role="img" aria-label={ratingAria(rating)} className="inline-flex items-center gap-1.5">
        <Stars value={rating.average} size={size} />
        <b className="font-semibold text-black/85">{ratingText(rating.average)}</b>
      </span>
      {onClick ? (
        <button type="button" onClick={onClick} className="underline underline-offset-2 decoration-black/30 hover:text-black hover:decoration-black transition">
          {reviewCountText(rating.count)}
        </button>
      ) : (
        <span className="text-black/55">({reviewCountText(rating.count)})</span>
      )}
    </p>
  )
}

/**
 * The shop's own rating, beside a checkout button: what every published review
 * across the shop averages out to. Draws nothing until there is one.
 */
export function ShopRatingNote({ className = '', align = 'center' }) {
  const { shop } = useRatings()
  if (!shop) return null
  return (
    <p className={`flex items-center ${align === 'start' ? 'justify-start' : 'justify-center'} gap-1.5 text-[13px] text-black/60 ${className}`}>
      <span role="img" aria-label={ratingAria(shop)} className="inline-flex items-center gap-1.5">
        <Stars value={shop.average} size={13} />
        <b className="font-ui font-semibold text-black/80">{ratingText(shop.average)}</b>
      </span>
      <span aria-hidden="true">from {shop.count.toLocaleString('en-IN')} customer review{shop.count === 1 ? '' : 's'}</span>
    </p>
  )
}
