// Reading and writing customer reviews (supabase/migrations/
// 20261021170000_product_reviews.sql and 20261106120000_open_reviews.sql).
//
// The pure rules live beside this file in `reviews.js`; this module only
// speaks to the database, and it never carries a permission decision of its
// own — every check is in the table's policies or in the two functions:
//
//   * the storefront may read `status = 'approved'` and nothing else, and a
//     signed-out visitor only the columns the product page shows;
//   * a customer may read her own review wherever it stands;
//   * only an admin may move a review between states, mark it "Verified
//     purchase", or read a website reviewer's private email and mobile;
//   * NOBODY inserts from here — `submit_review()` (a signed-in purchase),
//     `submit_public_review()` (the website form) and the admin-only
//     `import_reviews()` (a sheet the owner uploads) are the only ways a row
//     is ever born, and all three land it as pending and unverified.

import { supabase } from './supabase'
import { contactProblem, normalizeReview, reviewProblem } from './reviews'

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
      // Exactly the columns the public may read (20261106120000_open_reviews.sql
      // and 20261108120000_review_sheet_import.sql grant `anon` these and no
      // others). `verified` is the owner's own "Verified purchase" decision.
      .select('id, product_id, rating, title, body, customer_name, reviewer_city, reviewer_state, size_bought, created_at, verified')
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
 * Every published rating in the shop — just the product and the stars — for
 * the ratings on cards, the buy bar, the cart and the checkout
 * (src/context/RatingsContext.jsx). Read a thousand rows at a time, the most
 * the API hands out in one answer. A rating that cannot be read is not worth
 * failing a page over: any failure answers with what was read so far.
 */
export async function fetchRatingRows({ pageSize = 1000, maxRows = 20000 } = {}) {
  const rows = []
  try {
    for (let from = 0; from < maxRows; from += pageSize) {
      const { data, error } = await supabase
        .from('product_reviews')
        .select('product_id, rating')
        .eq('status', 'approved')
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1)
        .retry(false)
      if (error) break
      const page = Array.isArray(data) ? data : []
      rows.push(...page)
      if (page.length < pageSize) break
    }
  } catch {
    /* the page is not the ratings */
  }
  return rows
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

  // `submit_review()` decides the product, the account and the purchase — the
  // browser only sends the opinion. The optional headline travels with it.
  const { data, error } = await supabase.rpc('submit_review', {
    p_order_item_id: clean.orderItemId,
    p_rating: clean.rating,
    p_body: clean.body,
    p_name: clean.name,
    p_title: clean.title || null,
  })
  if (error) throw new Error(readableSubmitError(error))
  return data
}

/**
 * Send a review from the product page's open form — anyone may, signed in or
 * not.
 *
 * `productId` is the colour row on screen. The email, mobile and order number
 * go to the shop's private table, never onto the review. `website` is the
 * hidden field a person never fills in. The local rules are re-stated first so
 * an incomplete form is refused without a round trip, in the server's words.
 */
export async function submitPublicReview(productId, draft) {
  const clean = normalizeReview(draft)
  const problem = reviewProblem(clean) || contactProblem(draft)
  if (problem) throw new Error(problem)
  if (!productId) throw new Error('This product is not available for reviews.')

  const { data, error } = await supabase.rpc('submit_public_review', {
    p_product_id: productId,
    p_rating: clean.rating,
    p_title: clean.title || null,
    p_name: clean.name,
    p_body: clean.body,
    p_email: String(draft?.email ?? '').trim() || null,
    p_phone: String(draft?.phone ?? '').trim() || null,
    p_order_ref: String(draft?.orderRef ?? '').trim() || null,
    p_website: String(draft?.website ?? ''),
  })
  // The function's own refusals (`raise exception`, code P0001) are already
  // written for the shopper. Anything else is the connection or the session
  // failing, whose raw text ("TypeError: Load failed") means nothing to her.
  if (error) {
    throw new Error(error.code === 'P0001' && error.message
      ? error.message
      : 'Your review could not be sent. Please check your connection and try again.')
  }
  return data
}

/** Correct a published or pending review: headline, rating, name and body.
 *  Only an admin may reach this row (the table's update policy), and the
 *  review stays in whatever state it was in — editing does not publish it.
 */
export async function updateReview(review, changes) {
  if (!review?.id) throw new Error('That review has gone missing — reload and try again.')
  const { data, error } = await supabase
    .from('product_reviews')
    .update(changes)
    .eq('id', review.id)
    .select('id, title, rating, body, customer_name, reviewer_city, reviewer_state, size_bought, status')
    .single()
  if (error) throw new Error(error.message || 'The change could not be saved.')
  return data
}

/** Permanently delete a review. Admin only — the RLS policy refuses anyone
 *  else, and the panel never offers it for the site's own testimonials. */
export async function deleteReview(review) {
  if (!review?.id) throw new Error('That review has gone missing — reload and try again.')
  const { error } = await supabase
    .from('product_reviews')
    .delete()
    .eq('id', review.id)
  if (error) throw new Error(error.message || 'The review could not be deleted.')
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
    .select('id, product_id, order_item_id, user_id, source, title, rating, body, customer_name, reviewer_city, reviewer_state, size_bought, status, verified, verified_at, created_at, decided_at')
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

/**
 * The private details of website and uploaded reviews, by review id: email,
 * mobile and order number, and for an upload how the review reached the shop,
 * the owner's note, which upload it came in and when. Admin-only: the table's
 * policy hands anyone else nothing.
 */
export async function fetchReviewContacts(reviewIds) {
  const ids = (Array.isArray(reviewIds) ? reviewIds : []).filter(Boolean)
  if (!ids.length) return new Map()
  const { data, error } = await supabase
    .from('product_review_contacts')
    .select('review_id, email, phone, order_ref, channel, note, import_batch, created_at')
    .in('review_id', ids)
  if (error) throw new Error(error.message || 'The reviewers\' contact details could not be loaded.')
  return new Map((data || []).map((c) => [c.review_id, c]))
}

/**
 * The shop's orders, with just what is needed to match a reviewer to a
 * purchase. Read through the orders' own admin policy — nothing new is opened
 * for this.
 */
export async function fetchReviewOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('id, reference, previous_reference, user_id, email, phone, status, payment_status, payment_method, is_test, created_at, order_items(id, product_id)')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) throw new Error(error.message || 'The orders could not be checked.')
  return Array.isArray(data) ? data : []
}

/**
 * Mark a review "Verified purchase", or take the label off. Separate from
 * approve/reject: a review can be published without the label, and the label
 * means nothing until the review is published. Admin-only through the same
 * update policy, and who did it is recorded beside it.
 */
export async function setReviewVerified(review, verified) {
  if (!review?.id) throw new Error('That review has gone missing — reload and try again.')
  const { data: session } = await supabase.auth.getSession()
  const changes = verified
    ? { verified: true, verified_at: new Date().toISOString(), verified_by: session?.session?.user?.id || null }
    : { verified: false, verified_at: null, verified_by: null }
  const { data, error } = await supabase
    .from('product_reviews')
    .update(changes)
    .eq('id', review.id)
    .select('id, verified, verified_at')
    .single()
  if (error) throw new Error(error.message || 'The change could not be saved.')
  if (Boolean(data?.verified) !== Boolean(verified)) {
    throw new Error('The change was not saved — only an admin account can verify reviews.')
  }
  return data
}

/**
 * Add the checked rows of an uploaded sheet to the queue.
 *
 * `rows` are the payloads `checkSheet()` built (src/lib/reviewSheet.js). The
 * admin-only `import_reviews()` checks every row again and stores all of them
 * or none: the first refused row stops the upload, and its message names the
 * row. Returns { batch, count }.
 */
export async function importReviews(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean)
  if (!list.length) throw new Error('There are no reviews to add.')
  const { data, error } = await supabase.rpc('import_reviews', { p_rows: list })
  if (error) {
    throw new Error(error.code === 'P0001' && error.message
      ? `Nothing was added. ${error.message}`
      : error.code === '42501' || /permission denied|admin/i.test(error.message || '')
        ? 'Nothing was added — only the shop\'s admin account can upload reviews. Sign in again and retry.'
        : `Nothing was added. ${error.message || 'Please check your connection and try again.'}`)
  }
  return { batch: data?.batch || '', count: Number(data?.count) || 0 }
}

/**
 * Take back an upload: delete every review of it that is not published.
 *
 * Published reviews stay — taking a review off the site is a decision the
 * owner makes one review at a time, with Unpublish. Returns { removed, kept },
 * `kept` being how many of the upload are published and were left alone.
 */
export async function undoImport(batch) {
  if (!batch) throw new Error('That upload could not be found — reload and try again.')
  const { data: contacts, error: readError } = await supabase
    .from('product_review_contacts')
    .select('review_id')
    .eq('import_batch', batch)
  if (readError) throw new Error(readError.message || 'The upload could not be read.')
  const ids = (contacts || []).map((c) => c.review_id).filter(Boolean)
  if (!ids.length) return { removed: 0, kept: 0 }
  // A hundred ids per request keeps each request's address short.
  let removed = 0
  let kept = 0
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { data, error } = await supabase
      .from('product_reviews')
      .delete()
      .in('id', chunk)
      .neq('status', 'approved')
      .select('id')
    if (error) throw new Error(error.message || 'The upload could not be undone.')
    removed += (data || []).length
    const left = await supabase
      .from('product_reviews')
      .select('id', { count: 'exact', head: true })
      .in('id', chunk)
    kept += Number(left.count) || 0
  }
  return { removed, kept }
}
