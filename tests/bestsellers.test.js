import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The rules are imported from the pure module on purpose: `bestsellers.js`
// pulls in the Supabase client, which plain Node cannot resolve (the same
// split as `categoryRules.js` / `couponRules.js`).
import { locatePicks, resolveBestsellers, MAX_BESTSELLERS, normalizePicks } from '../src/lib/bestsellerRules.js';
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
  // Asserted name-by-name rather than as one exact string, so this still checks
  // what it always did — that the pure rules are re-exported through here for
  // both consumers — while allowing the set of rules to grow.
  // Match the EXPORT, not the module's own import of the same path above it.
  const reExport = IO.split('\n')
    .find((line) => line.startsWith('export') && line.includes("'./bestsellerRules'"));
  assert.ok(reExport, "bestsellerRules is re-exported by bestsellers.js");
  for (const name of ['MAX_BESTSELLERS', 'resolveBestsellers', 'locatePicks']) {
    assert.ok(reExport.includes(name), `${name} is re-exported for the panel and the homepage`);
  }
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

// ---------------------------------------------------------------------------
// The panel's reorder/remove used a position read off the RENDERED list to
// index the SAVED list. Those two are not the same list, which is what made an
// arrow move the wrong row — or do nothing at all.
// ---------------------------------------------------------------------------

const PANEL = read('src/admin/BestsellerPanel.jsx');

test('locatePicks reports where each visible design sits in the SAVED list', () => {
  // A pick whose design is gone leaves a gap in the saved list but nothing on
  // screen — so the visible #2 is really saved #3.
  const picks = ['stripes-dress-red', 'gone-from-the-catalogue', 'linen-top-white'];
  const located = locatePicks(picks, CARDS);

  assert.equal(located.length, 2, 'the vanished design does not render');
  assert.deepEqual(located.map((e) => e.index), [0, 2],
    'the gap is preserved: the second visible card is at saved index 2, not 1');
  assert.deepEqual(located.map((e) => e.cardId), ['stripes-dress-red', 'linen-top-white']);
  assert.deepEqual(located.map((e) => e.pick), ['stripes-dress-red', 'linen-top-white']);
});

test('moving the two visible designs swaps their REAL slots and leaves the gap alone', () => {
  const picks = ['stripes-dress-red', 'gone-from-the-catalogue', 'linen-top-white'];
  const located = locatePicks(picks, CARDS);

  // Exactly what BestsellerPanel.move does with the two positions.
  const next = [...picks];
  const a = located[0].index;
  const b = located[1].index;
  const tmp = next[a]; next[a] = next[b]; next[b] = tmp;

  assert.equal(next[1], 'gone-from-the-catalogue',
    'the non-rendering entry keeps its own slot and is never disturbed');
  assert.deepEqual(locatePicks(next, CARDS).map((e) => e.cardId),
    ['linen-top-white', 'stripes-dress-red'], 'the two visible cards really swapped');

  // The old code swapped saved[0] with saved[1] instead — which would have
  // moved the vanished entry and left the rendered order completely unchanged,
  // i.e. an arrow that appears to do nothing.
  const naive = [...picks];
  [naive[0], naive[1]] = [naive[1], naive[0]];
  assert.deepEqual(locatePicks(naive, CARDS).map((e) => e.cardId),
    ['stripes-dress-red', 'linen-top-white'], 'the naive swap changes nothing on screen');
});

test('a pick naming a COLOUR ROW resolves to its card, at its own position', () => {
  // Stripes Dress becomes one card whose id is its cheapest row (Red, 850),
  // yet the owner may have promoted Pink.
  const picks = ['stripes-dress-pink', 'linen-top-white'];
  const located = locatePicks(picks, CARDS);

  assert.equal(located[0].cardId, 'stripes-dress-red', 'resolves to the grouped card');
  assert.equal(located[0].pick, 'stripes-dress-pink', 'keeps the id that was actually saved');
  assert.equal(located[0].index, 0);
  assert.equal(located[1].cardId, 'linen-top-white');
});

test('locatePicks and resolveBestsellers apply ONE rule — panel and homepage cannot disagree', () => {
  const cases = [
    ['stripes-dress-pink', 'linen-top-white'],
    ['stripes-dress-red', 'stripes-dress-pink'],
    ['linen-top-white', 'nope', 'stripes-dress-blue'],
    [],
  ];
  for (const picks of cases) {
    const viaLocate = locatePicks(picks, CARDS).map((e) => e.card);
    const viaResolve = resolveBestsellers(picks.map((product_id) => ({ product_id })), CARDS);
    assert.deepEqual(viaLocate, viaResolve, `same cards for ${JSON.stringify(picks)}`);
  }
});

test('duplicate picks collapse to one card and only the first slot is reported', () => {
  const located = locatePicks(['stripes-dress-pink', 'stripes-dress-red', 'stripes-dress-blue'], CARDS);
  assert.equal(located.length, 1, 'three colour rows of one design render once');
  assert.equal(located[0].index, 0, 'the first slot wins');
});

test('the panel reorders and removes by CARD, never by a rendered array index', () => {
  assert.match(PANEL, /const move = \(cardId, dir\)/, 'move takes the card id');
  assert.match(PANEL, /const remove = \(cardId\)/, 'remove takes the card id');
  assert.match(PANEL, /onMove=\{\(dir\) => move\(card\.id, dir\)\}/,
    'the arrow passes the card it is rendered on, not its position');
  // Both must resolve from the state they are about to write, so two quick
  // clicks cannot act on positions computed before the first one landed.
  assert.match(PANEL, /locatePicks\(s\.picks, cards\)/);
  // The rendered list must never be used to index state.picks again.
  assert.ok(!/move\(i, dir\)/.test(PANEL), 'no positional move call survives');
  // And resolution comes from the shared rule, not a private copy.
  assert.match(PANEL, /locatePicks\(state\.picks, cards\)/);
});
