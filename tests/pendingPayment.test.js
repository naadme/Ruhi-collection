import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// A Map-backed localStorage, enough for src/lib/pendingPayment.js.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const { savePendingPayment, loadPendingPayment, clearPendingPayment, PENDING_PAYMENT_TTL_MS } =
  await import('../src/lib/pendingPayment.js');

const CUSTOMER = { full_name: 'Priya Sharma', email: 'priya@example.com', phone: '9876543210' };

beforeEach(() => store.clear());

test('a payment saved before the window opens is found again after a reload', () => {
  savePendingPayment({ reference: '03112605', razorpay_order_id: 'order_abc', customer: CUSTOMER }, 1000);
  assert.deepEqual(loadPendingPayment(2000), { reference: '03112605', razorpay_order_id: 'order_abc', customer: CUSTOMER, amount: null });
});

test('the amount the Razorpay order charges travels with the payment (22 Nov 2026)', () => {
  savePendingPayment({ reference: '22112601', razorpay_order_id: 'order_abc', customer: CUSTOMER, amount: 84900 }, 1000);
  assert.equal(loadPendingPayment(2000).amount, 84900);
});

test('a missing or broken amount reads as unknown, never as a number', () => {
  for (const amount of [undefined, null, 0, -100, 849.5, '84900', 'abc']) {
    store.clear();
    store.set('ruhi:pending-payment', JSON.stringify({ reference: 'r', razorpay_order_id: 'o', amount, at: Date.now() }));
    assert.equal(loadPendingPayment().amount, null, `amount ${JSON.stringify(amount)}`);
  }
});

test('a stale payment is dropped rather than checked', () => {
  savePendingPayment({ reference: '03112605', razorpay_order_id: 'order_abc' }, 1000);
  assert.equal(loadPendingPayment(1000 + PENDING_PAYMENT_TTL_MS), null);
  assert.equal(store.size, 0, 'the stale record is removed');
});

test('nothing is saved without both ids', () => {
  savePendingPayment({ reference: '03112605' });
  savePendingPayment({ razorpay_order_id: 'order_abc' });
  assert.equal(store.size, 0);
});

test('a malformed record is ignored', () => {
  store.set('ruhi:pending-payment', '{not json');
  assert.equal(loadPendingPayment(), null);
  store.set('ruhi:pending-payment', JSON.stringify({ reference: 'x' }));
  assert.equal(loadPendingPayment(), null);
});

test('clearing forgets the payment', () => {
  savePendingPayment({ reference: '03112605', razorpay_order_id: 'order_abc' });
  clearPendingPayment();
  assert.equal(loadPendingPayment(), null);
});

test('a browser that refuses storage does not break checkout', () => {
  const saved = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  try {
    assert.doesNotThrow(() => savePendingPayment({ reference: 'r', razorpay_order_id: 'o' }));
    assert.equal(loadPendingPayment(), null);
    assert.doesNotThrow(() => clearPendingPayment());
  } finally {
    globalThis.localStorage = saved;
  }
});
