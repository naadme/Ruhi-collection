// Razorpay's window introduces the shop by the name it is GST-registered
// under, with its logo and buy-button colour, and its script is fetched while
// the shopper is still filling in the form (12 Nov 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const SRC = read('src/lib/razorpay.js');
const CHECKOUT = read('src/pages/Checkout.jsx');
const TAILWIND = read('tailwind.config.js');

const constant = (name) => {
  const m = SRC.match(new RegExp(`export const ${name} = '([^']+)'`));
  assert.ok(m, `razorpay.js defines ${name}`);
  return m[1];
};

test('the window carries the shop name, its logo and the buy-button colour', () => {
  assert.equal(constant('CHECKOUT_NAME'), 'Ruhi Collections');
  const options = SRC.slice(SRC.indexOf('new window.Razorpay({'), SRC.indexOf('handler:'));
  assert.match(options, /name: CHECKOUT_NAME,/);
  assert.match(options, /image: checkoutLogo\(\),/);
  assert.match(options, /theme: \{ color: CHECKOUT_COLOR \}/);
  assert.doesNotMatch(options, /Ruhi Womens Clothing|#C08576/i, 'the old name and the greyed-out rose are gone');
  // The colour is the site's own buy button (brand.cta), not a copy that can drift.
  const cta = TAILWIND.match(/cta: '(#[0-9A-Fa-f]{6})'/);
  assert.ok(cta, 'tailwind.config.js defines brand.cta');
  assert.equal(constant('CHECKOUT_COLOR').toLowerCase(), cta[1].toLowerCase());
});

test('the logo exists, is square and is at least 256 px — the size payment windows show well', () => {
  const rel = `public${constant('CHECKOUT_LOGO_PATH')}`;
  const jpg = fs.readFileSync(path.join(process.cwd(), rel));
  assert.equal(jpg[0], 0xff); assert.equal(jpg[1], 0xd8, `${rel} is a JPEG`);
  let size = null;
  for (let i = 2; i < jpg.length - 9; ) {
    if (jpg[i] !== 0xff) { i += 1; continue; }
    const marker = jpg[i + 1];
    const length = jpg.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) { size = { h: jpg.readUInt16BE(i + 5), w: jpg.readUInt16BE(i + 7) }; break; }
    i += 2 + length;
  }
  assert.ok(size, 'found the JPEG frame header');
  assert.equal(size.w, size.h, `square, got ${size.w}×${size.h}`);
  assert.ok(size.w >= 256, `at least 256 px, got ${size.w}`);
  assert.ok(jpg.length < 100_000, 'small enough for a phone on mobile data');
});

test('the logo is sent as an absolute address on this site, and only where there is a window', () => {
  const fn = SRC.slice(SRC.indexOf('const checkoutLogo ='), SRC.indexOf('/** The shopper closed Checkout'));
  const checkoutLogo = new Function('CHECKOUT_LOGO_PATH', 'window', `${fn.replace('const checkoutLogo =', 'return (')})`)
    (constant('CHECKOUT_LOGO_PATH'), { location: { origin: 'https://www.ruhi-collections.com' } });
  assert.equal(checkoutLogo(), 'https://www.ruhi-collections.com/images/ruhi-logo-square.jpg');
  const noWindow = new Function('CHECKOUT_LOGO_PATH', 'window', `${fn.replace('const checkoutLogo =', 'return (')})`)
    (constant('CHECKOUT_LOGO_PATH'), undefined);
  assert.equal(noWindow(), undefined);
});

test('preloadRazorpay starts the script once online payment is on, and never throws', async () => {
  const body = SRC.slice(SRC.indexOf('export function preloadRazorpay'));
  const make = (ready, load) => new Function('onlinePaymentReady', 'loadRazorpay', `${body.replace('export ', '')}\nreturn preloadRazorpay`)(ready, load);

  let calls = 0;
  make(false, () => { calls += 1; return Promise.resolve(); })();
  assert.equal(calls, 0, 'a build without a Razorpay key loads nothing');

  make(true, () => { calls += 1; return Promise.resolve(); })();
  assert.equal(calls, 1, 'with a key, the script starts loading');

  // A failed preload is swallowed (the loader clears itself, and Pay retries).
  let unhandled = 0;
  const onUnhandled = () => { unhandled += 1; };
  process.on('unhandledRejection', onUnhandled);
  make(true, () => Promise.reject(new Error('offline')))();
  await new Promise((r) => setTimeout(r, 20));
  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled, 0, 'no unhandled rejection');
});

test('the checkout page preloads the script as soon as it has something to pay for', () => {
  assert.match(CHECKOUT, /import \{[^}]*\bpreloadRazorpay\b[^}]*\} from '\.\.\/lib\/razorpay'/);
  assert.match(CHECKOUT, /const hasLines = lines\.length > 0\n\s*useEffect\(\(\) => \{ if \(hasLines\) preloadRazorpay\(\) \}, \[hasLines\]\)/);
});
