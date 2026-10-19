import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { normalizeCode, discountFor } from '../src/lib/couponRules.js';
import { totalFor } from '../src/lib/pricing.js';

const SQL = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261019120100_coupons_and_order_discounts.sql'),
  'utf8',
);

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
