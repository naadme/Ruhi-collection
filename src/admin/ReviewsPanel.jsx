// Review moderation — the admin-only surface behind the "Reviews" section of
// the dashboard.
//
// A review written by a customer arrives as `pending` and appears on no
// product page until it is approved from here. The three decisions the
// database allows (supabase/migrations/20261021170000_product_reviews.sql)
// are exactly the three this panel offers, and nothing else:
//
//   * Approve      → published on the product page, under her name;
//   * Reject       → withheld, and it stays on the books so the decision is
//                    never a mystery;
//   * Unpublish    → a published review taken back off the site and returned
//                    to the queue — a retraction is as possible as a
//                    publication, which is the point of moderation.
//
// Every button writes the `status` column through the table's admin-only
// policy. The panel does not decide who may press it (the policy does), and
// it does not cache a verdict: each row is re-read from the database, so two
// admins cannot approve over each other without seeing it.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Ban, Check, EyeOff, Loader2, RefreshCw, Search, Star } from 'lucide-react'
import { fetchAllReviews, setReviewStatus } from '../lib/reviewStore'
import { homepageReviews, isSiteReview } from '../lib/siteReviews'
import { MODERATION_FILTERS, moderationCopy, starLabel } from '../lib/reviews'
import { formatShopDate } from '../lib/shopTime'

const inputCls =
  'w-full border border-black/30 rounded-lg px-4 h-[44px] text-[14px] bg-white outline-none focus:border-black focus:ring-2 focus:ring-black/10 placeholder:text-black/35'

/** Approve / Reject / Unpublish — only the ones this state allows. */
function Actions({ review, busy, onDecide }) {
  const status = review.status
  const btn = (label, icon, tone, next) => (
    <button
      type="button"
      key={label}
      disabled={busy}
      onClick={() => onDecide(review, next)}
      className={`inline-flex items-center gap-1.5 h-[34px] px-3 rounded-lg text-[13px] font-semibold border transition disabled:opacity-60 ${
        tone === 'go'
          ? 'border-green-300 bg-green-50 text-green-800 hover:bg-green-100'
          : tone === 'warn'
            ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
            : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
      }`}
    >
      {icon}
      {label}
    </button>
  )

  if (status === 'pending') {
    return (
      <>
        {btn('Approve', <Check size={14} />, 'go', 'approved')}
        {btn('Reject', <Ban size={14} />, 'no', 'rejected')}
      </>
    )
  }
  if (status === 'approved') {
    return (
      <>
        {/* Back into the queue rather than straight to rejected: the owner may
            only mean "not yet". */}
        {btn('Unpublish', <EyeOff size={14} />, 'warn', 'pending')}
        {btn('Reject', <Ban size={14} />, 'no', 'rejected')}
      </>
    )
  }
  // Rejected: it can be brought back to life, and either published straight
  // away or put in the queue for a second look.
  return (
    <>
      {btn('Approve', <Check size={14} />, 'go', 'approved')}
      {btn('Back to queue', <RefreshCw size={14} />, 'warn', 'pending')}
    </>
  )
}

export default function ReviewsPanel({ notify, products = [] }) {
  const [state, setState] = useState({ loading: true, reviews: [], error: '' })
  const [status, setStatus] = useState('all')
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const rows = await fetchAllReviews()
      // The homepage's own testimonials come first: they are the reviews a
      // visitor sees before she opens a product, so they are the ones the
      // client looks for when she opens this panel. They are read from the
      // same copy the homepage reads (src/lib/siteReviews.js) and are never
      // written to the database — shown here, not stored twice.
      setState({ loading: false, reviews: [...homepageReviews(), ...rows], error: '' })
    } catch (e) {
      // Even a failed read must not hide the reviews that are on the site
      // right now — those do not come from the database.
      setState({
        loading: false,
        reviews: homepageReviews(),
        error: e?.message || 'The reviews could not be loaded.',
      })
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Product titles and photographs, by the row id the review carries. A
  // product deleted since the review was written simply has no line here —
  // the review still shows, with the facts it was written with.
  const byProduct = useMemo(() => {
    const map = new Map()
    for (const row of Array.isArray(products) ? products : []) {
      if (row?.id && !map.has(row.id)) map.set(row.id, row)
    }
    return map
  }, [products])

  const counts = useMemo(() => {
    const out = { all: state.reviews.length, pending: 0, approved: 0, rejected: 0 }
    for (const r of state.reviews) if (out[r.status] !== undefined) out[r.status] += 1
    return out
  }, [state.reviews])

  // How many of what is listed is the site's own homepage copy, so the
  // client is never left wondering why the same four names sit at the top
  // with nothing to approve.
  const siteCount = useMemo(() => state.reviews.filter(isSiteReview).length, [state.reviews])

  const shown = useMemo(() => {
    const needle = String(query || '').trim().toLowerCase()
    return state.reviews.filter((r) => {
      if (status !== 'all' && r.status !== status) return false
      if (!needle) return true
      const product = byProduct.get(r.product_id)
      return [r.customer_name, r.body, product?.title, product?.id]
        .filter(Boolean).join(' ').toLowerCase().includes(needle)
    })
  }, [state.reviews, status, query, byProduct])

  const decide = async (review, next) => {
    setBusyId(review.id)
    try {
      const saved = await setReviewStatus(review, next)
      setState((s) => ({
        ...s,
        reviews: s.reviews.map((r) => (r.id === review.id ? { ...r, status: saved.status } : r)),
      }))
      const word = { approved: 'published on the product page', pending: 'back in the queue', rejected: 'rejected' }[next]
      notify?.('success', `“${review.customer_name}”'s review is now ${word}.`)
    } catch (e) {
      notify?.('error', e?.message || 'That change could not be saved.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] md:text-[40px] font-bold tracking-tight leading-none">Reviews</h1>
          <p className="text-black/55 mt-2 text-[15px]">
            {counts.all
              ? `${counts.pending} waiting for you · ${counts.approved} published · ${counts.rejected} rejected`
              : 'Nothing has been written yet.'}
          </p>
          {siteCount > 0 && (
            <p className="text-black/45 mt-1 text-[14px]">
              {siteCount} homepage {siteCount === 1 ? 'testimonial is' : 'testimonials are'} listed first — they
              are always on the site. Customer reviews follow below.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={state.loading}
          className="inline-flex items-center gap-2 h-[46px] px-5 rounded-lg border border-black/40 text-[15px] font-semibold hover:bg-black hover:text-white transition disabled:opacity-60"
        >
          {state.loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Reload
        </button>
      </div>

      {state.error && (
        <div className="mt-6 flex items-start gap-3 border border-amber-200 bg-amber-50 text-amber-900 rounded-xl px-4 py-3 text-[14px]">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span className="min-w-0">{state.error}</span>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold uppercase tracking-wider text-black/45">Show</span>
          <div role="group" aria-label="Review status" className="flex items-center gap-1 bg-white border border-black/15 rounded-lg p-1 w-fit">
            {MODERATION_FILTERS.map(([value, label]) => {
              const on = status === value
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setStatus(value)}
                  className={`px-3.5 h-9 rounded-lg text-[14px] font-medium transition ${
                    on ? 'bg-black text-white' : 'text-black/60 hover:text-black'
                  }`}
                >
                  {label}
                  <span className={`ml-1.5 text-[12px] ${on ? 'text-white/70' : 'text-black/40'}`}>
                    {counts[value] ?? 0}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="relative flex-1 min-w-[220px] max-w-[380px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/35" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, words or product…"
            aria-label="Search reviews"
            className={`${inputCls} pl-9`}
          />
        </div>
      </div>

      {state.loading ? (
        <ul className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="bg-white border border-black/10 rounded-xl h-[92px] animate-pulse" />
          ))}
        </ul>
      ) : shown.length === 0 ? (
        <p className="mt-6 text-[15px] text-black/55">
          {counts.all === 0
            ? 'No reviews have been written yet. When a customer reviews a product she bought, it will wait here for you.'
            : query
              ? 'No reviews match that search.'
              : 'No reviews in this state — switch the filter to All to see every review.'}
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {shown.map((r) => {
            const product = byProduct.get(r.product_id)
            // The homepage's testimonials are site copy: they carry no rating,
            // no submission date and no moderation decision, and they are
            // already on the site — so they are labelled for what they are
            // instead of being offered decisions the database has no row for.
            const site = isSiteReview(r)
            const [word, cls] = site
              ? ['Homepage', 'bg-neutral-100 text-black/70 border-black/20']
              : moderationCopy(r.status)
            // A testimonial shows the photograph the homepage shows beside it,
            // which is not always the product's own main image.
            const photo = (site && r.image) || product?.image
            return (
              <li key={r.id} className="bg-white border border-black/10 rounded-xl p-4 flex flex-wrap gap-4 items-start">
                <div className="w-[64px] h-[80px] shrink-0 rounded-lg border border-black/15 bg-neutral-100 overflow-hidden grid place-items-center">
                  {photo
                    ? <img src={photo} alt="" className="w-full h-full object-cover" />
                    : <Star size={18} className="text-black/20" />}
                </div>

                <div className="flex-1 min-w-[260px]">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <b className="font-ui text-[15px]">{r.customer_name}</b>
                    {/* A testimonial has no stars. Showing five grey ones
                        would read as "she gave it zero", which is not what
                        the site says about it. */}
                    {r.rating != null && (
                      <span role="img" aria-label={starLabel(r.rating)} className="inline-flex items-center gap-[1px]">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star key={n} size={13} strokeWidth={0} fill={n <= Number(r.rating) ? '#f59e0b' : '#e5e5e5'} />
                        ))}
                      </span>
                    )}
                    {r.created_at ? (
                      <span className="text-[13px] text-black/45">{formatShopDate(r.created_at)}</span>
                    ) : (
                      <span className="text-[13px] text-black/45">Always on the site</span>
                    )}
                    <span className={`rounded-full border px-2 py-[1px] text-[11px] font-medium ${cls}`}>{word}</span>
                  </p>
                  <p className="text-[14px] text-black/65 mt-0.5">
                    for{' '}
                    {product
                      ? <span className="font-semibold text-black/80">{product.title || product.id}</span>
                      : <span className="italic">a product that has since been removed</span>}
                    {product?.id && <span className="font-mono text-black/45 ml-2">{product.id}</span>}
                  </p>
                  <p className="text-[15px] leading-6 text-black/70 mt-2 whitespace-pre-line">{r.body}</p>
                </div>

                <div className="shrink-0 flex flex-col items-end gap-2">
                  {site ? (
                    // Nothing to decide: this is the site's own copy, always
                    // shown, with no database row to write a status to.
                    <p className="text-[12px] text-black/45 text-right max-w-[170px] leading-4">
                      Homepage testimonial — always on the site, so there is nothing to approve.
                    </p>
                  ) : (
                    <>
                      <Actions review={r} busy={busyId === r.id} onDecide={decide} />
                      {busyId === r.id && (
                        <span className="text-[12px] text-black/45 inline-flex items-center gap-1">
                          <Loader2 size={12} className="animate-spin" /> Saving…
                        </span>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
