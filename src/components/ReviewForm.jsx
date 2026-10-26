// A self-contained review writing form.
//
// It can be placed anywhere a customer can write a review:
//   * the homepage — the customer picks which of their purchases to review;
//   * the order confirmation page — the purchased item is pre-selected.
//
// The customer must be signed in: reviews are tied to the account that bought
// the item, and `submit_review()` enforces ownership on the server. A review
// always lands as `pending` and only appears publicly after an admin approves
// it from the admin Reviews panel.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Check, Loader2, Plus, Star } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useProducts } from '../context/ProductsContext'
import {
  REVIEW_LIMITS, normalizeReview, reviewProblem, starLabel,
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

export default function ReviewForm({ initialOrderItemId, onSent }) {
  const { user } = useAuth()
  const { products } = useProducts()

  // Every product in the catalogue: the homepage uses this to ask which of the
  // customer's purchases across all products are still unreviewed.
  const allProductIds = useMemo(
    () => [...new Set(products.map((p) => p?.id).filter(Boolean))],
    [products],
  )

  const [items, setItems] = useState([])
  const [itemsLoaded, setItemsLoaded] = useState(false)
  const [draft, setDraft] = useState({
    orderItemId: initialOrderItemId || '',
    rating: 0,
    title: '',
    name: '',
    body: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [writing, setWriting] = useState(!!initialOrderItemId)
  const formRef = useRef(null)

  const loadItems = useCallback(async () => {
    setItemsLoaded(false)
    if (!user) {
      setItemsLoaded(true)
      return
    }
    // When an item is pre-selected (order confirmation page), skip the fetch
    // and show the form directly. submit_review() will validate ownership.
    if (initialOrderItemId) {
      setItems([{ order_item_id: initialOrderItemId, title: '', size: '' }])
      setDraft((d) => ({ ...d, orderItemId: initialOrderItemId }))
      setItemsLoaded(true)
      return
    }
    try {
      const rows = await fetchReviewableItems(allProductIds)
      setItems(rows)
      if (rows.length > 0 && !draft.orderItemId) {
        setDraft((d) => ({ ...d, orderItemId: rows[0].order_item_id }))
      }
    } catch {
      setItems([])
    } finally {
      setItemsLoaded(true)
    }
  }, [user, initialOrderItemId, allProductIds])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  const problem = reviewProblem(draft)

  const send = async (e) => {
    e?.preventDefault?.()
    setError('')
    if (problem) return setError(problem)
    if (!draft.orderItemId) {
      return setError('Choose which of your orders you are reviewing.')
    }
    setBusy(true)
    try {
      await submitReview(draft)
      setSent(true)
      setWriting(false)
      onSent?.()
    } catch (err) {
      setError(err?.message || 'Your review could not be sent. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // Not signed in — prompt to sign in first.
  if (!user) {
    return (
      <div ref={formRef} className="mt-8 text-center">
        <p className="text-[15px] text-black/60">
          Please <a href="/account" className="underline hover:text-black">sign in</a> to write a review.
        </p>
      </div>
    )
  }

  // Signed in but nothing to review.
  if (itemsLoaded && items.length === 0) {
    return (
      <div ref={formRef} className="mt-8 text-center">
        <p className="text-[15px] text-black/60">
          You haven't purchased anything that's waiting for a review yet.
        </p>
      </div>
    )
  }

  return (
    <div ref={formRef}>
      {!writing && !sent && (
        <button
          type="button"
          onClick={() => setWriting(true)}
          className="mt-8 inline-flex items-center gap-2 border border-black/40 px-5 h-[46px] rounded-lg text-[15px] font-semibold hover:bg-black hover:text-white transition"
        >
          <Plus size={16} /> Add Review
        </button>
      )}

      {writing && !sent && (
        <form className="mt-6 space-y-4" onSubmit={send} noValidate>
          <button
            type="button"
            onClick={() => setWriting(false)}
            className="mb-3 inline-flex items-center gap-1 text-[12px] font-semibold text-black/45 hover:text-black transition"
          >
            <ArrowLeft size={14} /> Back
          </button>

          {items.length > 1 ? (
            <label className="block">
              <span className="block text-[13px] font-semibold text-black/60 mb-1.5">
                Which order are you reviewing?
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
          ) : null}

          <div>
            <span className="block text-[13px] font-semibold text-black/60 mb-1.5">Your rating</span>
            <StarPicker value={draft.rating} busy={busy} onChange={(n) => setDraft((d) => ({ ...d, rating: n }))} />
          </div>

          <label className="block max-w-[440px]">
            <span className="block text-[13px] font-semibold text-black/60 mb-1.5">Review title (optional)</span>
            <input
              type="text"
              value={draft.title}
              maxLength={REVIEW_LIMITS.MAX_TITLE}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              disabled={busy}
              placeholder="e.g. Loved the fit"
              className="w-full border border-black/30 rounded-lg px-4 h-[44px] text-[15px] bg-white outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35 disabled:bg-neutral-100"
            />
            <span className="block text-[12px] text-black/45 mt-1">
              A short headline to show above your review.
            </span>
          </label>

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
              {draft.body.length} / {REVIEW_LIMITS.MAX_BODY} — plain text, and your own line breaks are kept.
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
            Your review is read by the shop before it appears on the site.
          </p>
        </form>
      )}

      {sent && (
        <p className="mt-8 text-[15px] text-black/70 flex items-start gap-2">
          <Check size={18} className="text-green-700 mt-[2px] shrink-0" />
          <span>
            Thank you — your review is with the shop. It will appear on the site as soon as it
            has been approved.
          </span>
        </p>
      )}
    </div>
  )
}
