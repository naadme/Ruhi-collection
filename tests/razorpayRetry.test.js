import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.join(process.cwd(), 'src/lib/razorpay.js'), 'utf8');

// Like razorpayScript.test.js, the module cannot be imported (it reads
// `import.meta.env`), so the real `openRazorpay` is taken from the source and
// run against a stand-in for Razorpay's Checkout. The loader is stubbed: these
// tests are about what happens once the window is open.
const START = 'export async function openRazorpay(';
const start = SRC.indexOf(START);
assert.ok(start !== -1, 'razorpay.js must define openRazorpay');
const openSource = SRC.slice(start).replace(/\bexport /g, '');
assert.ok(!openSource.includes('import.meta'), 'no Vite-only syntax reached openRazorpay');
// The window's name, logo and colour (12 Nov 2026) are constants above
// openRazorpay: take those exact lines too.
const brandSource = SRC.slice(SRC.indexOf('export const CHECKOUT_NAME ='), SRC.indexOf('/** The shopper closed Checkout'))
  .replace(/\bexport /g, '');
assert.ok(brandSource.includes('const checkoutLogo ='), 'the window branding was extracted');
assert.ok(!brandSource.includes('import.meta'), 'no Vite-only syntax reached the branding');

/** A fake `window.Razorpay` that lets a test play the shopper. */
function makeWindow() {
  const world = {};
  world.Razorpay = function Razorpay(options) {
    const listeners = {};
    world.checkout = {
      options,
      opened: false,
      // What Razorpay itself does, in the order it does it.
      fail(reason = '') { (listeners['payment.failed'] || []).forEach((fn) => fn({ error: { reason } })); },
      pay(response) { options.handler(response); },
      close() { options.modal.ondismiss(); },
    };
    this.on = (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); };
    this.open = () => { world.checkout.opened = true; };
  };
  return world;
}

function load(window) {
  return new Function(
    'window',
    `class PaymentCancelled extends Error {}
     class PaymentFailed extends Error {}
     class CheckoutUnavailable extends Error {}
     const loadRazorpay = () => Promise.resolve()
     ${brandSource}
     ${openSource}
     return { openRazorpay, PaymentCancelled, PaymentFailed }`,
  )(window);
}

const ARGS = { key: 'rzp_test_x', amount: 84900, currency: 'INR', orderId: 'order_1', description: 'Order 1' };
const PAID = { razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_1', razorpay_signature: 'sig' };
const tick = () => new Promise((r) => setImmediate(r));

test('a payment that succeeds on retry after a failed attempt is reported as paid', async () => {
  const w = makeWindow();
  const { openRazorpay } = load(w);
  const result = openRazorpay(ARGS);
  await tick();
  assert.ok(w.checkout.opened);

  w.checkout.fail('payment_failed'); // first UPI attempt fails, window stays open
  w.checkout.pay(PAID); // the retry in the same window goes through

  assert.deepEqual(await result, PAID);
});

test('several failed attempts and then a payment are still reported as paid', async () => {
  const w = makeWindow();
  const { openRazorpay } = load(w);
  const result = openRazorpay(ARGS);
  await tick();

  w.checkout.fail('instrument_declined');
  w.checkout.fail('payment_failed');
  w.checkout.pay(PAID);

  assert.deepEqual(await result, PAID);
});

test('events after a payment cannot turn it into a failure', async () => {
  const w = makeWindow();
  const { openRazorpay } = load(w);
  const result = openRazorpay(ARGS);
  await tick();

  w.checkout.pay(PAID);
  w.checkout.fail('payment_failed');
  w.checkout.close();

  assert.deepEqual(await result, PAID);
});

test('closing the window after a failed attempt reports the failure, not a cancel', async () => {
  const w = makeWindow();
  const { openRazorpay, PaymentFailed } = load(w);
  const result = openRazorpay(ARGS);
  await tick();

  w.checkout.fail('instrument_declined');
  w.checkout.close();

  await assert.rejects(result, (err) => err instanceof PaymentFailed && /bank declined/i.test(err.message));
});

test('closing the window without any attempt is a cancel', async () => {
  const w = makeWindow();
  const { openRazorpay, PaymentCancelled } = load(w);
  const result = openRazorpay(ARGS);
  await tick();

  w.checkout.close();

  await assert.rejects(result, (err) => err instanceof PaymentCancelled);
});

test('a straightforward payment resolves with Razorpay\'s response', async () => {
  const w = makeWindow();
  const { openRazorpay } = load(w);
  const result = openRazorpay(ARGS);
  await tick();

  w.checkout.pay(PAID);

  assert.deepEqual(await result, PAID);
});

// GA4's checkout_error (event schema of 8 Nov 2026) hears about every failed
// attempt through `onFailure`. Measuring must never change how a payment
// ends: a retry that pays is still paid, and a hook that throws is ignored.
test('onFailure hears each failed attempt with Razorpay\'s reason, and the payment still settles as before', async () => {
  const w = makeWindow();
  const { openRazorpay } = load(w);
  const heard = [];
  const result = openRazorpay({ ...ARGS, onFailure: (reason) => heard.push(reason) });
  await tick();
  w.checkout.fail('instrument_declined');
  w.checkout.fail('payment_failed');
  w.checkout.pay(PAID);
  assert.deepEqual(await result, PAID);
  assert.deepEqual(heard, ['instrument_declined', 'payment_failed']);
});

test('a closed window after a failure reports the failure with its reason, even if onFailure throws', async () => {
  const w = makeWindow();
  const { openRazorpay, PaymentFailed } = load(w);
  const result = openRazorpay({ ...ARGS, onFailure: () => { throw new Error('a bug in measuring') } });
  await tick();
  w.checkout.fail('instrument_declined');
  w.checkout.close();
  await assert.rejects(result, (err) => err instanceof PaymentFailed && err.reason === 'instrument_declined')
});

test('the window opens with the shop name, its logo on this site and the buy-button colour', async () => {
  const window = makeWindow();
  window.location = { origin: 'https://www.ruhi-collections.com' };
  const { openRazorpay } = load(window);
  const paying = openRazorpay(ARGS);
  await new Promise((r) => setTimeout(r, 0));
  const { options } = window.checkout;
  assert.equal(options.name, 'Ruhi Collections');
  assert.equal(options.image, 'https://www.ruhi-collections.com/images/ruhi-logo-square.jpg');
  assert.deepEqual(options.theme, { color: '#9A5E4F' });
  window.checkout.pay(PAID);
  assert.deepEqual(await paying, PAID);
});
