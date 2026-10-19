import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The rules are imported from the pure module on purpose: `bestsellers.js`
// pulls in the Supabase client, which plain Node cannot resolve (the same
// split as `categoryRules.js` / `couponRules.js`).
import { resolveBestsellers, MAX_BESTSELLERS, normalizePicks } from '../src/lib/bestsellerRules.js';
import { groupedCards } from '../src/lib/productGrouping.js';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const SQL = read('supabase/migrations/20261019150000_admin_bestsellers.sql');
const IO = read('src/lib/bestsellers.js');

// Two designs: one with three colour rows (so it becomes ONE grouped card),
// one single-colour row. Ids are the text slugs the catalogue really uses.
const ROWS = [
  { id: 'stripes-dress-pink', title: 'Stripes Dress - Pink', type: 'dress', colour: 'Pink', price: 900, image: '/p.jpg', is_active: true },
  { id: 'stripes-dress-blue', title: 'Stripes Dress - Blue', type: 'dress', colour: 'Blue', price: 900, image: '/b.jpg', is_active: true },
  { id: 'stripes-dress-red', title: 'Stripes Dress - Red', type: 'dress', colour: 'Red', price: 850, image: '/r.jpg', is_active: true },
  { id: 'linen-top-white', title: 'Linen Top', type: 'tops', colour: 'White', price: 700, image: '/w.jpg', is_active: true },
];
const CARDS = groupedCards(ROWS);

const pick = (...ids) => ids.map((product_id, position) => ({ product_id, position }));

// ---- resolving picks against real shop cards ------------------------------

test('a pick resolves to the grouped card, keeping the saved order', () => {
  const out = resolveBestsellers(pick('linen-top-white', 'stripes-dress-pink'), CARDS);
  assert.deepEqual(out.map((c) => c.title), ['Linen Top', 'Stripes Dress']);
});

test('picking ANY colour promotes the whole design', () => {
  // The card id is the cheapest colour (Red, 850) — but the owner may have
  // promoted it via the Pink row. Both must reach the same single card.
  const viaCard = resolveBestsellers(pick('stripes-dress-red'), CARDS);
  const viaOtherColour = resolveBestsellers(pick('stripes-dress-pink'), CARDS);
  assert.equal(viaCard.length, 1);
  assert.equal(viaOtherColour.length, 1);
  assert.equal(viaCard[0].id, viaOtherColour[0].id, 'same card either way');
});

test('a design promoted twice shows once', () => {
  const out = resolveBestsellers(pick('stripes-dress-pink', 'stripes-dress-blue', 'stripes-dress-red'), CARDS);
  assert.equal(out.length, 1, 'three colour rows of one design are one card');
});

test('a pick with no matching card is skipped, never rendered broken', () => {
  const out = resolveBestsellers(pick('deleted-design', 'linen-top-white'), CARDS);
  assert.deepEqual(out.map((c) => c.id), ['linen-top-white']);
});

test('no picks means no cards — the homepage falls back to its derived row', () => {
  assert.deepEqual(resolveBestsellers([], CARDS), []);
  assert.deepEqual(resolveBestsellers(undefined, CARDS), []);
  assert.deepEqual(resolveBestsellers(null, CARDS), []);
});

test('the list is capped, so the row can never become a catalogue dump', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, title: `P${i}`, type: 'tops', price: 100, is_active: true }));
  const picks = pick(...many.map((m) => m.id));
  assert.equal(resolveBestsellers(picks, groupedCards(many)).length, MAX_BESTSELLERS);
});

test('an empty catalogue resolves to nothing rather than throwing', () => {
  assert.deepEqual(resolveBestsellers(pick('anything'), []), []);
  assert.deepEqual(resolveBestsellers(pick('anything'), null), []);
});

test('normalizePicks trims, de-duplicates and never invents an id', () => {
  assert.deepEqual(normalizePicks([' a ', 'b', '', null, 'a', undefined]), ['a', 'b']);
  assert.deepEqual(normalizePicks('not-an-array'), []);
  assert.deepEqual(normalizePicks(null), []);
});

// ---- the Supabase-backed read/write ---------------------------------------

test('fetchBestsellers is exported for the panel and the homepage', () => {
  // Asserted on the source rather than imported: `bestsellers.js` pulls in the
  // Supabase client, which plain Node cannot load.
  assert.match(IO, /export async function fetchBestsellers\(/);
  assert.match(IO, /export async function saveBestsellers\(/);
  assert.match(IO, /export \{ MAX_BESTSELLERS, resolveBestsellers \} from '\.\/bestsellerRules'/);
});

test('a failed load is reported to the admin but never blanks the homepage', () => {
  assert.match(IO, /if \(strict\) throw e/, 'the admin panel gets the real error');
  assert.match(IO, /return \[\]\s*\n\s*\}/, 'the homepage quietly falls back to its derived row');
});

test('saving writes positions for the new list, then removes only the rest', () => {
  // Upsert-then-delete: a failure on the write leaves the old selection in
  // place rather than clearing it.
  const upsertAt = IO.indexOf('.upsert(');
  const deleteAt = IO.indexOf('.delete()');
  assert.ok(upsertAt > -1, 'the new selection is written');
  assert.ok(deleteAt > upsertAt, 'and only afterwards is anything removed');
  assert.doesNotMatch(IO, /\.delete\(\)\s*\n?\s*\.neq\('product_id', '__none__'\)/,
    'no delete-everything statement anywhere');
});

// ---- the migration itself --------------------------------------------------

test('the bestsellers table enables row level security', () => {
  assert.match(SQL, /alter table public\.bestsellers enable row level security/i);
});

test('the public may read the picks, but never write them', () => {
  assert.match(SQL, /grant\s+select on table public\.bestsellers to anon/i);
  assert.doesNotMatch(SQL, /grant\s+(insert|update|delete|all)[^;]*bestsellers[^;]*anon/is,
    'anon must never be given write access');
  // Every write policy is gated on the admin check and scoped to authenticated.
  const writes = SQL.match(/create policy "[^"]*"[\s\S]*?for (insert|update|delete)[\s\S]*?;/gi) || [];
  const bestsellerWrites = writes.filter((w) => /bestsellers/i.test(w));
  assert.equal(bestsellerWrites.length, 3, 'insert, update and delete policies');
  for (const w of bestsellerWrites) {
    assert.match(w, /to authenticated/i, 'write policies are for signed-in users only');
    assert.match(w, /is_admin\(\)/i, 'and only for admins');
  }
});

test('a pick points at a real product and is tidied up when that product goes', () => {
  assert.match(SQL, /references public\.products\s*\(id\)\s*on delete cascade/i,
    'cascade so a deleted design cannot leave the homepage pointing at nothing');
});

test('the migration writes no product, order or price row', () => {
  assert.doesNotMatch(SQL, /\bupdate\s+public\.products\b/i);
  assert.doesNotMatch(SQL, /\bdelete\s+from\s+public\.products\b/i);
  assert.doesNotMatch(SQL, /\bupdate\s+public\.orders\b/i);
  assert.doesNotMatch(SQL, /\binsert\s+into\s+public\.products\b/i);
});

test('re-running the migration is safe and the revert path is documented', () => {
  assert.match(SQL, /create table if not exists public\.bestsellers/i);
  assert.match(SQL, /drop policy if exists/i);
  assert.match(SQL, /To revert/i);
  assert.match(SQL, /drop table if exists public\.bestsellers/i);
});

test('the migration is wrapped in a transaction', () => {
  const begins = (SQL.match(/^\s*begin;\s*$/gim) || []).length;
  const commits = (SQL.match(/^\s*commit;\s*$/gim) || []).length;
  assert.equal(begins, 1);
  assert.equal(commits, 1);
  assert.ok(begins === commits);
});
