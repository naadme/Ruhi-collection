// What customers said about this design — the public half of
// `product_reviews`, plus an open "Write a review" form for anyone.
//
// Three rules decide everything it shows:
//
//   * only `status = 'approved'` reviews are ever rendered — the database
//     hands this page nothing else, so an unpublished review cannot leak here
//     by any route;
//   * anyone may write one, signed in or not. It goes to the shop as pending
//     through `submit_public_review()` and appears only once the owner has
//     approved it;
//   * "Verified purchase" is shown only where the owner has marked the review
//     verified (`verified`), after checking it against her orders. Nothing the
//     reviewer types can set it.
//
// The email, mobile and order number the form asks for go to the shop's
// private table, never onto the review, and are never shown on the site.

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, Check, Loader2, Plus, Star } from 'lucide-react'
import { formatShopDate } from '../lib/shopTime'
import {
  CONTACT_LIMITS, REVIEW_LIMITS, contactProblem, reviewProblem, reviewSummary, starLabel,
} from '../lib/reviews'
import { submitPublicReview } from '../lib/reviewStore'

/** The five stars, as buttons a keyboard and a screen reader both understand. */
function StarPicker({ value, onChange, busy }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          disabled={busy}
          onClick={() => onChange(n)}
          className="p-1 rounded transition disabled:opacity-50"
        >
          <Star
            size={26}
            strokeWidth={1.5}
            className={n <= value ? 'text-amber-500' : 'text-black/25'}
            fill={n <= value ? '#f59e0b' : 'none'}
          />
        </button>
      ))}
    </div>
  )
}

const EMPTY_DRAFT = { rating: 0, title: '', name: '', body: '', email: '', phone: '', orderRef: '', website: '' }

const fieldCls =
  'w-full border border-black/30 rounded-lg px-4 h-[44px] text-[15px] bg-white outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35 disabled:bg-neutral-100'
const labelCls = 'block text-[13px] font-semibold text-black/60 mb-1.5'

export default function ReviewsSection({ product, reviews = [] }) {
  // The review belongs to the colour row on screen; the list above it reads
  // every colour of the design.
  const productId = product?.id || ''

  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [writing, setWriting] = useState(false)

  // The product route keeps this section mounted when she opens a related
  // product or another colour, so the form starts over whenever the product
  // does: a half-written review must never be sent against the next product,
  // and a thank-you for the last one must not hide the button on this one.
  useEffect(() => {
    setSent(false)
    setWriting(false)
    setError('')
    setDraft(EMPTY_DRAFT)
  }, [productId])

  const summary = useMemo(() => reviewSummary(reviews), [reviews])
  const problem = reviewProblem(draft) || contactProblem(draft)
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }))

  const send = async (e) => {
    e?.preventDefault?.()
    setError('')
    if (problem) return setError(problem)
    setBusy(true)
    try {
      await submitPublicReview(productId, draft)
      setSent(true)
      setWriting(false)
      setDraft(EMPTY_DRAFT)
    } catch (err) {
      setError(err?.message || 'Your review could not be sent. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-10 border-t border-black/10 pt-7" aria-labelledby="reviews-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="reviews-heading" className="text-[18px] font-bold">Customer reviews</h2>
        {summary.count > 0 && (
          <p className="text-[15px] text-black/70 flex items-center gap-2">
            <span
              role="img"
              aria-label={starLabel(Math.round(summary.average * 10) / 10)}
              className="inline-flex items-center gap-1"
            >
              <Star size={16} className="text-amber-500" fill="#f59e0b" strokeWidth={0} />
              <b className="font-ui">{summary.average.toFixed(1)}</b>
            </span>
            <span className="text-black/50">
              {summary.count} review{summary.count === 1 ? '' : 's'}
            </span>
          </p>
        )}
      </div>

      {summary.count > 0 && (
        <ul className="mt-3 space-y-1 max-w-[380px]" aria-label="Ratings breakdown">
          {[5, 4, 3, 2, 1].map((star) => {
            const n = summary.distribution[star - 1]
            const pct = Math.round((n / summary.count) * 100)
            return (
              <li key={star} className="flex items-center gap-2 text-[13px] text-black/60">
                <span className="w-[46px] shrink-0">{star} star{star > 1 ? 's' : ''}</span>
                <span className="flex-1 h-[7px] rounded-full bg-black/10 overflow-hidden">
                  <span className="block h-full bg-amber-400" style={{ width: `${pct}%` }} />
                </span>
                <span className="w-[26px] text-right tabular-nums">{n}</span>
              </li>
            )
          })}
        </ul>
      )}

      {summary.count === 0 ? (
        <p className="mt-4 text-[15px] text-black/55">
          No reviews yet — the first one will appear here once the shop has approved it.
        </p>
      ) : (
        <ul className="mt-5 space-y-5">
          {reviews.map((r) => (
            <li key={r.id} className="border-b border-black/10 pb-5 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span
                  role="img"
                  aria-label={starLabel(r.rating)}
                  className="inline-flex items-center gap-[1px]"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      size={14}
                      strokeWidth={0}
                      fill={n <= Number(r.rating) ? '#f59e0b' : '#e5e5e5'}
                    />
                  ))}
                </span>
                <b className="font-ui text-[15px]">{r.customer_name}</b>
                {/* The shop's own calendar: the review was written against an
                    order whose date the same clock names. */}
                <span className="text-[13px] text-black/45">{formatShopDate(r.created_at)}</span>
                {/* Only where the owner has checked the order herself and
                    marked it so — the column is set from the admin panel and
                    nowhere else. */}
                {r.verified === true && (
                  <span className="text-[11px] font-semibold uppercase tracking-wide border border-green-300 bg-green-50 text-green-800 rounded-full px-2 py-[1px]">
                    Verified purchase
                  </span>
                )}
              </div>
              {/* Plain text with `whitespace-pre-line`: her paragraphs are her
                  own, and no markup she typed is ever interpreted. */}
              <p className="mt-2 text-[15px] leading-7 text-black/70 whitespace-pre-line">{r.body}</p>
            </li>
          ))}
        </ul>
      )}

      {/* Open to everyone. A clearly labelled button opens the form, so a
          shopper who is not ready to write is not faced with an empty form. */}
      {!writing && !sent && productId ? (
        <button
          type="button"
          onClick={() => { setError(''); setWriting(true) }}
          className="mt-8 inline-flex items-center gap-2 border border-black/40 px-5 h-[46px] rounded-lg text-[15px] font-semibold hover:bg-black hover:text-white transition"
        >
          <Plus size={16} /> Write a review
        </button>
      ) : null}

      {writing && !sent && (
        <div className="mt-6 bg-neutral-50 border border-black/10 rounded-xl p-4 sm:p-5">
          <button
            type="button"
            onClick={() => setWriting(false)}
            className="mb-3 inline-flex items-center gap-1 text-[12px] font-semibold text-black/45 hover:text-black transition"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <h3 className="text-[16px] font-bold">Write a review</h3>

          <form className="mt-4 space-y-4 max-w-[440px]" onSubmit={send} noValidate>
            <div>
              <span className={labelCls}>Your rating</span>
              <StarPicker value={draft.rating} busy={busy} onChange={(n) => setDraft((d) => ({ ...d, rating: n }))} />
            </div>

            <label className="block">
              <span className={labelCls}>Review title (optional)</span>
              <input
                type="text"
                value={draft.title}
                maxLength={REVIEW_LIMITS.MAX_TITLE}
                onChange={set('title')}
                disabled={busy}
                placeholder="e.g. Loved the fit"
                className={fieldCls}
              />
            </label>

            <label className="block">
              <span className={labelCls}>Your name (shown with your review)</span>
              <input
                type="text"
                value={draft.name}
                maxLength={REVIEW_LIMITS.MAX_NAME}
                onChange={set('name')}
                disabled={busy}
                autoComplete="name"
                placeholder="e.g. Priya S."
                className={fieldCls}
              />
            </label>

            <label className="block">
              <span className={labelCls}>Your review</span>
              <textarea
                value={draft.body}
                rows={4}
                maxLength={REVIEW_LIMITS.MAX_BODY}
                onChange={set('body')}
                disabled={busy}
                placeholder="How does it fit, how does it wear, how did it wash?"
                className="w-full border border-black/30 rounded-lg px-4 py-3 text-[15px] leading-relaxed bg-white outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35 resize-y disabled:bg-neutral-100"
              />
              <span className="block text-[12px] text-black/45 mt-1">
                {draft.body.length} / {REVIEW_LIMITS.MAX_BODY}
              </span>
            </label>

            {/* The shop checks the order with these. They are kept apart from
                the review and never appear on the site. */}
            <fieldset className="space-y-3 border-t border-black/10 pt-4">
              <legend className="text-[13px] font-semibold text-black/60">Email or mobile number</legend>
              <p className="text-[12px] text-black/50 -mt-1">
                Private: only used by the shop to check your order, never shown.
              </p>
              <input
                type="email"
                value={draft.email}
                maxLength={CONTACT_LIMITS.MAX_EMAIL}
                onChange={set('email')}
                disabled={busy}
                autoComplete="email"
                aria-label="Email (private)"
                placeholder="Email"
                className={fieldCls}
              />
              <input
                type="tel"
                inputMode="tel"
                value={draft.phone}
                onChange={set('phone')}
                disabled={busy}
                autoComplete="tel"
                aria-label="Mobile number (private)"
                placeholder="Mobile number"
                className={fieldCls}
              />
              <label className="block">
                <span className={labelCls}>Order number (optional, private)</span>
                <input
                  type="text"
                  value={draft.orderRef}
                  maxLength={CONTACT_LIMITS.MAX_ORDER_REF}
                  onChange={set('orderRef')}
                  disabled={busy}
                  placeholder="e.g. 01102601"
                  className={fieldCls}
                />
              </label>
            </fieldset>

            {/* A field no person sees or reaches with the keyboard. A bot that
                fills in every box fills this one too, and the server then
                quietly stores nothing. */}
            <div aria-hidden="true" className="absolute -left-[10000px] w-px h-px overflow-hidden">
              <label>
                Website
                <input type="text" name="website" tabIndex={-1} autoComplete="off" value={draft.website} onChange={set('website')} />
              </label>
            </div>

            {error && (
              <p className="text-[14px] text-red-700 flex items-start gap-1.5" role="alert">
                <AlertTriangle size={16} className="mt-[2px] shrink-0" />
                <span>{error}</span>
              </p>
            )}

            {/* Not greyed out while something is missing: pressing it says
                what is missing, which a disabled button cannot. */}
            <button
              type="submit"
              disabled={busy}
              className="w-full sm:w-auto h-[48px] px-6 rounded-lg bg-brand-cta text-white text-[15px] font-semibold inline-flex items-center justify-center gap-2 hover:bg-brand-cta-hover transition disabled:opacity-50"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              {busy ? 'Sending…' : 'Send my review'}
            </button>
            <p className="text-[12px] text-black/45">
              Your review is read by the shop before it appears on this page.
            </p>
          </form>
        </div>
      )}

      {sent && (
        <p className="mt-8 text-[15px] text-black/70 flex items-start gap-2" role="status">
          <Check size={18} className="text-green-700 mt-[2px] shrink-0" />
          <span>Thank you. Your review will appear once the shop has checked it.</span>
        </p>
      )}
    </section>
  )
}
