import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const OLD_SQL = read('supabase/migrations/20261019120100_coupons_and_order_discounts.sql');
const NEW_SQL = read('supabase/migrations/20261020090000_refuse_unpayable_orders.sql');
const RPC = read('supabase/functions/_shared/supabase.ts');
const NEW_FILE = '20261020090000_refuse_unpayable_orders.sql';

/** The create_order() definition inside a migration file, as raw lines. */
function bodyOf(sql, label) {
  const lines = sql.split('\n');
  const s = lines.findIndex((l) => l.startsWith('create or replace function public.create_order(payload json)'));
  assert.ok(s !== -1, `create_order is defined in ${label}`);
  const e = lines.findIndex((l, i) => i > s && l === 'end $$;');
  assert.ok(e !== -1, `create_order is closed in ${label}`);
  return lines.slice(s, e + 1);
}

/** Code only: comments and blank lines removed, lines trimmed. */
const codeOnly = (lines) =>
  lines.map((l) => l.replace(/--.*$/, '').trim()).filter((l) => l !== '');

const OLD_CODE = codeOnly(bodyOf(OLD_SQL, '20261019120100'));
const NEW_CODE = codeOnly(bodyOf(NEW_SQL, NEW_FILE));
const NEW_SRC = NEW_CODE.join('\n');       // comment-free, so prose cannot trip a regex

const GUARD_MSG = 'This order comes to \u20b90, so there is nothing to pay. Remove the coupon or add another item.';

/** Multiset difference: how many more copies of each line. */
function extra(lines, from) {
  const tally = (arr) => {
    const m = new Map();
    for (const l of arr) m.set(l, (m.get(l) || 0) + 1);
    return m;
  };
  const a = tally(lines);
  const b = tally(from);
  const out = [];
  for (const [line, n] of a) {
    const gone = n - (b.get(line) || 0);
    for (let i = 0; i < gone; i++) out.push(line);
  }
  return out.sort();
}

// ---- the migration really does override the live definition ----------------

test('this migration sorts AFTER the one that last defined create_order', () => {
  // Supabase applies files in name order. If this sorted earlier, the guard
  // would silently never reach the database.
  const oldFile = '20261019120100_coupons_and_order_discounts.sql';
  assert.ok(NEW_FILE > oldFile, `${NEW_FILE} must sort after ${oldFile}`);

  const dir = path.join(process.cwd(), 'supabase/migrations');
  const definers = fs.readdirSync(dir)
    .filter((f) => fs.readFileSync(path.join(dir, f), 'utf8')
      .includes('create or replace function public.create_order(payload json)'))
    .sort();
  assert.ok(definers[definers.length - 1] >= NEW_FILE,
    'the newest migration defining create_order must be this one or a later one');
});

test('the guard survives in the newest definition of create_order', () => {
  // A later migration may copy create_order to change something else — the
  // order ID, say. The guard that refuses an order nobody could pay for has
  // to travel with it, or it would be lost from the live database.
  const dir = path.join(process.cwd(), 'supabase/migrations');
  const definers = fs.readdirSync(dir)
    .filter((f) => fs.readFileSync(path.join(dir, f), 'utf8')
      .includes('create or replace function public.create_order(payload json)'))
    .sort();
  const newest = fs.readFileSync(path.join(dir, definers[definers.length - 1]), 'utf8');
  assert.match(newest, /if coalesce\(v_order\.total, 0\) < 1 then/,
    `${definers[definers.length - 1]} still refuses an order that comes to nothing`);
});

// ---- the body is otherwise the shipped function ---------------------------

test('the only changes to create_order are the two intended ones', () => {
  assert.deepEqual(extra(OLD_CODE, NEW_CODE), [],
    'no line of the original create_order may be dropped or altered');

  assert.deepEqual(extra(NEW_CODE, OLD_CODE), [
    'if coalesce(v_order.total, 0) < 1 then',
    `raise exception '${GUARD_MSG}';`,
    'end if;',                                      // the guard's own closer
    'confirmation_sent_at = null,',
    'confirmation_sent_at = null,',
  ].sort(), 'unexpected additions to create_order');
});

test('the migration adds no destructive statement', () => {
  // Check the CODE, not the comments — the header deliberately says
  // "no DROP, TRUNCATE, DELETE or UPDATE", which a naive regex would trip on.
  assert.doesNotMatch(NEW_SRC, /drop\s+table|truncate\s/i);
  // The deletes/updates/inserts below are pre-existing create_order code:
  // their counts must be identical to the original.
  for (const stmt of ['delete from public.order_items', 'update public.orders', 'insert into public.orders']) {
    const before = OLD_CODE.filter((l) => l.includes(stmt)).length;
    const after = NEW_CODE.filter((l) => l.includes(stmt)).length;
    assert.equal(after, before, `"${stmt}" count changed (${before} -> ${after})`);
  }
});

// ---- where the guard sits --------------------------------------------------

test('the guard runs after the final re-read and before the return', () => {
  const finalRead = NEW_SRC.indexOf('select * into v_order from public.orders where id = v_order.id;');
  const raise = NEW_SRC.indexOf(`raise exception '${GUARD_MSG}'`);
  const ret = NEW_SRC.indexOf('return json_build_object(');
  assert.ok(finalRead !== -1, 'the final read-back is present');
  assert.ok(raise !== -1 && ret !== -1, 'the guard and the return are present');
  assert.ok(finalRead < raise && raise < ret,
    'the guard must sit between the last read of v_order and the return, '
    + 'or it cannot see the final total — and returning first would ship it');
});

test('the guard is outside both exception handlers, so it cannot be swallowed', () => {
  const raise = NEW_SRC.indexOf(`raise exception '${GUARD_MSG}'`);
  const handlers = [...NEW_SRC.matchAll(/exception when /g)].map((m) => m.index);
  assert.equal(handlers.length, 2, 'create_order has exactly two handler blocks');
  for (const h of handlers) assert.ok(h < raise, 'every handler opens before the guard');
  const closes = [...NEW_SRC.matchAll(/^ *end;$/gm)].map((m) => m.index);
  assert.ok(closes.some((c) => c < raise), 'the handler blocks are closed before the guard runs');
  assert.ok(raise > 0);
});

test('the guard answers with a message the browser will actually show', () => {
  // rpcCreateOrder only forwards a DB error to the shopper when the SQLSTATE is
  // P0001, which is exactly what a plain `raise exception` produces. Anything
  // else is replaced by a generic sentence, so the customer would never learn
  // that the coupon is the problem.
  assert.match(RPC, /body\?\.code === 'P0001'/);
  assert.doesNotMatch(NEW_SRC, /using\s+(errcode|hint)/i,
    'do not override the SQLSTATE away from P0001');
  assert.ok(GUARD_MSG.includes('\u20b90'), 'the message names the actual problem');
});

// ---- finding 6: a recycled order must be able to email again ---------------

test('both branches that rewind a recycled order re-arm the confirmation', () => {
  const rewinds = [...NEW_SRC.matchAll(/paid_at\s*=\s*null,/g)].length;
  const rearms = [...NEW_SRC.matchAll(/confirmation_sent_at\s*=\s*null,/g)].length;
  assert.equal(rewinds, 2, 'two branches rewind the payment state');
  assert.equal(rearms, rewinds,
    'every branch that can hand back a payable order must clear the sent marker, '
    + 'or the payment that finally succeeds never gets its confirmation');

  const lines = NEW_CODE;
  const idx = lines.map((l, n) => (/paid_at\s*=\s*null,/.test(l) ? n : -1)).filter((n) => n >= 0);
  for (const i of idx) {
    assert.match(lines[i + 1], /confirmation_sent_at\s*=\s*null/,
      'the confirmation marker is rewound in the same UPDATE as paid_at');
  }
});
