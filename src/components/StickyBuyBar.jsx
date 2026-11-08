import { useEffect } from 'react'
import { inr } from '../lib/pricing'
import { Stars } from './Stars'
import { ratingAria, ratingText } from '../lib/ratingSummary'

// The product page's buy bar on phones: the price and one button, fixed to the
// bottom of the screen while the page's own Add to cart / Buy it now buttons
// are out of view — on arrival from an ad they sit well below the photo.
// Under the price, the design's published rating; tapping it opens the reviews.
//
// While a page has the bar (`enabled`), the body gets room for it at its very
// end (index.css, `has-buy-bar`), so the footer's last links are never under it.
export default function StickyBuyBar({ enabled, visible, price, compare, rating, onRating, needsSize, onChooseSize, onAdd }) {
  useEffect(() => {
    if (!enabled) return undefined
    document.body.classList.add('has-buy-bar')
    return () => document.body.classList.remove('has-buy-bar')
  }, [enabled])

  if (!enabled || !visible) return null
  return (
    <div
      className="md:hidden fixed inset-x-0 bottom-0 z-30 bg-white border-t border-black/10 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="h-[4.5rem] px-4 flex items-center gap-4">
        <div className="font-ui leading-tight min-w-0">
          <p className="flex items-baseline gap-2">
            <span className="font-bold text-[20px] text-black">{inr(price)}</span>
            {compare > price && <s className="text-[13px] text-black/50">{inr(compare)}</s>}
          </p>
          {rating && (
            <button
              type="button"
              onClick={onRating}
              aria-label={`${ratingAria(rating)}. Read the reviews`}
              className="-ml-1 mt-0.5 px-1 py-1 inline-flex items-center gap-1.5 text-[13px] text-black/65 rounded"
            >
              <Stars value={rating.average} size={13} />
              <b className="font-semibold text-black/80">{ratingText(rating.average)}</b>
              <span>({rating.count})</span>
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={needsSize ? onChooseSize : onAdd}
          className="ml-auto h-12 px-6 min-w-[9.5rem] rounded-lg bg-brand-cta text-white text-[16px] font-semibold hover:bg-brand-cta-hover transition"
        >
          {needsSize ? 'Choose size' : 'Add to cart'}
        </button>
      </div>
    </div>
  )
}
