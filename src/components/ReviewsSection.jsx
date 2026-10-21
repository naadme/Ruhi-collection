// What customers said about this design — the public half of
// `product_reviews`, plus the write box for a customer who has actually got
// the piece in her hands.
//
// Two rules decide everything it shows:
//
//   * only `status = 'approved'` reviews are ever rendered — the database
//     hands this page nothing else, so an unpublished review cannot leak here
//     by any route;
//   * the write box appears only when `reviewable_items()` names a purchase
//     of THIS design that has not been reviewed yet. A signed-out visitor, a
//     visitor who has not bought it, and a customer who has already had her
//     say all see the same thing: the reviews, and no box.
//
// The form never asks which product it is reviewing. The server works that
// out from the order line it is given, so the page cannot be talked into
// reviewing something it did not sell.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2, Star } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { formatShopDate } from '../lib/shopTime'
import {
  REVIEW_LIMITS, normalizeReview, reviewProblem, reviewSummary, starLabel,
} from '../lib/reviews'
import { fetchReviewableItems, submitReview } from '../lib/reviewStore'

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

export default function ReviewsSection({ product, reviews = [] }) {
  const { user } = useAuth()
  const designId = product?.id || ''
  // Every colour row of the design: reviews belong to the row that was bought,
  // and a shopper reads them all as this one product.
  const ids = useMemo(() => {
    const rows = Array.isArray(product?.colors) && product.colors.length ? product.colors : [product]
    return [...new Set(rows.map((r) => r?.id).filter(Boolean))]
  }, [product])

  const [items, setItems] = useState([])
  const [itemsLoaded, setItemsLoaded] = useState(false)
  const [draft, setDraft] = useState({ orderItemId: '', rating: 0, name: '', body: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const formRef = useRef(null)

  const loadItems = useCallback(async () => {
    setItemsLoaded(false)
    if (!user || !ids.length) {
      setItems([])
      setItemsLoaded(true)
      return
    }
    try {
      const rows = await fetchReviewableItems(ids)
      setItems(rows)
      setDraft((d) => ({ ...d, orderItemId: d.orderItemId || rows[0]?.order_item_id || '' }))
    } catch (e) {
      // A failure here only withholds the write box; the reviews above are
      // read separately and must still be shown.
      setItems([])
    } finally {
      setItemsLoaded(true)
    }
  }, [user, ids])

  useEffect(() => {
    setSent(false)
    loadItems()
  }, [loadItems])

  const summary = useMemo(() => reviewSummary(reviews), [reviews])
  const problem = reviewProblem(draft)
  const canWrite = itemsLoaded && items.length > 0

  const send = async (e) => {
    e?.preventDefault?.()
    setError('')
    if (problem) return setError(problem)
    setBusy(true)
    try {
      await submitReview(draft)
      setSent(true)
      // The purchase has been used, so it must vanish from the list: another
      // review of the same parcel is impossible anyway, and the form says so
      // instead of letting her try and be refused.
      setItems((rows) => rows.filter((r) => r.order_item_id !== draft.orderItemId))
      setDraft({ orderItemId: '', rating: 0, name: draft.name, body: '' })
    } catch (err) {
      setError(err?.message || 'Your review could not be sent. Please try again.')
      if (/already reviewed/i.test(String(err?.message || ''))) loadItems()
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
                {/* Only true where a purchase really stands behind the words —
                    the column is written by the server from the order line. */}
                {r.order_item_id && (
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

      {/* The write box is offered only where there is a purchase to write
          about, and never to someone who has already reviewed it. */}
      {canWrite && (
        <div ref={formRef} className="mt-8 bg-neutral-50 border border-black/10 rounded-xl p-5">
          <h3 className="text-[16px] font-bold">Write a review</h3>

          {sent ? (
            <p className="mt-3 text-[15px] text-black/70 flex items-start gap-2">
              <Check size={18} className="text-green-700 mt-[2px] shrink-0" />
              <span>
                Thank you — your review is with the shop. It will appear on this page as soon as it
                has been approved, and you will find it under your account until then.
              </span>
            </p>
          ) : (
            <form className="mt-4 space-y-4" onSubmit={send} noValidate>
              <label className="block">
                <span className="block text-[13px] font-semibold text-black/60 mb-1.5">
                  Which of your orders is this about?
                </span>
                <select
                  value={draft.orderItemId}
                  onChange={(e) => setDraft((d) => ({ ...d, orderItemId: e.target.value }))}
                  disabled={busy}
                  className="w-full max-w-[440px] border border-black/30 rounded-lg px-3 h-[44px] text-[15px] bg-white outline-none focus:border-black focus:ring-2 focus:ring-black/10 disabled:bg-neutral-100"
                >
                  {items.map((it) => (
                    <option key={it.order_item_id} value={it.order_item_id}>
                      {it.title}{it.size ? ` · Size ${it.size}` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <span className="block text-[13px] font-semibold text-black/60 mb-1.5">Your rating</span>
                <StarPicker value={draft.rating} busy={busy} onChange={(n) => setDraft((d) => ({ ...d, rating: n }))} />
              </div>

              <label className="block max-w-[440px]">
                <span className="block text-[13px] font-semibold text-black/60 mb-1.5">Name to show</span>
                <input
                  type="text"
                  value={draft.name}
                  maxLength={REVIEW_LIMITS.MAX_NAME}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  disabled={busy}
                  placeholder="e.g. Priya S."
                  className="w-full border border-black/30 rounded-lg px-4 h-[44px] text-[15px] bg-white outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35 disabled:bg-neutral-100"
                />
              </label>

              <label className="block">
                <span className="block text-[13px] font-semibold text-black/60 mb-1.5">Your review</span>
                <textarea
                  value={draft.body}
                  rows={4}
                  maxLength={REVIEW_LIMITS.MAX_BODY}
                  onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                  disabled={busy}
                  placeholder="How does it fit, how does it wear, how did it wash?"
                  className="w-full border border-black/30 rounded-lg px-4 py-3 text-[15px] leading-relaxed bg-white outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35 resize-y disabled:bg-neutral-100"
                />
                <span className="block text-[12px] text-black/45 mt-1">
                  {draft.body.length} / {REVIEW_LIMITS.MAX_BODY} — plain text, and your own line
                  breaks are kept.
                </span>
              </label>

              {error && (
                <p className="text-[14px] text-red-700 flex items-start gap-1.5" role="alert">
                  <AlertTriangle size={16} className="mt-[2px] shrink-0" />
                  <span>{error}</span>
                </p>
              )}

              <button type="submit" disabled={busy || Boolean(problem)} className="btn inline-flex items-center gap-2 disabled:opacity-50">
                {busy && <Loader2 size={16} className="animate-spin" />}
                {busy ? 'Sending…' : 'Send my review'}
              </button>
              <p className="text-[12px] text-black/45">
                Your review is read by the shop before it appears on this page.
              </p>
            </form>
          )}
        </div>
      )}
    </section>
  )
}
