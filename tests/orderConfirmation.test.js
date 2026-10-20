import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const SQL = read('supabase/migrations/20261019150100_order_confirmation_tracking.sql');
const CONFIRM = read('supabase/functions/_shared/confirmation.ts');
const VERIFY = read('supabase/functions/verify-razorpay-payment/index.ts');
const WEBHOOK = read('supabase/functions/razorpay-webhook/index.ts');

// ---- the migration ---------------------------------------------------------

test('orders gain a nullable confirmation marker', () => {
  assert.match(SQL, /alter table public\.orders/i);
  assert.match(SQL, /add column if not exists confirmation_sent_at timestamptz/i);
  // Nullable is what keeps it additive: all 19 existing orders stay NULL and
  // no row is rewritten.
  assert.doesNotMatch(SQL, /confirmation_sent_at timestamptz not null/i);
});

test('a browser can no longer stamp an order as already-confirmed', () => {
  // Without this, an `authenticated` session could set the column and quietly
  // suppress a customer's email.
  assert.match(SQL, /current_user in \('anon', 'authenticated'\)/i);
  assert.match(SQL, /new\.confirmation_sent_at\s+is distinct from old\.confirmation_sent_at/i);
});

test('the payment fields the browser was already blocked from keep their guard', () => {
  for (const field of ['payment_status', 'razorpay_order_id', 'razorpay_payment_id', 'paid_at', 'payment_method']) {
    assert.match(SQL, new RegExp(`new\\.${field}\\s+is distinct from old\\.${field}`, 'i'),
      `${field} must stay protected`);
  }
});

test('the migration is reversible and touches no order data', () => {
  assert.match(SQL, /To revert/i);
  assert.match(SQL, /drop column if exists confirmation_sent_at/i);
  assert.doesNotMatch(SQL, /\bupdate\s+public\.orders\b/i, 'it must not rewrite any order row');
  assert.doesNotMatch(SQL, /delete from/i);
});

test('the migration is transaction-wrapped', () => {
  assert.equal((SQL.match(/^\s*begin;\s*$/gim) || []).length, 1);
  assert.equal((SQL.match(/^\s*commit;\s*$/gim) || []).length, 1);
});

// ---- the sender ------------------------------------------------------------

test('the sender claims the slot with a compare-and-set, not a read-then-write', () => {
  // This is the whole idempotency story: one statement, guarded by the very
  // conditions that make sending legal, so Postgres resolves the race.
  assert.match(CONFIRM, /confirmation_sent_at=is\.null/);
  assert.match(CONFIRM, /payment_status=eq\.paid/);
  assert.match(CONFIRM, /method:\s*'PATCH'/);
});

test('an order that is not paid can never be claimed', () => {
  assert.match(CONFIRM, /payment_status=eq\.paid/);
  assert.ok(!/payment_status=neq\.paid/.test(CONFIRM),
    'a "not paid" filter would let unpaid orders through');
});

test('a failed send gives the slot back so a retry can still reach the customer', () => {
  assert.match(CONFIRM, /await release\(orderId\)/);
  const releases = (CONFIRM.match(/await release\(orderId\)/g) || []).length;
  assert.equal(releases, 2, 'released on a bad email and on a refused send');
});

test('a missing mail key is reported before the one send attempt is spent', () => {
  assert.match(CONFIRM, /Fail BEFORE claiming/);
  assert.ok(CONFIRM.indexOf("requireEnv('RESEND_API_KEY')") < CONFIRM.indexOf('const order = await claim'),
    'config is checked ahead of the claim');
});

test('the email never carries a payment or database secret, and is plain text', () => {
  // Reading the mail API key from the function environment is legitimate; what
  // must never appear is a Razorpay credential, a service-role key or any
  // literal key value.
  assert.doesNotMatch(CONFIRM, /RAZORPAY_KEY_SECRET|SUPABASE_SERVICE_ROLE_KEY|eyJ[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(CONFIRM, /dangerouslySetInnerHTML|<html|<div/i);
  assert.match(CONFIRM, /text,\s*\n\s*\}\)/, 'sends text/plain, not HTML');
});

test('the recipient is the order\'s own email, never anything the caller sends', () => {
  // The module takes only an order id — there is no "to" parameter at all.
  assert.match(CONFIRM, /export async function sendOrderConfirmation\(orderId: string\)/);
  assert.doesNotMatch(CONFIRM, /function sendOrderConfirmation\([^)]*(to|email)[^)]*\)/i);
});

// ---- both payment paths use it, and only after verification ---------------

test('verification sends only once the payment is recorded as paid', () => {
  assert.match(VERIFY, /import \{ sendOrderConfirmation \}/);
  const callAt = VERIFY.indexOf('sendOrderConfirmation(');
  const paidAt = VERIFY.indexOf("payment_status: 'paid'");
  assert.ok(callAt > paidAt, 'the call comes after the paid write');
});

test('the webhook sends only on a captured/paid event', () => {
  assert.match(WEBHOOK, /import \{ sendOrderConfirmation \}/);
  const caseStart = WEBHOOK.indexOf("case 'payment.captured'");
  const callAt = WEBHOOK.indexOf('sendOrderConfirmation(');
  assert.ok(caseStart > -1 && callAt > caseStart, 'inside the captured case, not the failed or refund ones');
  const failedCase = WEBHOOK.indexOf("case 'payment.failed'");
  const refundCase = WEBHOOK.indexOf("case 'refund.processed'");
  assert.ok(callAt < failedCase || callAt > refundCase, 'never on a failed payment');
});

test('a mail failure never fails the payment response', () => {
  for (const [name, src] of [['verify', VERIFY], ['webhook', WEBHOOK]]) {
    const at = src.indexOf('sendOrderConfirmation(');
    const before = src.slice(Math.max(0, at - 260), at);
    assert.match(before, /try\s*\{/, `${name} wraps the send in try/catch`);
    assert.match(src.slice(at, at + 260), /catch/, `${name} swallows a mail error`);
  }
});

test('there is no public endpoint that could be turned into a mail relay', () => {
  // The logic lives in _shared and is imported in-process; no new function
  // directory exists for it, and the module is never exposed over HTTP.
  assert.equal(fs.existsSync(path.join(process.cwd(), 'supabase/functions/send-order-confirmation')), false);
  assert.doesNotMatch(CONFIRM, /serve\(handle\)/, 'the module is not a served function');
});

// ---- the item query must only ask for columns the table actually has --------
//
// Regression: `fetchItems` used to select `title,colour,size,qty,unit_price`.
// `public.order_items` has no `colour` column, so PostgREST answered 400,
// `fetchItems` swallowed it and returned [], and every confirmation went out
// with an empty "Items" block — plus no Subtotal line, because that line is
// guarded on `item0(items)` being non-zero. Colour is reachable for the shopper
// only through the snapshot title, so dropping it from the query loses nothing.

const ITEMS_TABLE_SQL = read('supabase/migrations/20260928181500_orders_and_checkout.sql');

/** Column names declared by `create table public.order_items (...)`. */
function orderItemsColumns(sql) {
  const start = sql.indexOf('create table if not exists public.order_items');
  assert.ok(start !== -1, 'order_items table definition is present in the migrations');
  const body = sql.slice(start, sql.indexOf(');', start));
  const cols = [];
  for (const raw of body.split('\n').slice(1)) {
    const line = raw.trim();
    if (!line || /^(constraint|primary|foreign|unique|check)/i.test(line)) continue;
    const m = line.match(/^([a-z_]+)\s+(text|integer|uuid|timestamptz|boolean|jsonb|numeric)/);
    if (m) cols.push(m[1]);
  }
  return cols;
}

test('the schema really has no colour column, so colour must not be selected', () => {
  const cols = orderItemsColumns(ITEMS_TABLE_SQL);
  assert.ok(cols.length >= 8, `parsed order_items columns: ${JSON.stringify(cols)}`);
  assert.ok(cols.includes('title') && cols.includes('size') && cols.includes('qty') && cols.includes('unit_price'),
    'the columns the email needs are all real');
  assert.ok(!cols.includes('colour'), 'order_items carries no colour column — confirmed');
  // Colour for the email is readable only from the snapshot title.
  assert.ok(cols.includes('title'));
});

test('fetchItems selects only columns order_items actually has', () => {
  const cols = orderItemsColumns(ITEMS_TABLE_SQL);
  // The URL is built with string concatenation across two lines, so match the
  // select clause itself rather than the whole URL on one line.
  const m = CONFIRM.match(/&select=([a-z_,]+)&order=created_at\.asc/);
  assert.ok(m, 'fetchItems issues a select against order_items');
  const selected = m[1].split(',');
  for (const col of selected) {
    assert.ok(cols.includes(col),
      `"${col}" is not a column of public.order_items — PostgREST would answer 400 and the email would lose its items`);
  }
  assert.ok(selected.includes('title'), 'the item names are still shown');
  assert.ok(selected.includes('qty') && selected.includes('unit_price'), 'quantities and prices are still shown');
});

test('a failed item query is reported instead of failing silently', () => {
  // The old code returned [] with no trace, which is why this shipped.
  const at = CONFIRM.indexOf('order_items query failed');
  assert.ok(at !== -1, 'fetchItems logs its own failure');
  const block = CONFIRM.slice(CONFIRM.indexOf('async function fetchItems'), CONFIRM.indexOf('const STATUS_LABEL'));
  assert.match(block, /if \(!res\.ok\) \{/, 'the non-200 is detected');
  assert.ok(block.indexOf('order_items query failed') < block.indexOf('return []'),
    'the failure is logged BEFORE the list is treated as empty');
});

test('an empty item list still produces a readable email (no dangling header)', () => {
  // buildText is a local function, so exercise the same guard it uses.
  const guard = CONFIRM.match(/const item0 = .*/);
  assert.ok(guard, 'item0 is defined in the module');
  assert.match(CONFIRM, /if \(money\(item0\(items\)\)\) lines\.push/,
    'the subtotal line is conditional, so an empty list never prints a bogus ₹0 subtotal');
  assert.match(CONFIRM, /lines\.push\(''\)\s*\n\s*if \(money\(item0/,
    'an empty list still closes the block cleanly');
});
