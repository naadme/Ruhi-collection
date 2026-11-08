// One customer's words, right under the product page's Add to cart and Buy it
// now — where a shopper hesitates. The review is chosen by highlightReview()
// (src/lib/ratingSummary.js) from the design's PUBLISHED reviews: the highest
// rating, a "Verified purchase" one when the owner has marked any, short enough
// to read in a glance. The link opens every review further down the page.

import { useMemo } from 'react'
import { BadgeCheck, ChevronRight } from 'lucide-react'
import { Stars } from './Stars'
import { highlightReview, quoteText, reviewCountText } from '../lib/ratingSummary'
import { reviewerLabel, starLabel } from '../lib/reviews'

/** "Priya, Hyderabad" — the name the review is shown under, with the city when
 *  the label does not already carry it ("Shopper from Hyderabad"). */
export function quoteAuthor(review) {
  const who = reviewerLabel(review)
  const city = String(review?.reviewer_city ?? '').trim()
  return city && !who.name.includes(city) ? `${who.name}, ${city}` : who.name
}

export default function ReviewHighlight({ reviews, count, onSeeAll }) {
  const review = useMemo(() => highlightReview(reviews), [reviews])
  if (!review) return null
  const title = String(review.title ?? '').trim()
  return (
    <figure className="mt-6 rounded-xl border border-black/10 bg-[#FBF5F0] px-4 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span role="img" aria-label={starLabel(review.rating)}>
          <Stars value={review.rating} size={14} />
        </span>
        {title && <b className="font-ui text-[15px] text-black/85">{title}</b>}
      </div>
      <blockquote className="mt-1.5 text-[15px] leading-6 text-black/75 line-clamp-3">
        “{quoteText(review.body)}”
      </blockquote>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-black/55">
        <span>— {quoteAuthor(review)}</span>
        {review.verified === true && (
          <span className="inline-flex items-center gap-1 text-green-800">
            <BadgeCheck size={14} aria-hidden="true" /> Verified purchase
          </span>
        )}
      </figcaption>
      {count > 1 && onSeeAll && (
        <button
          type="button"
          onClick={onSeeAll}
          className="mt-3 inline-flex items-center gap-0.5 text-[14px] font-semibold text-black/80 underline underline-offset-2 decoration-black/30 hover:decoration-black transition"
        >
          Read all {reviewCountText(count)} <ChevronRight size={15} aria-hidden="true" />
        </button>
      )}
    </figure>
  )
}
