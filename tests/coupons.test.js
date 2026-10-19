import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { normalizeCode, discountFor, serverHonoursCoupon } from '../src/lib/couponRules.js';
import { displayedTotalMatchesCharge, totalFor } from '../src/lib/pricing.js';
import { MAX_CART_LINES } from '../src/lib/checkout.js';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const SQL = read('supabase/migrations/20261019120100_coupons_and_order_discounts.sql');

test('normalizeCode trims and uppercases a code', () => {
  assert.equal(normalizeCode('  save10 '), 'SAVE10');
  assert.equal(normalizeCode('a-b_c1'), 'A-B_C1');
  assert.equal(normalizeCode(''), '');
  assert.equal(normalizeCode(undefined), '');
});

test('discountFor: percent coupon, floor like the SQL `floor()`', () => {
  assert.equal(discountFor({ kind: 'percent', value: 10, min_subtotal: 0 }, 1000), 100);
  // 10% of 999 = 99.9 → floor → 99, exactly as `floor(v_sub * value / 100.0)` in SQL
  assert.equal(discountFor({ kind: 'percent', value: 10, min_subtotal: 0 }, 999), 99);
});

test('discountFor: percent discount never exceeds the subtotal', () => {
  assert.equal(discountFor({ kind: 'percent', value: 150, min_subtotal: 0 }, 1000), 1000);
  assert.equal(discountFor({ kind: 'percent', value: 10, min_subtotal: 0 }, 0), 0);
});

test('discountFor: fixed coupon is capped at the subtotal (never negative)', () => {
  assert.equal(discountFor({ kind: 'fixed', value: 200, min_subtotal: 0 }, 1000), 200);
  assert.equal(discountFor({ kind: 'fixed', value: 5000, min_subtotal: 0 }, 1000), 1000);
  assert.equal(discountFor({ kind: 'fixed', value: -50, min_subtotal: 0 }, 1000), 0);
});

test('discountFor: a coupon flagged invalid gives nothing', () => {
  assert.equal(discountFor({ kind: 'percent', value: 10, valid: false }, 1000), 0);
  assert.equal(discountFor(null, 1000), 0);
});

test('totalFor subtracts the discount without going negative', () => {
  assert.equal(totalFor(1000, 100), 900);
  assert.equal(totalFor(1000, 0), 1000);
  assert.equal(totalFor(1000, 9999), 0);
});

test('the migration stores the coupon on the order and widens the totals rule', () => {
  assert.match(SQL, /add column if not exists coupon_code text/);
  assert.match(SQL, /add column if not exists discount\s+integer not null default 0/);
  assert.match(SQL, /orders_totals_chk[\s\S]{0,120}total = subtotal - discount \+ shipping/);
  assert.match(SQL, /orders_discount_chk[\s\S]{0,80}discount >= 0/);
});

test('shoppers validate a single code through an RPC, with no read on coupons', () => {
  assert.match(SQL, /create or replace function public\.validate_coupon\(p_code text, p_subtotal integer\)/i);
  assert.match(SQL, /revoke all on table public\.coupons from anon/);
  assert.match(SQL, /grant execute on function public\.validate_coupon\(text, integer\) to anon, authenticated/);
  // every rejection the checkout promises is handled server-side
  for (const message of ['is not valid', 'no longer active', 'not active yet', 'has expired', 'minimum order']) {
    assert.ok(SQL.includes(message), `SQL rejects with "${message}"`);
  }
});

test('create_order re-validates the code and clamps the discount to the subtotal', () => {
  assert.match(SQL, /payload ->> 'coupon_code'/);
  assert.match(SQL, /That coupon code is not valid or has expired/);
  assert.match(SQL, /raise exception 'The coupon % needs a minimum order/);
  // discount always least(greatest(0), subtotal) — totals can never go negative
  assert.match(SQL, /v_disc := least\(greatest\(coalesce\(v_disc, 0\), 0\), coalesce\(v_sub, 0\)\)/);
  assert.match(SQL, /perform public\.recalc_order_totals\(v_order\.id\)/);
});

// ---------------------------------------------------------------------------
// Checkout must never show a discount it is not going to charge. The page
// renders the discount as soon as validate_coupon() approves a code; the money
// is decided later, elsewhere. These three tests pin that invariant down.
// ---------------------------------------------------------------------------

test('a discount on screen the server did not price is refused', () => {
  const code = { kind: 'percent', value: 10, valid: true };
  // server echoed the same discount → page and payment window agree
  assert.equal(serverHonoursCoupon(code, 1000, { discount: 100, total: 900 }), true);
  // server priced NO discount → this is the "shown ₹900, charged ₹1,000" case
  assert.equal(serverHonoursCoupon(code, 1000, { discount: 0, total: 1000 }), false);
  // a different discount is exactly as wrong as none
  assert.equal(serverHonoursCoupon(code, 1000, { discount: 40, total: 960 }), false);
});

test('a function build that echoes no discount is checked against its total', () => {
  const code = { kind: 'percent', value: 10, valid: true };
  // no `discount` key, but it will charge the discounted total → honoured
  assert.equal(serverHonoursCoupon(code, 1000, { total: 900 }), true);
  // no `discount` key and it charges full price → the coupon must come off
  assert.equal(serverHonoursCoupon(code, 1000, { total: 1000 }), false);
  // nothing verifiable in the answer at all → do not display the discount
  assert.equal(serverHonoursCoupon(code, 1000, {}), false);
  assert.equal(serverHonoursCoupon(code, 1000, undefined), false);
});

test('with no coupon on screen the check can never interfere with checkout', () => {
  for (const server of [{}, { total: 1000 }, { total: 1000, discount: 0 }, undefined]) {
    assert.equal(serverHonoursCoupon(null, 1000, server), true);
    assert.equal(
      serverHonoursCoupon({ valid: false, kind: 'percent', value: 10 }, 1000, server),
      true,
    );
  }
  // a coupon worth nothing against a zero subtotal is also "nothing on screen"
  assert.equal(serverHonoursCoupon({ kind: 'percent', value: 10 }, 0, { total: 0 }), true);
});

// ---------------------------------------------------------------------------
// The two server-side defects behind that same invariant.
// ---------------------------------------------------------------------------

test('verification returns discount and coupon_code, yet still works before the migration', () => {
  const SHARED = read('supabase/functions/_shared/supabase.ts');
  const start = SHARED.indexOf('export async function fetchOrderByColumn');
  const end = SHARED.indexOf('/** The order line snapshot');
  assert.ok(start >= 0 && end > start, 'fetchOrderByColumn should be in the file');
  const fn = SHARED.slice(start, end);

  // the confirmation page reads both straight out of this answer
  assert.match(fn, /discount,coupon_code,total,created_at/);
  // ...and if the columns do not exist yet it retries without them, because a
  // failed SELECT here would take payment verification down with it
  assert.match(fn, /if \(!res\.ok\) \{\s*res = await serviceFetch\(path\(`\$\{common\}total,created_at`\)\)/);
});

test('create-razorpay-order echoes the database discount and prices from the database total', () => {
  const FN = read('supabase/functions/create-razorpay-order/index.ts');
  assert.match(FN, /discount: order\.discount/);
  // the browser never sends an amount, and Razorpay is only ever told the
  // total the database worked out
  assert.ok(!FN.includes('body.amount'), 'the browser must never supply an amount');
  assert.match(FN, /const total = Number\(order\.total\)/);
  assert.match(FN, /const amountPaise = toPaise\(total\)/);
});

test('a 100% coupon cannot slip past Razorpay at zero or one rupee', () => {
  const FN = read('supabase/functions/create-razorpay-order/index.ts');
  assert.match(FN, /const MIN_AMOUNT_PAISE = 100/);
  assert.match(FN, /amountPaise <= 0/);
  assert.match(FN, /amountPaise < MIN_AMOUNT_PAISE/);
  // and verification insists the gateway processed exactly our amount
  const VERIFY = read('supabase/functions/verify-razorpay-payment/index.ts');
  assert.match(VERIFY, /gatewayOrder\.amount !== toPaise\(Number\(order\.total\)\)/);
});

// ---------------------------------------------------------------------------
// The page must never promise an amount the payment window does not collect.
// ---------------------------------------------------------------------------

test('displayedTotalMatchesCharge accepts the exact paise the gateway was given', () => {
  // ₹1,400 on screen == 140000 paise handed to Razorpay
  assert.equal(displayedTotalMatchesCharge(1400, { amount: 140000 }), true);
  assert.equal(displayedTotalMatchesCharge(0, { amount: 0 }), true);
  assert.equal(displayedTotalMatchesCharge(1, { amount: 100 }), true);
  assert.equal(displayedTotalMatchesCharge(479, { amount: 47900 }), true);
});

test('a total that disagrees with the charge is refused in BOTH directions', () => {
  // page shows less than it charges (customer would be surprised by a bigger bill)
  assert.equal(displayedTotalMatchesCharge(1000, { amount: 150000 }), false);
  // page shows more than it charges (the old coupon-drop bug: page promised the
  // full price while the window charged the discounted one)
  assert.equal(displayedTotalMatchesCharge(1500, { amount: 100000 }), false);
  // an off-by-one rupee still fails — the amounts must be identical
  assert.equal(displayedTotalMatchesCharge(1400, { amount: 140100 }), false);
  assert.equal(displayedTotalMatchesCharge(1401, { amount: 140000 }), false);
});

test('with no coupon the gate still checks the total (the gap serverHonoursCoupon leaves open)', () => {
  // serverHonoursCoupon returns true straight away when nothing is discounted,
  // so a stale catalogue price used to reach the gateway unchallenged.
  assert.equal(serverHonoursCoupon(null, 900, { total: 950 }), true,
    'the coupon-specific check deliberately stands down without a coupon');
  // ...but the total gate does not
  assert.equal(displayedTotalMatchesCharge(900, { amount: 95000 }), false);
  assert.equal(displayedTotalMatchesCharge(900, { amount: 90000 }), true);
});

test('the gate fails open only when there is genuinely nothing to compare', () => {
  assert.equal(displayedTotalMatchesCharge(900, {}), true, 'amount absent');
  assert.equal(displayedTotalMatchesCharge(900, { amount: undefined }), true);
  assert.equal(displayedTotalMatchesCharge(900, null), true, 'response absent');
  assert.equal(displayedTotalMatchesCharge(900, { amount: 'nonsense' }), true, 'unparseable');
});

test('Checkout refuses to open the payment window when the totals disagree', () => {
  const SRC = read('src/pages/Checkout.jsx');
  assert.match(SRC, /displayedTotalMatchesCharge\(shownTotal, started\)/,
    'the gate is evaluated against the amount actually handed to Razorpay');
  assert.match(SRC, /const shownTotal = totalFor\(subtotal, coupon \? discountFor\(coupon, subtotal\) : 0\)/,
    'the shown total is the one rendered in the summary and on the Pay button');
  // It must bail out BEFORE the gateway window, and re-price rather than carry on.
  const gateAt = SRC.indexOf('displayedTotalMatchesCharge(shownTotal, started)');
  const gatewayAt = SRC.indexOf('await openRazorpay');
  assert.ok(gateAt > 0 && gatewayAt > gateAt, 'the gate runs before the payment window opens');
  const gateBlock = SRC.slice(gateAt, SRC.indexOf('let response', gateAt));
  assert.match(gateBlock, /^\s*return\s*$/m, 'a mismatch stops the flow instead of proceeding');
  assert.match(gateBlock, /reload\(\)/, 'prices are refreshed from the database');
});

// ---------------------------------------------------------------------------
// Cart lines: the client must not be able to send a count the server refuses
// with a message about an empty basket.
// ---------------------------------------------------------------------------

test("the client's cart-line limit is exactly the one the server enforces", () => {
  const FN = read('supabase/functions/create-razorpay-order/index.ts');
  const m = FN.match(/value\.length > (\d+)/);
  assert.ok(m, 'readItems still documents its upper bound');
  assert.equal(MAX_CART_LINES, Number(m[1]),
    'MAX_CART_LINES must match readItems, or checkout shows a misleading error');
});

test('Checkout states the line limit before the request instead of "Your cart is empty"', () => {
  const SRC = read('src/pages/Checkout.jsx');
  assert.match(SRC, /lines\.length > MAX_CART_LINES/,
    'the limit is checked locally first');
  const at = SRC.indexOf('lines.length > MAX_CART_LINES');
  // `payOnline` (which creates the order) is defined earlier in the file, so
  // the meaningful comparison is against the point submit actually calls it.
  const serverAt = SRC.indexOf('await payOnline(customer, items');
  assert.ok(serverAt > at, 'checked before the order is created');
  assert.ok(serverAt > 0, 'the payOnline call site is present');
  const block = SRC.slice(at, SRC.indexOf('return', at));
  assert.ok(/different items|remove/i.test(block), 'the message says what to do');
  assert.ok(!/Your cart is empty/.test(block), 'it does not claim an empty basket');
});
