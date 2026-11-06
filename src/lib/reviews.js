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
  MAX_TITLE: 120,
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
  const title = String(draft.title ?? '').trim()

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return 'Choose a star rating first.'
  if (!name) return 'Tell us the name you would like shown with your review.'
  if (name.length < REVIEW_LIMITS.MIN_NAME || name.length > REVIEW_LIMITS.MAX_NAME) {
    return `The name must be between ${REVIEW_LIMITS.MIN_NAME} and ${REVIEW_LIMITS.MAX_NAME} characters.`
  }
  if (title && title.length > REVIEW_LIMITS.MAX_TITLE) {
    return `The title can be up to ${REVIEW_LIMITS.MAX_TITLE} characters.`
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
    title: String(draft.title ?? '').trim(),
    body: String(draft.body ?? '').replace(/\r\n/g, '\n').trim(),
    orderItemId: draft.orderItemId ?? '',
  }
}

/**
 * The website form's private details: an email or an Indian mobile number so
 * the shop can check the order, and an optional order number. The same rules,
 * in the same words, as `submit_public_review()`
 * (supabase/migrations/20261106120000_open_reviews.sql).
 */
export const CONTACT_LIMITS = {
  MAX_EMAIL: 200,
  MAX_ORDER_REF: 40,
}

/** A mobile number as its 10 digits: +91 98765 43210, 098765 43210 and
 *  9876543210 are the same number. Anything else is returned as typed digits,
 *  for `contactProblem()` to refuse. */
export function mobileDigits(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  return digits
}

/** What is wrong with the private details, or '' when they are enough. */
export function contactProblem(draft = {}) {
  const email = String(draft.email ?? '').trim().toLowerCase()
  const phone = mobileDigits(draft.phone)
  const orderRef = String(draft.orderRef ?? '').trim()

  if (!email && !phone) return 'Give your email or mobile number so the shop can check your order.'
  if (email && (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > CONTACT_LIMITS.MAX_EMAIL)) {
    return 'That email address does not look right.'
  }
  if (phone && !/^[6-9]\d{9}$/.test(phone)) return 'Enter a 10-digit Indian mobile number.'
  if (orderRef.length > CONTACT_LIMITS.MAX_ORDER_REF) {
    return `The order number can be up to ${CONTACT_LIMITS.MAX_ORDER_REF} characters.`
  }
  return ''
}

/** An order number as a customer might type it ("# 0110 2601") reduced to
 *  the way the shop stores it, so the two can be compared. */
export const orderRefKey = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '')

/**
 * The orders that could stand behind a review — the evidence the owner reads
 * before she marks it "Verified purchase". It decides nothing: the label is
 * hers to set.
 *
 *   * `purchases` — real purchases (`isPaid`) whose email, mobile or account
 *     is the reviewer's, or that hold the very order line an account review
 *     was written against. Each says why it matched and whether it contains
 *     this design (`sameDesign`, any colour).
 *   * `orderRef` — the order whose number the reviewer typed, paid or not, or
 *     null when it matches none. `matchedBy` says whether that order's own
 *     email or mobile is the one the reviewer gave (empty when neither is).
 *
 * A typed email, mobile or order number proves nothing on its own: order
 * numbers follow the date (DDMMYYNN) and are easy to guess, and anyone can
 * type a customer's email. A match is a reason to check with the customer,
 * not a confirmation. Test orders are never evidence.
 */
export function reviewEvidence(review, contact, orders, { isPaid = () => false, sameDesign = () => false } = {}) {
  const list = (Array.isArray(orders) ? orders : []).filter((o) => o && !o.is_test)
  const email = String(contact?.email ?? '').trim().toLowerCase()
  const phone = mobileDigits(contact?.phone)
  const ref = orderRefKey(contact?.order_ref)

  // Which of the reviewer's typed details this order's own details repeat.
  const sameContact = (order) => [
    ...(email && String(order.email ?? '').trim().toLowerCase() === email ? ['email'] : []),
    ...(phone && mobileDigits(order.phone) === phone ? ['mobile'] : []),
  ]

  const purchases = []
  for (const order of list) {
    const lines = Array.isArray(order.order_items) ? order.order_items : []
    const reasons = []
    if (review?.order_item_id && lines.some((l) => l?.id === review.order_item_id)) reasons.push('the order line it was written for')
    reasons.push(...sameContact(order))
    if (review?.user_id && order.user_id === review.user_id) reasons.push('account')
    if (!reasons.length || !isPaid(order)) continue
    purchases.push({ order, reasons, hasDesign: lines.some((l) => sameDesign(l?.product_id)) })
  }

  const refOrder = ref
    ? list.find((o) => orderRefKey(o.reference) === ref || (o.previous_reference && orderRefKey(o.previous_reference) === ref))
    : null
  const orderRef = refOrder
    ? {
        order: refOrder,
        paid: Boolean(isPaid(refOrder)),
        hasDesign: (refOrder.order_items || []).some((l) => sameDesign(l?.product_id)),
        matchedBy: sameContact(refOrder),
      }
    : null

  return { purchases, orderRef }
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

/** Where a review was written, in the panel's words. */
export const sourceCopy = (source) => (source === 'public' ? 'Website form' : 'Customer account')

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
