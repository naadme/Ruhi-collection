import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const SRC = read('src/lib/razorpay.js');

// The loader cannot be imported directly — the module reads `import.meta.env`,
// which only Vite defines. So take the exact lines that implement script
// loading (constants, the error type, `scriptPromise` + `loadScript` +
// `loadRazorpay`) and run them against a stubbed DOM. Nothing is re-implemented
// here: if the loader regresses, these tests read the regression.

function wholeLine(marker) {
  const s = SRC.indexOf(marker);
  assert.ok(s !== -1, `razorpay.js must contain: ${marker}`);
  const e = SRC.indexOf('\n', s);
  return SRC.slice(s, e === -1 ? SRC.length : e);
}

const END_MARKER = '/**\n * Open Razorpay Checkout.';
const loaderSource = [
  wholeLine('const SCRIPT_SRC ='),
  wholeLine('const SCRIPT_TIMEOUT_MS ='),
  wholeLine('export class CheckoutUnavailable'),
  SRC.slice(SRC.indexOf('let scriptPromise = null'), SRC.indexOf(END_MARKER)),
]
  .join('\n')
  .replace(/\bexport /g, '')
  // 12s would make these tests take a minute; the behaviour under test is
  // identical, only the wait is shorter.
  .replace('const SCRIPT_TIMEOUT_MS = 12000', 'const SCRIPT_TIMEOUT_MS = 60');

assert.ok(loaderSource.includes('function loadScript()'), 'loader was extracted');
assert.ok(!loaderSource.includes('import.meta'), 'no Vite-only syntax reached the loader');

/** A tiny stand-in for the bits of the DOM the loader touches. */
function makeWorld() {
  let created = 0;
  const makeEl = () => {
    const listeners = { load: [], error: [] };
    const el = {
      tagName: 'SCRIPT',
      src: '',
      async: false,
      parentNode: null,
      addEventListener(type, fn) { listeners[type].push(fn); },
      removeEventListener(type, fn) { listeners[type] = listeners[type].filter((f) => f !== fn); },
      remove() { if (el.parentNode) el.parentNode.removeChild(el); },
      fire(type) { [...listeners[type]].forEach((f) => f()); },
      pending() { return listeners.load.length + listeners.error.length; },
    };
    return el;
  };
  const head = {
    children: [],
    appendChild(el) { el.parentNode = head; head.children.push(el); },
    removeChild(el) { head.children = head.children.filter((c) => c !== el); el.parentNode = null; },
  };
  const document = {
    head,
    createElement() { created += 1; return makeEl(); },
    // `script[src="…"]` — only the one script this page ever adds.
    querySelector() { return head.children.find((c) => c.tagName === 'SCRIPT') || null; },
  };
  return { document, window: {}, head, created: () => created };
}

const makeLoader = (w) =>
  new Function('document', 'window', `${loaderSource}\nreturn { loadRazorpay, SCRIPT_SRC };`)(
    w.document,
    w.window,
  );

const UNREACHABLE = /payment window|connection|unavailable/i;

test('a failed load does not poison every later retry', async () => {
  const w = makeWorld();
  const { loadRazorpay } = makeLoader(w);

  const first = loadRazorpay();
  assert.equal(w.created(), 1, 'the first attempt appends exactly one script');
  assert.equal(w.head.children.length, 1);
  w.head.children[0].fire('error');
  await assert.rejects(first, UNREACHABLE, 'the shopper sees a real error, not a hang');

  // THIS is the defect: the dead element used to stay in the document, so the
  // `existing` lookup handed it straight back, no new fetch happened, and the
  // next attempt only ever ended at the timeout. A shopper whose first attempt
  // hit a blocked/flaky CDN could never pay again without reloading the page.
  assert.equal(w.head.children.length, 0, 'the dead script is detached');
  assert.equal(w.head.children[0], undefined);

  const second = loadRazorpay();
  assert.equal(w.created(), 2, 'a SECOND element is created, so the browser really re-fetches');
  w.head.children[0].fire('error');
  await assert.rejects(second, UNREACHABLE);
  assert.equal(w.head.children.length, 0, 'the second failure is cleaned up too');
});

test('a load that never answers is abandoned and retried cleanly', async () => {
  const w = makeWorld();
  const { loadRazorpay } = makeLoader(w);

  const first = loadRazorpay(); // nobody ever fires load or error
  await assert.rejects(first, UNREACHABLE, 'the wait is bounded, never infinite');

  assert.equal(w.head.children.length, 0, 'the stalled script is detached');
  assert.equal(w.created(), 1);

  const second = loadRazorpay();
  assert.equal(w.created(), 2, 'the retry fetches again instead of waiting on a corpse');
  w.head.children[0].fire('error');
  await assert.rejects(second, UNREACHABLE);
});

test('a SUCCESSFUL load is kept, so paying does not re-download checkout.js', async () => {
  const w = makeWorld();
  const { loadRazorpay } = makeLoader(w);

  const first = loadRazorpay();
  w.head.children[0].fire('load');
  await first; // resolves

  assert.equal(w.head.children.length, 1,
    'only failures detach: an element that loaded must stay, or every payment re-fetches');
  w.window.Razorpay = function Razorpay() {};
  await loadRazorpay(); // short-circuits on window.Razorpay
  assert.equal(w.created(), 1, 'no second element once checkout.js is available');
});

test('both failure paths really do clear the cached promise', () => {
  // `scriptPromise = null` is what lets the next call rebuild instead of
  // returning the same rejected promise forever.
  const errorPath = SRC.slice(SRC.indexOf('const onError ='), SRC.indexOf('const finish ='));
  const timeoutPath = SRC.slice(SRC.indexOf('timer = setTimeout'), SRC.indexOf('}, SCRIPT_TIMEOUT_MS)'));
  for (const [label, block] of [['error', errorPath], ['timeout', timeoutPath]]) {
    assert.match(block, /scriptPromise = null/, `${label} path clears the cached promise`);
    assert.match(block, /detach\(\)/, `${label} path detaches the dead script element`);
  }
});
