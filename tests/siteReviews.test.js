// Issue 6 — the four homepage testimonials reappear in the admin Reviews
// panel, clearly marked as the site's own copy.
// Run with `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { homepageReviews, isSiteReview, SITE_REVIEW_SOURCE } from '../src/lib/siteReviews.js'

test('homepageReviews returns the four testimonials the homepage shows', () => {
  const rows = homepageReviews()
  assert.equal(rows.length, 4)
})

test('every testimonial is a moderation-shaped row that can never collide with a real review', () => {
  const rows = homepageReviews()
  for (const row of rows) {
    assert.equal(row.source, SITE_REVIEW_SOURCE)
    assert.ok(row.id.startsWith('site-copy-'))
    assert.equal(row.status, 'approved')        // already on the site
    assert.equal(row.rating, null)               // no stars were ever given
    assert.equal(row.created_at, null)           // no submission date
    assert.equal(row.order_item_id, null)        // not a purchase review
    assert.equal(row.user_id, null)
    assert.ok(row.customer_name, 'a name')
    assert.ok(row.body, 'the words')
    assert.ok(row.product_id, 'points at a real product')
    assert.ok(row.image, 'the photograph the homepage shows beside it')
    assert.ok(isSiteReview(row))
  }
})

test('the ids are stable and unique', () => {
  const rows = homepageReviews()
  const ids = rows.map((r) => r.id)
  assert.deepEqual(ids, [...new Set(ids)])
  assert.equal(ids[0], 'site-copy-0')
  assert.equal(ids[3], 'site-copy-3')
})

test('a real review is never mistaken for a testimonial', () => {
  assert.ok(!isSiteReview({ id: '550e8400-e29b-41d4-a716-446655440000', status: 'pending' }))
  assert.ok(!isSiteReview({}))
})
