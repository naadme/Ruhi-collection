import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 20261106090000_online_payment_only.sql: no cash on delivery from a direct
// call and no reopening a refunded order; and the webhook only marks an order
// paid for its exact total, on its own Razorpay order. These tests read the
// SQL as text; nothing here runs it.

const DIR = path.join(process.cwd(), 'supabase/migrations');
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const FILE = '20261106090000_online_payment_only.sql';
const START = 'create or replace function public.create_order(payload json)';

/** create_order() inside a migration, code only: comments and blanks gone. */
function codeOf(file) {
  const lines = fs.readFileSync(path.join(DIR, file), 'utf8').split('\n');
  const s = lines.findIndex((l) => l.startsWith(START));
  const e = lines.findIndex((l, i) => i > s && l === 'end $$;');
  assert.ok(s !== -1 && e !== -1, `create_order is defined and closed in ${file}`);
  return lines.slice(s, e + 1).map((l) => l.replace(/--.*$/, '').trim()).filter(Boolean);
}

/** Lines in `a` that `b` lacks, counted. */
function minus(a, b) {
  const left = new Map();
  for (const l of b) left.set(l, (left.get(l) || 0) + 1);
  const out = [];
  for (const l of a) {
    if (left.get(l)) left.set(l, left.get(l) - 1);
    else out.push(l);
  }
  return out;
}

const PREVIOUS = codeOf('20261021090000_order_item_skus.sql');
const CURRENT = codeOf(FILE);
const SRC = CURRENT.join('\n');

test('this migration holds the create_order that runs: the newest definition', () => {
  const definers = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').some((l) => l.startsWith(START)));
  assert.equal(definers.at(-1), FILE);
});

test('any method but online payment is refused, including none at all', () => {
  assert.ok(SRC.includes("if v_pay <> 'razorpay' then"));
  assert.ok(SRC.includes("raise exception 'Cash on delivery is not available. Please pay online to place your order.';"));
  assert.ok(!SRC.includes("'cod', 'razorpay'"));
});

test('only the intended lines differ from the previous definition', () => {
  assert.deepEqual(minus(PREVIOUS, CURRENT).sort(), [
    "and o.payment_status <> 'paid'",
    "and o.payment_status <> 'paid'",
    "if v_pay not in ('cod', 'razorpay') then",
    "raise exception 'Please choose cash on delivery or online payment.';",
  ].sort());
  assert.deepEqual(minus(CURRENT, PREVIOUS).sort(), [
    "and o.payment_status = 'pending'",
    "and o.payment_status in ('pending', 'failed')",
    "if v_pay <> 'razorpay' then",
    "raise exception 'Cash on delivery is not available. Please pay online to place your order.';",
  ].sort());
});

test('a refunded order is never reused; the 5-minute guard is unchanged', () => {
  // Ordinary reuse: unpaid states only. Fallback after a collision: only the
  // open order the unique index holds. The one `<> 'paid'` left is the
  // double-submit guard's.
  assert.equal(CURRENT.filter((l) => l === "and o.payment_status in ('pending', 'failed')").length, 1);
  assert.equal(CURRENT.filter((l) => l === "and o.payment_status = 'pending'").length, 1);
  assert.equal(CURRENT.filter((l) => l === "and o.payment_status <> 'paid'").length, 1);
});

test('the grants are restated exactly as before', () => {
  const sql = fs.readFileSync(path.join(DIR, FILE), 'utf8');
  assert.ok(sql.includes('revoke all on function public.create_order(json) from public, anon, authenticated, service_role;'));
  assert.ok(sql.includes('grant execute on function public.create_order(json) to anon, authenticated;'));
  assert.ok(/^begin;$/m.test(sql) && /^commit;$/m.test(sql));
});

test('the webhook marks an order paid only for its exact total in rupees, on its own Razorpay order', () => {
  const hook = read('supabase/functions/razorpay-webhook/index.ts');
  assert.ok(hook.includes("asString(payment?.currency) !== 'INR' || paidPaise !== toPaise(Number(order.total))"));
  assert.ok(hook.includes('if (!rzpOrderId) {'));
  assert.ok(!hook.includes("const pinned = rzpOrderId ?"));
});
