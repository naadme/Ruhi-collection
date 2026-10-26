// Customer reviews, and the moderation that stands between a written review
// and the public page.
//
// The rules live in three places and these tests are the contract between
// them: the database (supabase/migrations/20261021170000_product_reviews.sql)
// is the final word on who may write, who may publish and how many reviews a
// purchase may produce; src/lib/reviews.js restates the shape of a valid
// review so the form can refuse one in the same words; and the screens only
// ever render what the database allowed out.
//
// Nothing here trusts the browser: the assertions below exist so that a change
// to the migration, the rules or the wiring that opens a hole fails the suite
// rather than the shop.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  REVIEW_LIMITS,
  customerStatusCopy,
  moderationCopy,
  normalizeReview,
  reviewProblem,
  reviewsForProduct,
  reviewSummary,
  starLabel,
} from '../src/lib/reviews.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const SQL = read('supabase/migrations/20261021170000_product_reviews.sql')

/* ---------------------------------------------------------------------------
 * 1. What the database insists on
 * ------------------------------------------------------------------------- */

test('one purchase produces exactly one review', () => {
  // The line is the guard, so the same parcel cannot be used twice to fill a
  // product with praise — no matter what the browser asks for.
  assert.match(SQL, /order_item_id\s+uuid not null unique/,
    'the order line is unique, not merely recorded')
  assert.match(SQL, /references public\.order_items \(id\) on delete cascade/,
    'and it points at a real order line, tidied away with it')
})

test('a review can only name a product that was actually bought', () => {
  // The product is READ from the order line inside the function; the request
  // never supplies it. If it ever started coming from the caller, a signed-in
  // customer could praise a product she has never received.
  assert.match(SQL, /v_item\s+public\.order_items%rowtype/, 'the line is loaded as a row')
  assert.match(SQL, /\(v_item\.product_id, v_item\.id, v_uid, p_rating, v_body, v_name\)/,
    'the insert takes the product off that row')
  assert.doesNotMatch(SQL, /p_product_id\s+(text|uuid)/,
    'there is no product parameter for the caller to choose')
})

test('the reviewer must own the order, and the order must be real', () => {
  assert.match(SQL, /o\.user_id = v_uid/, 'ownership is the signed-in account, not a typed-in address')
  assert.match(SQL, /o\.status <> 'cancelled'/, 'a cancelled order owes no praise')
  assert.match(SQL, /if v_uid is null then[\s\S]{0,120}using errcode = '28000'/,
    'a signed-out caller is refused before anything is read')
  assert.match(SQL, /That purchase is not on your account/,
    'and the refusal says why, rather than looking like a bug')
})

test('the limits are CHECK constraints, not advice', () => {
  assert.match(SQL, /constraint product_reviews_rating_range check \(rating >= 1 and rating <= 5\)/)
  assert.match(SQL, /constraint product_reviews_body_length check \(char_length\(btrim\(body\)\) >= 10/)
  assert.match(SQL, /constraint product_reviews_status_known check \(status in \('pending', 'approved', 'rejected'\)\)/)
  assert.match(SQL, /constraint product_reviews_name_length check \(char_length\(btrim\(customer_name\)\) >= 2/)
})

const TITLE_SQL = read('supabase/migrations/20261026120000_review_title_and_delete.sql')

test('the title column is added to the review table', () => {
  assert.match(TITLE_SQL, /add column if not exists title text/, 'the column exists')
  assert.match(TITLE_SQL, /constraint product_reviews_title_length[\s\S]{0,60}char_length\(btrim\(title\)\) <= 120\)/,
    'and the headline has a ceiling')
})

test('submit_review() accepts and stores an optional headline', () => {
  assert.match(TITLE_SQL, /p_title\s+text/, 'the headline is a parameter')
  assert.match(TITLE_SQL, /v_title\s+text := btrim\(coalesce\(p_title, ''\)\)/, 'and is trimmed')
  assert.match(TITLE_SQL, /customer_name, title\)/, 'the insert stores the headline')
  assert.match(TITLE_SQL, /v_title\)/, 'the headline travels with the row')
})

test('a review may be permanently deleted, but only by an admin', () => {
  assert.match(TITLE_SQL, /grant\s+delete on table public\.product_reviews to authenticated/)
  assert.match(TITLE_SQL, /create policy "admins remove reviews"[\s\S]{0,160}for delete[\s\S]{0,120}using \(public\.is_admin\(\)\)/,
    'deletion is gated on is_admin()')
  assert.match(TITLE_SQL, /with check \(public\.is_admin\(\)\)/,
    'and the same gate applies to the new row')
  assert.match(TITLE_SQL, /char_length\(v_title\) > 120/, 'an over-long headline is refused')
})

test('nobody inserts a review from a browser', () => {
  // The single most important assertion in this file: RLS is on, the grants
  // give no INSERT to either API role, and there is no `for insert` policy
  // anywhere in the migration. The function — running as the table's owner —
  // is the only door in.
  assert.match(SQL, /alter table public\.product_reviews enable row level security/)
  assert.equal(
    (SQL.match(/for insert/g) || []).length,
    0,
    'no INSERT policy exists for any role',
  )
  assert.match(SQL, /revoke all on table public\.product_reviews from anon/)
  assert.match(SQL, /revoke all on table public\.product_reviews from authenticated/)
  assert.match(SQL, /grant\s+select, update on table public\.product_reviews to authenticated/,
    'authenticated gets only what moderation needs')
  assert.doesNotMatch(SQL, /grant\s+[a-z, ]*insert[a-z, ]*on table public\.product_reviews to (anon|authenticated)/)
})

test('the public sees published reviews, and only those', () => {
  assert.match(SQL, /create policy "published reviews are public"[\s\S]{0,200}using \(status = 'approved'\)/)
  // Her own review is readable by her wherever it stands — otherwise her
  // account page could never tell her it is still waiting.
  assert.match(SQL, /create policy "a customer reads her own review"[\s\S]{0,160}user_id = \(select auth\.uid\(\)\)/)
  // An admin sees everything, and only an admin may move a row between states.
  assert.match(SQL, /create policy "admins read every review"[\s\S]{0,160}using \(public\.is_admin\(\)\)/)
  assert.match(SQL, /create policy "admins move reviews between states"[\s\S]{0,240}using \(public\.is_admin\(\)\)\s+with check \(public\.is_admin\(\)\)/,
    'approve, reject and unpublish are one UPDATE an admin alone may run')
})

test('a review always lands as pending, and duplicate submissions are named', () => {
  assert.match(SQL, /status\s+text not null default 'pending'/)
  assert.match(SQL, /exception when unique_violation then[\s\S]{0,160}already been reviewed/)
  // The store keeps its own books: a review that is published can be taken
  // down again by the same route.
  assert.match(SQL, /'pending', 'approved', 'rejected'/)
})

test('the write box only ever appears for a purchase on the customer’s own account', () => {
  assert.match(SQL, /create or replace function public\.reviewable_items\(p_product_ids text\[\]\)/)
  assert.match(SQL, /o\.user_id = \(select auth\.uid\(\)\)/, 'read from the orders that account owns')
  assert.match(SQL, /and r\.id is null/, 'and nothing she has already reviewed')
  assert.match(SQL, /where \(select auth\.uid\(\)\) is not null/, 'and nothing at all when signed out')
  assert.match(SQL, /revoke all on function public\.reviewable_items\(text\[\]\) from public, anon/)
  assert.match(SQL, /revoke all on function public\.submit_review\(uuid, integer, text, text\)\s+from public, anon/)
  assert.match(SQL, /grant\s+execute on function public\.submit_review\(uuid, integer, text, text\)\s+to authenticated, service_role/)
})

/* ---------------------------------------------------------------------------
 * 2. The rules the form restates
 * ------------------------------------------------------------------------- */

test('the form refuses exactly what the database would', () => {
  const good = { rating: 5, name: 'Priya S.', body: 'Fits beautifully and washed well.' }
  assert.equal(reviewProblem(good), '', 'a complete review is not a problem')

  assert.equal(reviewProblem({ ...good, rating: 0 }), 'Choose a star rating first.')
  assert.equal(reviewProblem({ ...good, rating: 6 }), 'Choose a star rating first.')
  assert.match(reviewProblem({ ...good, name: '' }), /name/i)
  assert.match(reviewProblem({ ...good, name: 'P' }), new RegExp(String(REVIEW_LIMITS.MIN_NAME)))
  assert.match(reviewProblem({ ...good, body: 'Too short' }),
    new RegExp(String(REVIEW_LIMITS.MIN_BODY)))
  assert.match(reviewProblem({ ...good, body: 'x'.repeat(REVIEW_LIMITS.MAX_BODY + 1) }),
    new RegExp(String(REVIEW_LIMITS.MAX_BODY)))
  assert.match(reviewProblem({ ...good, title: 'x'.repeat(REVIEW_LIMITS.MAX_TITLE + 1) }),
    new RegExp(String(REVIEW_LIMITS.MAX_TITLE)))
  assert.equal(reviewProblem({ ...good, title: 'A perfectly fine headline' }), '')
  // The very limits the CHECK constraints carry are the limits quoted here.
  assert.equal(REVIEW_LIMITS.MIN_BODY, 10)
  assert.equal(REVIEW_LIMITS.MAX_BODY, 2000)
  assert.equal(REVIEW_LIMITS.MIN_NAME, 2)
  assert.equal(REVIEW_LIMITS.MAX_NAME, 60)
  assert.equal(REVIEW_LIMITS.MAX_TITLE, 120)
})

test('a draft is tidied but its words are never cut', () => {
  const body = '  First line.\n\nSecond paragraph,  \nover two lines.  '
  const clean = normalizeReview({ rating: '4', name: '  Priya S.  ', title: '  Loved it  ', body })
  assert.equal(clean.rating, 4, 'the rating arrives as a number')
  assert.equal(clean.name, 'Priya S.', 'the name is trimmed')
  assert.equal(clean.title, 'Loved it', 'the optional headline is trimmed')
  assert.equal(clean.body, 'First line.\n\nSecond paragraph,  \nover two lines.',
    'only the stray ends go — her line breaks and her spacing inside stay')
})

test('the summary counts only the reviews it is given', () => {
  const r = (rating, id) => ({ id, rating })
  const empty = reviewSummary([])
  assert.equal(empty.count, 0)
  assert.equal(empty.average, 0)
  assert.deepEqual(empty.distribution, [0, 0, 0, 0, 0])

  const summary = reviewSummary([r(5, 'a'), r(4, 'b'), r(5, 'c'), r(1, 'd')])
  assert.equal(summary.count, 4)
  assert.equal(summary.average, 3.75)
  assert.deepEqual(summary.distribution, [1, 0, 0, 1, 2], 'one 1-star, no 2s or 3s, one 4, two 5s')
  // A rating outside 1–5 cannot be stored, but a malformed row must not throw
  // or drag the average out of range either.
  assert.ok(reviewSummary([{ rating: null }]).average >= 1)
})

test('a review belongs to the colour row that was bought', () => {
  const reviews = [
    { id: 'x', product_id: 'denim-shirt-blue', created_at: '2026-10-19T10:00:00Z' },
    { id: 'y', product_id: 'other-product', created_at: '2026-10-20T10:00:00Z' },
    { id: 'z', product_id: 'denim-shirt-black', created_at: '2026-10-21T10:00:00Z' },
  ]
  const mine = reviewsForProduct(reviews, ['denim-shirt-blue', 'denim-shirt-black'])
  assert.deepEqual(mine.map((x) => x.id), ['z', 'x'], 'this design only, newest first')
  assert.deepEqual(reviewsForProduct(reviews, []), [], 'no rows → no reviews')
  assert.deepEqual(reviewsForProduct(null, ['denim-shirt-blue']), [], 'never a throw on a bad read')
})

test('the customer and the shop read the same states in their own words', () => {
  for (const state of ['pending', 'approved', 'rejected']) {
    assert.ok(moderationCopy(state)[0], `the panel names "${state}"`)
    assert.ok(customerStatusCopy(state)[0], `and so does her account`)
  }
  // "Waiting for you" addresses the shop; she must not be told her review is
  // somebody else's job to read without knowing where it stands.
  assert.match(customerStatusCopy('pending')[0], /approval/)
  assert.equal(moderationCopy('pending')[0], 'Waiting for you')
  assert.notEqual(customerStatusCopy('rejected')[0], moderationCopy('rejected')[0],
    'rejection is worded for her, not for the moderator')
  assert.equal(starLabel(4), '4 out of 5 stars')
})

/* ---------------------------------------------------------------------------
 * 3. What the screens are wired to do
 * ------------------------------------------------------------------------- */

test('the product page reads only published reviews, once, and shows them', () => {
  const store = read('src/lib/reviewStore.js')
  assert.match(store, /\.eq\('status', 'approved'\)/, 'the read asks for published rows explicitly')
  assert.match(store, /\.order\('created_at', \{ ascending: false \}\)/, 'newest first')
  assert.doesNotMatch(store, /submit_review[\s\S]{0,200}product_id/,
    'the submission never names a product — the server works it out')

  const page = read('src/pages/Product.jsx')
  assert.match(page, /fetchPublishedReviews\(reviewIds\)/, 'the page reads them for the design')
  assert.match(page, /<ReviewsSection product=\{p\} reviews=\{reviews\} \/>/, 'and hands them to the section')
  assert.match(page, /summary\.count > 0 \?/, 'real reviews win over the numbers typed into the editor')
  assert.ok(!/dangerouslySetInnerHTML/.test(page), 'no review is ever markup')
})

test('the write box is offered only where there is a purchase to write about', () => {
  const section = read('src/components/ReviewsSection.jsx')
  assert.match(section, /fetchReviewableItems\(ids\)/, 'the customer’s own unreviewed purchases')
  assert.match(section, /canWrite = itemsLoaded && items\.length > 0/,
    'no purchase, no box — for a signed-out visitor or a stranger alike')
  assert.match(section, /whitespace-pre-line/, 'her paragraphs survive')
  assert.ok(!/dangerouslySetInnerHTML/.test(section), 'and are never interpreted as markup')
  assert.match(section, /Verified purchase/, 'the badge comes off the server-written order line')
  assert.match(section, /waiting for approval|has been approved/i, 'she is told where it goes next')
})

test('only an owner may reach the moderation panel, and it offers the three decisions', () => {
  const dash = read('src/admin/Dashboard.jsx')
  assert.match(dash, /\['reviews', 'Reviews'\]/, 'the section exists')
  assert.match(dash, /SECTIONS\.filter\(\(\[k\]\) => k === 'products' \|\| showOrders\)/,
    'and like orders and banners, it is owner-only — a product manager cannot publish')
  assert.match(dash, /<ReviewsPanel notify=\{notify\} products=\{all\} \/>/, 'rendered with the catalogue')

  const panel = read('src/admin/ReviewsPanel.jsx')
  assert.match(panel, /fetchAllReviews\(\)/, 'it reads the table’s own list')
  assert.match(panel, /'approved'[\s\S]{0,80}'rejected'/, 'approve and reject')
  assert.match(panel, /'pending'\}\) \{$|Back to queue[\s\S]{0,120}'pending'/, 'and take a published one back down')
  assert.match(panel, /setReviewStatus\(review, next\)/, 'every decision is written, not held in the browser')
  assert.match(panel, /deleteReview\(review\)/, 'a review may be permanently deleted')
  assert.match(panel, /[Dd]elete permanently/, 'and only after a confirmation')
  assert.match(panel, /Homepage testimonial — always on the site/, 'but never a homepage testimonial')
})

test('a customer can see her own reviews, wherever they stand', () => {
  const account = read('src/pages/Account.jsx')
  assert.match(account, /from\('product_reviews'\)/, 'her account reads the table')
  assert.match(account, /\.order\('created_at', \{ ascending: false \}\)/, 'newest first')
  assert.match(account, /customerStatusCopy\(r\.status\)/, 'in her own words, not the moderator’s')
  // No filter by user id: the table's policy already hands this query only her
  // rows, and restating it here would invite a page that quietly shows
  // somebody else's review if the policy ever moved.
  assert.ok(!/eq\('user_id'/.test(account), 'the page trusts the policy rather than filtering itself')
})
