import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filterAndSortOrders, orderSearchText } from '../src/lib/orderFiltering.js';

// Timestamps are built in the LOCAL timezone on purpose. An
// `<input type="date">` means "this day where the admin is", so a day boundary
// is a local midnight — fixtures written as raw UTC instants would drift across
// it and make these tests depend on the machine's timezone.
const localISO = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi, 0).toISOString();

const order = (id, created_at, extra = {}) => ({
  id, reference: `RCH-${id}`, created_at, status: 'pending',
  full_name: `Customer ${id}`, email: `c${id}@example.com`,
  ...extra,
});

// Deliberately inserted oldest-first so every sort assertion is doing work.
const ORDERS = [
  order('a', localISO(2026, 1, 5, 10), { status: 'delivered', city: 'Pune' }),
  order('b', localISO(2026, 3, 15, 10), { status: 'pending', city: 'Mumbai' }),
  order('c', localISO(2026, 3, 15, 18, 30), { status: 'pending', city: 'Delhi' }),
  order('d', localISO(2026, 6, 20, 10), { status: 'cancelled', city: 'Pune' }),
];

const ids = (rows) => rows.map((o) => o.id);

// ---- date sorting ---------------------------------------------------------

test('defaults to newest first', () => {
  assert.deepEqual(ids(filterAndSortOrders(ORDERS)), ['d', 'c', 'b', 'a']);
});

test('oldest first reverses the order', () => {
  assert.deepEqual(ids(filterAndSortOrders(ORDERS, { sort: 'oldest' })), ['a', 'b', 'c', 'd']);
});

test('sorting uses created_at — the moment the order was placed', () => {
  // `updated_at` moves whenever an admin edits a status; it must not reorder
  // the list. Order b was touched long after order d.
  const orders = [
    order('d', localISO(2026, 6, 20, 10), { updated_at: localISO(2026, 1, 1) }),
    order('b', localISO(2026, 3, 15, 10), { updated_at: localISO(2026, 12, 31) }),
  ];
  assert.deepEqual(ids(filterAndSortOrders(orders)), ['d', 'b']);
  assert.deepEqual(ids(filterAndSortOrders(orders, { sort: 'oldest' })), ['b', 'd']);
});

test('orders sharing a timestamp keep a stable relative order', () => {
  const same = [order('x', localISO(2026, 5, 1, 10)), order('y', localISO(2026, 5, 1, 10))];
  assert.deepEqual(ids(filterAndSortOrders(same)), ['x', 'y']);
  assert.deepEqual(ids(filterAndSortOrders(same, { sort: 'oldest' })), ['x', 'y']);
});

test('an unparseable date sinks to the end instead of jumping the queue', () => {
  const orders = [order('ok', localISO(2026, 5, 1, 10)), order('bad', 'not-a-date')];
  // Both directions: an order whose timestamp cannot be read is never allowed
  // to float to the top of a date sort.
  assert.deepEqual(ids(filterAndSortOrders(orders)), ['ok', 'bad']);
  assert.deepEqual(ids(filterAndSortOrders(orders, { sort: 'oldest' })), ['ok', 'bad']);
});

// ---- date range -----------------------------------------------------------

test('a from date is inclusive of that whole day', () => {
  // b and c are both on 15 March; a "from 15 March" filter keeps both.
  assert.deepEqual(ids(filterAndSortOrders(ORDERS, { from: '2026-03-15' })), ['d', 'c', 'b']);
});

test('a to date is inclusive of that whole day', () => {
  assert.deepEqual(ids(filterAndSortOrders(ORDERS, { to: '2026-03-15' })), ['c', 'b', 'a']);
});

test('a range bounds both ends and keeps sorting inside it', () => {
  assert.deepEqual(ids(filterAndSortOrders(ORDERS, { from: '2026-03-15', to: '2026-03-15' })), ['c', 'b']);
  assert.deepEqual(
    ids(filterAndSortOrders(ORDERS, { from: '2026-01-01', to: '2026-12-31', sort: 'oldest' })),
    ['a', 'b', 'c', 'd'],
  );
});

test('an order placed at 23:59 still counts as that day', () => {
  const orders = [order('late', localISO(2026, 3, 15, 23, 59))];
  assert.deepEqual(ids(filterAndSortOrders(orders, { to: '2026-03-15' })), ['late']);
  assert.deepEqual(ids(filterAndSortOrders(orders, { from: '2026-03-15', to: '2026-03-15' })), ['late']);
  // …and just past midnight is the NEXT day, not this one.
  const after = [order('next', localISO(2026, 3, 16, 0, 1))];
  assert.deepEqual(ids(filterAndSortOrders(after, { from: '2026-03-15', to: '2026-03-15' })), []);
});

test('orders outside the range are excluded in either direction', () => {
  assert.deepEqual(ids(filterAndSortOrders(ORDERS, { from: '2026-07-01' })), []);
  assert.deepEqual(ids(filterAndSortOrders(ORDERS, { to: '2026-01-01' })), []);
});

test('a malformed range is ignored rather than hiding every order', () => {
  assert.deepEqual(ids(filterAndSortOrders(ORDERS, { from: '', to: '' })).length, 4);
  assert.deepEqual(ids(filterAndSortOrders(ORDERS, { from: 'nonsense' })).length, 4);
});

// ---- status + search combine with sorting ---------------------------------

test('status filter applies before the sort', () => {
  assert.deepEqual(ids(filterAndSortOrders(ORDERS, { status: 'pending' })), ['c', 'b']);
  assert.deepEqual(ids(filterAndSortOrders(ORDERS, { status: 'pending', sort: 'oldest' })), ['b', 'c']);
});

test('search, status and date range compose', () => {
  assert.deepEqual(
    ids(filterAndSortOrders(ORDERS, { status: 'pending', query: 'pune' })),
    [],
    'a pending Pune order does not exist',
  );
  assert.deepEqual(ids(filterAndSortOrders(ORDERS, { query: 'pune' })), ['d', 'a']);
  assert.deepEqual(
    ids(filterAndSortOrders(ORDERS, { query: 'pune', from: '2026-01-01', to: '2026-01-31' })),
    ['a'],
  );
});

test('search is case-insensitive and spans the reference and contact fields', () => {
  assert.deepEqual(ids(filterAndSortOrders(ORDERS, { query: 'rch-b' })), ['b']);
  // Order c's email is cc@example.com; a shouted needle must still match it.
  assert.deepEqual(ids(filterAndSortOrders(ORDERS, { query: 'CC@EXAMPLE.COM' })), ['c']);
});

test('the search haystack never invents fields', () => {
  // Lower-cased once, here, so the panel never has to compare case.
  assert.equal(orderSearchText(order('z', '2026-01-01', { city: 'Pune', pincode: '411001' })),
    'rch-z customer z cz@example.com pune 411001');
  assert.equal(orderSearchText(null), '');
});

// ---- the whole set, never one page ----------------------------------------

test('sorting runs over EVERY order, not a visible slice', () => {
  // 60 orders across 5 months. Whatever slice a caller passes in is sorted as
  // a whole — there is no "first N" behaviour that could hide an older order.
  const many = Array.from({ length: 60 }, (_, i) => order(
    String(i).padStart(2, '0'),
    `2026-${String((i % 5) + 1).padStart(2, '0')}-10T10:00:00+00:00`,
  ));
  const newest = filterAndSortOrders(many);
  assert.equal(newest.length, 60, 'no order is dropped by sorting');
  const times = newest.map((o) => new Date(o.created_at).getTime());
  assert.deepEqual(times, [...times].sort((x, y) => y - x), 'strictly newest-first');
  const oldest = filterAndSortOrders(many, { sort: 'oldest' });
  const oldestTimes = oldest.map((o) => new Date(o.created_at).getTime());
  assert.deepEqual(oldestTimes, [...oldestTimes].sort((x, y) => x - y), 'strictly oldest-first');
});

// ---- defensive ------------------------------------------------------------

test('empty and malformed input never throw', () => {
  assert.deepEqual(filterAndSortOrders(undefined), []);
  assert.deepEqual(filterAndSortOrders(null), []);
  assert.deepEqual(filterAndSortOrders([]), []);
  assert.deepEqual(filterAndSortOrders([null, undefined]), []);
  assert.deepEqual(ids(filterAndSortOrders(ORDERS, null)), ['d', 'c', 'b', 'a'], 'a null opts object is just the default');
});
