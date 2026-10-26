// The testimonials the HOMEPAGE shows, in the shape the moderation panel reads.
//
// The shop's public reviews come from two different places, and this module is
// the one that is not the database:
//
//   * product pages read `product_reviews` — real reviews, written by the
//     account that bought the item, held at `pending` until the owner
//     approves them (supabase/migrations/20261021170000_product_reviews.sql);
//   * the homepage's "What customers say" strip reads the four testimonials
//     that ship with the site (src/data/products.js). They are existing site
//     copy — words the client chose, with the real catalogue photograph and
//     product each one points at.
//
// Because the homepage testimonials were never in the table, the admin panel
// showed an empty list while the site showed four reviews: the client could
// not see, in the portal, what every visitor could see on her homepage. This
// puts them back in front of her.
//
// They are NOT copied into `product_reviews`, on purpose:
//
//   * that table takes a row only through `submit_review()`, which requires
//     the `order_item_id` of a real purchase and the `user_id` of the account
//     that made it — there is no honest value for either here, and inventing
//     one would fabricate a purchase;
//   * they are site copy, not customer submissions, so they have no rating, no
//     submission date and no moderation decision to preserve;
//   * and writing them would duplicate reviews the site already shows.
//
// So they are read from the SAME source the homepage reads, marked with
// `source: 'homepage'`, and rendered by the panel alongside the real ones.
// Nothing here is written anywhere: no review is created, changed or deleted
// for the panel to show them.

import { reviews } from '../data/products.js'

/** Marks a row as homepage site copy rather than a customer submission. */
export const SITE_REVIEW_SOURCE = 'homepage'

/** Is this row one of the homepage testimonials? */
export const isSiteReview = (review) => review?.source === SITE_REVIEW_SOURCE

/**
 * The homepage testimonials as moderation rows.
 *
 * Every field the panel needs is filled with the value the site really uses:
 * the words, the name, and the product each testimonial is linked to, so the
 * same product lookup and the same search that serve a customer review serve
 * these too. The fields a testimonial does not have — rating, timestamp,
 * moderation state — are `null` rather than invented, and `status` is
 * `approved` because these are, in fact, published on the site today.
 *
 * The id is namespaced so it can never collide with a real row's uuid.
 */
export function homepageReviews() {
  return (Array.isArray(reviews) ? reviews : []).filter(Boolean).map((review, index) => ({
    id: `site-copy-${index}`,
    source: SITE_REVIEW_SOURCE,
    product_id: review.product || null,
    customer_name: String(review.name || '').trim(),
    body: String(review.text || ''),
    // Never guessed: a testimonial carries no star rating.
    rating: null,
    status: 'approved',
    created_at: null,
    decided_at: null,
    // Not part of this table's world, but named so nothing treats the row as
    // a database row that happens to be missing its columns.
    order_item_id: null,
    user_id: null,
    // The photograph the homepage shows beside these words, which is not
    // always the product's own main image.
    image: review.img || null,
  }))
}
