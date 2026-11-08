// Open reviews: anyone may write one from the product page, and the owner
// decides — per review, after checking it herself — what is published and
// which reviews say "Verified purchase".
//
// The database (supabase/migrations/20261106120000_open_reviews.sql) holds
// the rules; src/lib/reviews.js restates the form's limits in the same words;
// the product page and the admin panel are wired to show the label from the
// owner's own `verified` column and nowhere else. These assertions fail the
// suite if any of that drifts, and above all if the reviewer's private email
// or mobile could ever reach a public read.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CONTACT_LIMITS,
  contactProblem,
  mobileDigits,
  orderRefKey,
  reviewEvidence,
  sourceCopy,
} from '../src/lib/reviews.js'
import { isPurchase } from '../src/lib/tracking.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const SQL = read('supabase/migrations/20261106120000_open_reviews.sql')
const FN = SQL.slice(SQL.indexOf('create or replace function public.submit_public_review'))
const SIGNATURE = 'public.submit_public_review(text, integer, text, text, text, text, text, text, text)'

/* ---------------------------------------------------------------------------
 * 1. The migration
 * ------------------------------------------------------------------------- */

test('the migration is one transaction', () => {
  assert.match(SQL, /^begin;$/m)
  assert.match(SQL, /^commit;$/m)
  assert.ok(SQL.indexOf('begin;') < SQL.indexOf('commit;'))
})

test('a review no longer needs an order line or an account, but keeps one purchase = one review', () => {
  assert.match(SQL, /alter column order_item_id drop not null/)
  assert.match(SQL, /alter column user_id\s+drop not null/)
  assert.doesNotMatch(SQL, /drop constraint[^;]*order_item_id_key/, 'the unique key on the order line stays')
  assert.doesNotMatch(SQL, /drop constraint[^;]*_fkey/, 'and so do the foreign keys')
  assert.match(SQL, /check \(source = 'public' or \(order_item_id is not null and user_id is not null\)\)/,
    'only a website review may arrive without them')
})

test('"Verified purchase" is a column, false by default, and existing purchase reviews keep it', () => {
  assert.match(SQL, /add column if not exists verified\s+boolean not null default false/)
  assert.match(SQL, /add column if not exists verified_at timestamptz/)
  assert.match(SQL, /add column if not exists verified_by uuid/)
  assert.match(SQL, /add column if not exists source\s+text not null default 'account'/)
  assert.match(SQL, /check \(source in \('account', 'public'\)\)/)
  assert.match(SQL, /set verified = true\s+where order_item_id is not null/)
})

test('nothing but an admin can set verified: no new write path for a browser', () => {
  assert.equal((SQL.match(/for insert/g) || []).length, 0, 'no INSERT policy')
  assert.equal((SQL.match(/for update/g) || []).length, 0, 'no new UPDATE policy beside the admin one')
  assert.doesNotMatch(SQL, /grant\s+[a-z, ]*(insert|update)[a-z, ]*on table public\.product_reviews to (anon|authenticated)/)
  assert.doesNotMatch(SQL, /function public\.submit_review\(/, 'submit_review() is left as it is')
  // The open function writes verified = false, explicitly.
  assert.match(FN, /'pending', 'public', false\)/)
  assert.doesNotMatch(FN, /p_verified/, 'and the caller has no say in it')
})

test('the public read is narrowed to the columns the product page shows', () => {
  assert.match(SQL, /revoke select on table public\.product_reviews from anon;/)
  const grant = SQL.match(/grant\s+select \(([^)]*)\)\s+on table public\.product_reviews to anon;/)
  assert.ok(grant, 'anon gets column privileges')
  const cols = grant[1].split(',').map((c) => c.trim())
  for (const hidden of ['user_id', 'order_item_id', 'decided_by', 'verified_by', 'decided_at', 'verified_at']) {
    assert.ok(!cols.includes(hidden), `${hidden} is not public`)
  }
  // Everything the product page asks for is in a grant, or the page would be
  // refused and silently show no reviews. Column grants add up, so the later
  // migration's grant (city, state and size, 20261108120000) counts too.
  const later = read('supabase/migrations/20261108120000_review_sheet_import.sql')
    .match(/grant\s+select \(([^)]*)\)\s+on table public\.product_reviews to anon;/)
  const granted = [...cols, ...(later ? later[1].split(',').map((c) => c.trim()) : [])]
  const store = read('src/lib/reviewStore.js')
  const select = store.match(/fetchPublishedReviews[\s\S]*?\.select\('([^']*)'\)/)[1]
  for (const col of select.split(',').map((c) => c.trim())) {
    assert.ok(granted.includes(col), `the product page reads ${col}, so anon may`)
  }
  assert.ok(!select.includes('order_item_id'), 'the page no longer reads the order line')
})

test('the reviewer\u2019s private details live in their own admin-only table', () => {
  assert.match(SQL, /create table if not exists public\.product_review_contacts \(/)
  assert.match(SQL, /review_id\s+uuid primary key\s+references public\.product_reviews \(id\) on delete cascade/)
  assert.match(SQL, /alter table public\.product_review_contacts enable row level security/)
  assert.match(SQL, /revoke all on table public\.product_review_contacts from anon, authenticated;/)
  assert.match(SQL, /grant\s+select on table public\.product_review_contacts to authenticated;/)
  assert.match(SQL, /create policy "admins read review contacts"[\s\S]{0,160}for select[\s\S]{0,60}to authenticated[\s\S]{0,30}using \(public\.is_admin\(\)\)/)
  assert.doesNotMatch(SQL, /on table public\.product_review_contacts to anon/, 'nothing at all for anon')
  assert.equal((SQL.match(/on public\.product_review_contacts for/g) || []).length, 1, 'one policy: the admin read')
  assert.doesNotMatch(SQL, /add column[^;]*\b(email|phone|order_ref)\b[^;]*;/, 'and none of it is a review column')
})

test('submit_public_review() is open to anyone and only to that', () => {
  assert.match(FN, /returns json/)
  assert.match(FN, /security definer\s+set search_path = public, pg_temp/)
  assert.match(SQL, new RegExp(`revoke all on function ${SIGNATURE.replace(/[().]/g, '\\$&')}\\s+from public;`))
  assert.match(SQL, new RegExp(`grant\\s+execute on function ${SIGNATURE.replace(/[().]/g, '\\$&')}\\s+to anon, authenticated, service_role;`))
})

test('the honeypot answers like success and stores nothing', () => {
  const honeypot = FN.slice(FN.indexOf("if btrim(coalesce(p_website, '')) <> '' then"))
  assert.ok(honeypot.length < FN.length, 'the hidden field is checked')
  assert.match(honeypot, /^[^;]*then\s+return json_build_object\('id', gen_random_uuid\(\), 'status', 'pending'\);/,
    'and returns straight away with a success-shaped answer')
  assert.ok(FN.indexOf('p_website') < FN.indexOf('insert into'), 'before any insert')
})

test('the same rules and words as submit_review(), plus a product that is on sale', () => {
  assert.match(FN, /p\.id = p_product_id and p\.is_active = true/)
  for (const words of [
    'Choose a rating between 1 and 5 stars.',
    'The name you show must be between 2 and 60 characters.',
    'The title can be up to 120 characters.',
    'A review needs at least a few words (10 characters).',
    'A review can be up to 2000 characters.',
  ]) assert.ok(FN.includes(words), words)
  assert.doesNotMatch(FN, /errcode/, 'friendly P0001 messages throughout')
})

test('an email or an Indian mobile is required, and goes only to the private table', () => {
  assert.match(FN, /if v_email = '' and v_phone = '' then/)
  assert.match(FN, /v_phone !~ '\^\[6-9\]\[0-9\]\{9\}\$'/)
  assert.match(FN, /left\(v_phone, 2\) = '91'/, '+91 is understood')
  assert.match(FN, /left\(v_phone, 1\) = '0'/, 'and so is a leading 0')
  assert.match(FN, /char_length\(v_ref\) > 40/, 'the order number has a ceiling')
  assert.match(FN, /insert into public\.product_review_contacts \(review_id, email, phone, order_ref\)/)
  const reviewInsert = FN.slice(FN.indexOf('insert into public.product_reviews'), FN.indexOf('insert into public.product_review_contacts'))
  assert.doesNotMatch(reviewInsert, /v_email|v_phone|v_ref/, 'the review row never holds them')
})

test('two limits keep the queue from being buried', () => {
  assert.match(FN, /interval '24 hours'[\s\S]{0,200}c\.email = v_email[\s\S]{0,80}c\.phone = v_phone/)
  assert.match(FN, /if v_recent >= 3 then/)
  assert.match(FN, /r\.source = 'public'\s+and r\.status = 'pending'/)
  assert.match(FN, /if v_queued >= 20 then/)
})

test('the limits are counted under a lock, and what they cannot stop is written down', () => {
  const lock = FN.indexOf("perform pg_advisory_xact_lock(hashtext('submit_public_review'));")
  assert.ok(lock > 0, 'one transaction-level lock')
  assert.ok(lock < FN.indexOf('select count(*) into v_recent'), 'taken before the first count')
  assert.ok(lock > FN.indexOf("if btrim(coalesce(p_website, '')) <> '' then"), 'after the honeypot, which stores nothing')
  const header = SQL.slice(0, SQL.indexOf('begin;'))
  assert.match(header, /A known weakness/, 'the header says a script can fill the queue')
  assert.match(header, /Turnstile/, 'and what the next step would be')
})

test('the migration does not claim signed-in customers are narrowed too', () => {
  const section3 = SQL.slice(SQL.indexOf('-- 3. The public read'), SQL.indexOf('revoke select on table public.product_reviews from anon;'))
  assert.match(section3, /anyone can make an account/, 'any account can still read the ids')
  assert.doesNotMatch(section3, /real "anyone"/)
})

test('a website review lands pending, public, unverified, with no order line', () => {
  assert.match(FN, /\(p_product_id, null, v_uid, p_rating, v_body, v_name, nullif\(v_title, ''\),\s+'pending', 'public', false\)/)
  assert.match(FN, /return json_build_object\('id', v_id, 'status', 'pending'\);/)
})

/* ---------------------------------------------------------------------------
 * 2. The form's rules
 * ------------------------------------------------------------------------- */

test('a mobile number is read the way the server reads it', () => {
  assert.equal(mobileDigits('+91 98765 43210'), '9876543210')
  assert.equal(mobileDigits('098765-43210'), '9876543210')
  assert.equal(mobileDigits('9876543210'), '9876543210')
  assert.equal(mobileDigits(''), '')
})

test('the private details are refused in the server\u2019s words', () => {
  assert.match(contactProblem({}), /email or mobile/)
  assert.equal(contactProblem({ email: 'priya@example.com' }), '')
  assert.equal(contactProblem({ phone: '+91 98765 43210' }), '')
  assert.equal(contactProblem({ email: 'not-an-email' }), 'That email address does not look right.')
  assert.equal(contactProblem({ phone: '12345' }), 'Enter a 10-digit Indian mobile number.')
  assert.equal(contactProblem({ phone: '5876543210' }), 'Enter a 10-digit Indian mobile number.')
  assert.match(contactProblem({ email: 'a@b.co', orderRef: 'x'.repeat(CONTACT_LIMITS.MAX_ORDER_REF + 1) }), /40/)
  // Every sentence the form can show is one the function can raise.
  const SQLtext = SQL
  for (const words of [
    'That email address does not look right.',
    'Enter a 10-digit Indian mobile number.',
    'Give your email or mobile number so the shop can check your order.',
  ]) assert.ok(SQLtext.includes(words), words)
  assert.equal(CONTACT_LIMITS.MAX_ORDER_REF, 40)
})

test('the evidence lists paid orders that match, and whether they hold this design', () => {
  const orders = [
    { id: 'o1', reference: '01112601', email: 'priya@example.com', phone: '+91 98765 43210', payment_method: 'razorpay', payment_status: 'paid', status: 'confirmed', order_items: [{ id: 'i1', product_id: 'kurta-blue' }] },
    { id: 'o2', reference: '02112601', email: 'priya@example.com', phone: '', payment_method: 'razorpay', payment_status: 'pending', status: 'pending', order_items: [{ id: 'i2', product_id: 'kurta-blue' }] },
    { id: 'o3', reference: '03112601', email: 'someone@else.com', phone: '9876543210', payment_method: 'razorpay', payment_status: 'paid', status: 'delivered', order_items: [{ id: 'i3', product_id: 'dress-red' }] },
    { id: 'o4', reference: '04112601', email: 'priya@example.com', payment_method: 'razorpay', payment_status: 'paid', status: 'confirmed', is_test: true, order_items: [] },
  ]
  const sameDesign = (pid) => pid === 'kurta-blue' || pid === 'kurta-black'
  const review = { id: 'r1', product_id: 'kurta-black', source: 'public', user_id: null, order_item_id: null }
  const contact = { email: 'Priya@Example.com ', phone: '098765 43210', order_ref: '#0211 2601' }
  const { purchases, orderRef } = reviewEvidence(review, contact, orders, { isPaid: isPurchase, sameDesign })

  assert.deepEqual(purchases.map((p) => p.order.id), ['o1', 'o3'], 'paid only, and never a test order')
  assert.deepEqual(purchases[0].reasons, ['email', 'mobile'])
  assert.equal(purchases[0].hasDesign, true, 'another colour of the design counts')
  assert.equal(purchases[1].hasDesign, false)
  assert.equal(orderRef.order.id, 'o2', 'the typed order number is found however it was typed')
  assert.equal(orderRef.paid, false, 'and said plainly when it was never paid')
  assert.deepEqual(orderRef.matchedBy, ['email'], 'and whether that order is the reviewer\u2019s own email or mobile')

  // A guessed order number that belongs to somebody else says so.
  const guessed = reviewEvidence(review, { email: 'stranger@example.com', order_ref: '03112601' }, orders, { isPaid: isPurchase, sameDesign })
  assert.equal(guessed.orderRef.order.id, 'o3')
  assert.deepEqual(guessed.orderRef.matchedBy, [], 'a guessed number does not match the typed contact')

  const none = reviewEvidence(review, { email: 'x@y.co', order_ref: '99999999' }, orders, { isPaid: isPurchase, sameDesign })
  assert.equal(none.purchases.length, 0)
  assert.equal(none.orderRef, null)

  // An account review: the order line it was written for is the evidence.
  const account = reviewEvidence({ ...review, source: 'account', order_item_id: 'i1', user_id: 'u1' }, null, orders, { isPaid: isPurchase, sameDesign })
  assert.deepEqual(account.purchases[0].reasons, ['the order line it was written for'])
  assert.equal(orderRefKey(' #0110 2601 '), '01102601')
  assert.equal(sourceCopy('public'), 'Website form')
  assert.equal(sourceCopy('account'), 'Customer account')
})

/* ---------------------------------------------------------------------------
 * 3. The screens
 * ------------------------------------------------------------------------- */

test('the product page shows "Verified purchase" from the owner\u2019s flag only', () => {
  const section = read('src/components/ReviewsSection.jsx')
  assert.match(section, /\{r\.verified === true && \(/)
  assert.doesNotMatch(section, /r\.order_item_id/, 'an order line alone no longer earns the label')
})

test('the open form asks for what the brief asks, and keeps the private details private', () => {
  const section = read('src/components/ReviewsSection.jsx')
  assert.match(section, /Private: only used by the shop to check your order, never shown\./)
  assert.match(section, /Order number \(optional, private\)/)
  assert.match(section, /Review title \(optional\)/)
  assert.match(section, /name="website" tabIndex=\{-1\}/, 'the honeypot is out of the keyboard\u2019s reach')
  assert.match(section, /aria-hidden="true" className="absolute -left-\[10000px\]/, 'and out of sight')
  assert.match(section, /bg-brand-cta/, 'the send button is the site\u2019s primary action colour')
  assert.match(section, /Thank you\. Your review will appear once the shop has checked it\./)

  // The form starts over when the product does: the route keeps this
  // section mounted, and a review must never be sent against the next product.
  assert.match(section, /useEffect\(\(\) => \{\s+setSent\(false\)\s+setWriting\(false\)\s+setError\(''\)\s+setDraft\(EMPTY_DRAFT\)\s+\}, \[productId\]\)/)

  const store = read('src/lib/reviewStore.js')
  assert.match(store, /rpc\('submit_public_review', \{/)
  // Only the function's own refusals reach the shopper word for word; a
  // dropped connection gets a sentence she can act on.
  const submit = store.slice(store.indexOf('export async function submitPublicReview'))
  assert.match(submit, /error\.code === 'P0001'/)
  assert.match(submit, /Please check your connection and try again\./)
  for (const arg of ['p_product_id', 'p_rating', 'p_title', 'p_name', 'p_body', 'p_email', 'p_phone', 'p_order_ref', 'p_website']) {
    assert.match(store, new RegExp(`${arg}:`), arg)
    assert.ok(FN.includes(arg), `${arg} is a parameter of the function`)
  }
})

test('the admin panel shows the evidence and sets the label separately from publishing', () => {
  const panel = read('src/admin/ReviewsPanel.jsx')
  assert.match(panel, /fetchReviewContacts\(/, 'the private details are read')
  assert.match(panel, /fetchReviewOrders\(\)/, 'and matched against the orders')
  assert.match(panel, /reviewEvidence\(review, contact, orders, \{ isPaid: isPurchase, sameDesign \}\)/)
  assert.match(panel, /sourceCopy\(review\.source\)/, 'where it came from')
  assert.match(panel, /Matching orders/)
  assert.match(panel, /given by the reviewer, not confirmed/, 'typed details are not presented as proof')
  assert.match(panel, /orderRef\.matchedBy\.length/, 'a typed order number is checked against the typed contact')
  assert.match(panel, /check with the customer using the email or mobile saved on the order itself/)
  assert.match(panel, /setReviewVerified\(review, !review\.verified\)/, 'one button marks and unmarks')
  assert.match(panel, /Mark “Verified purchase”/)
  assert.match(panel, /Remove “Verified purchase”/)
  assert.match(panel, /import \{[^}]*EyeOff[^}]*\} from 'lucide-react'/, 'Unpublish has its icon')

  const store = read('src/lib/reviewStore.js')
  assert.match(store, /from\('product_review_contacts'\)/)
  assert.match(store, /verified: true, verified_at: new Date\(\)\.toISOString\(\), verified_by:/)
  assert.match(store, /verified: false, verified_at: null, verified_by: null/)
  const adminSelect = store.match(/export async function fetchAllReviews[\s\S]*?\.select\('([^']*)'\)/)[1]
  for (const col of ['source', 'verified', 'user_id', 'order_item_id']) {
    assert.ok(adminSelect.split(', ').includes(col), `the panel reads ${col}`)
  }
})
