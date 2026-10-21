// The rules a review lives by, in one pure module the browser, the admin
// panel and the database all agree on.
//
// The database is the final word (supabase/migrations/
// 20261021170000_product_reviews.sql holds the same limits as CHECK
// constraints), so the whole point of restating them here is that the form
// can refuse a half-written review in the same words the server would, and a
// test can prove the two never drift apart.

/** The limits the CHECK constraints enforce, restated for the form. */
export const REVIEW_LIMITS = {
  MIN_BODY: 10,
  MAX_BODY: 2000,
  MIN_NAME: 2,
  MAX_NAME: 60,
}

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected']

/**
 * What is wrong with this draft, in a sentence a shopper can act on — or ''
 * when it is ready to send.
 *
 * Checked in the order the server checks, so the first complaint on screen is
 * the first complaint the database would have given.
 */
export function reviewProblem(draft = {}) {
  const rating = Number(draft.rating)
  const body = String(draft.body ?? '').replace(/\r\n/g, '\n').trim()
  const name = String(draft.name ?? '').trim()

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return 'Choose a star rating first.'
  if (!name) return 'Tell us the name you would like shown with your review.'
  if (name.length < REVIEW_LIMITS.MIN_NAME || name.length > REVIEW_LIMITS.MAX_NAME) {
    return `The name must be between ${REVIEW_LIMITS.MIN_NAME} and ${REVIEW_LIMITS.MAX_NAME} characters.`
  }
  if (!body) return 'Write a few words about the piece.'
  if (body.length < REVIEW_LIMITS.MIN_BODY) {
    return `A review needs at least ${REVIEW_LIMITS.MIN_BODY} characters — you have ${body.length}.`
  }
  if (body.length > REVIEW_LIMITS.MAX_BODY) {
    return `A review can be up to ${REVIEW_LIMITS.MAX_BODY} characters — you have ${body.length}.`
  }
  return ''
}

/** The draft as the database will store it: trimmed, line endings normalised,
 *  the rating a number. Never shortens the text itself. */
export function normalizeReview(draft = {}) {
  return {
    rating: Number(draft.rating) || 0,
    name: String(draft.name ?? '').trim(),
    body: String(draft.body ?? '').replace(/\r\n/g, '\n').trim(),
    orderItemId: draft.orderItemId ?? '',
  }
}

/**
 * The headline a page shows above a design's reviews: how many, and what they
 * average out to.
 *
 * Only what is actually on the page feeds it — an unpublished review must
 * never lift the average, which is why the caller passes the published list
 * and not the raw table.
 */
export function reviewSummary(reviews = []) {
  const list = Array.isArray(reviews) ? reviews.filter(Boolean) : []
  const distribution = [0, 0, 0, 0, 0] // index 0 = 1 star … index 4 = 5 stars
  let total = 0
  for (const review of list) {
    const rating = Math.max(1, Math.min(5, Math.round(Number(review.rating) || 0)))
    total += rating
    distribution[rating - 1] += 1
  }
  return {
    count: list.length,
    average: list.length ? total / list.length : 0,
    distribution,
  }
}

/** The design's reviews across all of its colours, newest first. */
export function reviewsForProduct(reviews, productIds) {
  const ids = new Set((Array.isArray(productIds) ? productIds : []).filter(Boolean))
  return (Array.isArray(reviews) ? reviews : [])
    .filter((r) => r && ids.has(r.product_id))
    .sort((a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0))
}

/** Newest first — the order the admin panel and the storefront both read in. */
export const newestFirst = (reviews = []) =>
  (Array.isArray(reviews) ? reviews : [])
    .slice()
    .sort((a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0))

/** The filter chips the moderation panel offers, with their own counts. */
export const MODERATION_FILTERS = [
  ['all', 'All'],
  ['pending', 'Pending'],
  ['approved', 'Published'],
  ['rejected', 'Rejected'],
]

/** One sentence per state, used as the badge in the moderation list. */
export const moderationCopy = (status) => ({
  pending: ['Waiting for you', 'bg-amber-50 text-amber-800 border-amber-200'],
  approved: ['Published', 'bg-green-50 text-green-800 border-green-200'],
  rejected: ['Rejected', 'bg-red-50 text-red-700 border-red-200'],
}[status] || ['Unknown', 'bg-neutral-100 text-black/60 border-black/20'])

/**
 * The same three states, in the words the CUSTOMER reads in her account.
 *
 * "Waiting for you" is the shop talking to the shop; she needs to know where
 * her review stands and whether anyone else can see it. Rejection is put
 * plainly but without blame — nothing was wrong with her account, the words
 * simply did not go up.
 */
export const customerStatusCopy = (status) => ({
  pending: ['Waiting for approval', 'bg-amber-50 text-amber-800 border-amber-200'],
  approved: ['Published', 'bg-green-50 text-green-800 border-green-200'],
  rejected: ['Not published', 'bg-neutral-100 text-black/60 border-black/25'],
}[status] || ['Unknown', 'bg-neutral-100 text-black/60 border-black/20'])

/**
 * Stars, for `aria-label` — a screen reader must hear "4 out of 5 stars"
 * rather than five identical glyphs.
 */
export const starLabel = (rating) => `${Math.max(0, Number(rating) || 0)} out of 5 stars`
