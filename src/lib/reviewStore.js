// Reading and writing customer reviews (supabase/migrations/
// 20261021170000_product_reviews.sql).
//
// The pure rules live beside this file in `reviews.js`; this module only
// speaks to the database, and it never carries a permission decision of its
// own — every check is in the table's policies or in `submit_review()`:
//
//   * the storefront may read `status = 'approved'` and nothing else;
//   * a customer may read her own review wherever it stands;
//   * only an admin may move a review between states;
//   * NOBODY inserts from here — `submit_review()` is the only way a row is
//     ever born, and it decides which purchase, which product and who.

import { supabase } from './supabase'
import { normalizeReview, reviewProblem } from './reviews'

/**
 * The published reviews of a design, newest first.
 *
 * `productIds` is every colour row of the design: a review belongs to the
 * exact row that was bought, and a shopper reads them all as "this product".
 *
 * `strict: true` is for a screen that must not look empty because of a
 * dropped connection — the admin list uses it. The product page reads without
 * it: a review it cannot load is not worth failing the page over.
 */
export async function fetchPublishedReviews(productIds, { strict = false } = {}) {
  try {
    const ids = (Array.isArray(productIds) ? productIds : []).filter(Boolean)
    if (!ids.length) return []
    const { data, error } = await supabase
      .from('product_reviews')
      .select('id, product_id, rating, body, customer_name, created_at, order_item_id')
      .in('product_id', ids)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .retry(false)
    if (error) throw new Error(error.message || 'The reviews could not be loaded.')
    return Array.isArray(data) ? data : []
  } catch (e) {
    if (strict) throw e
    return []
  }
}

/**
 * The purchases this signed-in customer still owe a review of.
 *
 * The WHOLE design is asked for at once — every colour row — because a
 * customer who owns three colours of one design should see all three
 * unreviewed purchases in one list rather than be asked three times.
 * Empty when signed out, when nothing was bought, or when every purchase has
 * already been reviewed.
 */
export async function fetchReviewableItems(productIds) {
  const ids = (Array.isArray(productIds) ? productIds : []).filter(Boolean)
  if (!ids.length) return []
  const { data, error } = await supabase.rpc('reviewable_items', { p_product_ids: ids })
  if (error) throw new Error(error.message || 'Your orders could not be checked.')
  return Array.isArray(data) ? data : []
}

/**
 * Send a review for moderation.
 *
 * The product is NOT passed: the server reads it off the order line, so the
 * browser cannot ask for a review of something it did not buy. This only
 * re-states the local rules first so an obviously incomplete review is
 * refused without a round trip, in the same words the server would use.
 */
export async function submitReview(draft) {
  const clean = normalizeReview(draft)
  const problem = reviewProblem(clean)
  if (problem) throw new Error(problem)
  if (!clean.orderItemId) {
    throw new Error('Choose which of your orders you are reviewing.')
  }

  const { data, error } = await supabase.rpc('submit_review', {
    p_order_item_id: clean.orderItemId,
    p_rating: clean.rating,
    p_body: clean.body,
    p_name: clean.name,
  })
  if (error) throw new Error(readableSubmitError(error))
  return data
}

/** The database's own complaint, turned into the sentence the form shows. */
function readableSubmitError(error) {
  const message = String(error?.message || '')
  if (/already been reviewed/i.test(message)) return 'You have already reviewed this purchase.'
  if (/not on your account/i.test(message)) {
    return 'That order is not on your account, so it cannot be reviewed.'
  }
  if (/sign in/i.test(message)) return 'Please sign in to write a review.'
  if (error?.code === 'PGRST301' || /jwt|token/i.test(message)) {
    return 'Your session has expired — sign in again to send your review.'
  }
  return message || 'Your review could not be sent. Please try again.'
}

/**
 * Every review, for the moderation panel.
 *
 * `strict: true`: a panel that cannot read must say so rather than display an
 * empty list the admin could then "approve" into nothing.
 */
export async function fetchAllReviews() {
  const { data, error } = await supabase
    .from('product_reviews')
    .select('id, product_id, order_item_id, rating, body, customer_name, status, created_at, decided_at')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(error.message || 'The reviews could not be loaded.')
  return Array.isArray(data) ? data : []
}

/**
 * Approve, reject, or take a published review back off the site.
 *
 * One UPDATE for all three: the status column and the admin-only policy are
 * the whole mechanism, so unpublishing is exactly as possible as publishing.
 * `decided_at`/`decided_by` are written here rather than in a trigger so the
 * record says when the PANEL acted, not when the row moved.
 */
export async function setReviewStatus(review, status) {
  if (!review?.id) throw new Error('That review has gone missing — reload and try again.')
  const { data, error } = await supabase
    .from('product_reviews')
    .update({ status, decided_at: new Date().toISOString() })
    .eq('id', review.id)
    .select('id, status')
    .single()
  if (error) throw new Error(error.message || 'The change could not be saved.')
  if (data?.status !== status) {
    throw new Error('The change was not saved — only an admin account can moderate reviews.')
  }
  return data
}
