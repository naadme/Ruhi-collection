import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createPayload, sharedFromRow, blankVariant } from '../src/lib/productForm.js';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const PRODUCT = read('src/pages/Product.jsx');
const EDITOR = read('src/admin/ProductEditor.jsx');

// ---- the storefront preserves what the admin typed ------------------------

test('the product page renders the description with whitespace-pre-line', () => {
  // Without this class a browser collapses every newline and a three-paragraph
  // description renders as one run-on block.
  const line = PRODUCT.split('\n').find((l) => l.includes('whitespace-pre-line') && l.includes('desc'));
  assert.ok(line, 'the description is still rendered from p.desc');
  assert.match(line, /shownDescription\(p\.desc\)/,
    'rendered through the rule that trims only what a textarea leaves at the ends');
  assert.match(line, /whitespace-pre-line/,
    'line breaks typed in the admin must survive to the storefront');
});

test('the description is rendered as plain text, never as HTML', () => {
  // `whitespace-pre-line` formats text; it does not interpret it. The important
  // guarantee is that no raw HTML is injected.
  assert.doesNotMatch(PRODUCT, /dangerouslySetInnerHTML/);
  assert.match(PRODUCT, /shownDescription\(p\.desc\)/, 'the value stays inside a JSX expression, so it is escaped');
});

test('a description of nothing but spaces is no description at all', () => {
  // A row saved with whitespace only used to render as an empty paragraph —
  // a gap on the page where the section looked broken. `shownDescription`
  // trims the two ends (never the inside, where the owner's breaks live), so
  // such a row reads as having no description, and nothing is shown.
  const page = PRODUCT.slice(PRODUCT.indexOf('Description</h2>'))
  assert.match(page, /shownDescription\(p\.desc\) &&/, 'nothing is rendered when there is nothing to render')
});

// ---- the admin can actually type those breaks -----------------------------

test('the admin description field is a multiline textarea', () => {
  // The field is bound by value, not by name — look for the textarea that
  // writes the shared `desc`, which is the column the storefront renders.
  const at = EDITOR.indexOf('value={form.shared.desc}');
  assert.ok(at > -1, 'the editor still has a description field');
  const neighbourhood = EDITOR.slice(at - 400, at + 400);
  assert.match(neighbourhood, /<textarea/,
    'a single-line input would swallow the Enter key');
  assert.match(neighbourhood, /setShared\(\{ desc:/,
    'and it writes straight back to the description value');
});

test('multiline fields grow instead of being pinned to one line', () => {
  // The shared `textarea.cfield` class (checkout's delivery note) overrides
  // the single-line input height with a growing minimum.
  const css = read('src/index.css');
  assert.match(css, /textarea\.cfield\{[^}]*min-h-\[92px\]/);
  // The admin's own description field is explicitly multi-row and resizable.
  const at = EDITOR.indexOf('value={form.shared.desc}');
  const field = EDITOR.slice(at, at + 700);
  assert.match(field, /rows=\{4\}/);
  assert.match(field, /resize-y/);
});

test('the editor does not strip newlines out of the value it saves', () => {
  // The value is passed through as-is; nothing replaces \n on the way to the
  // database, which stores a plain `text` column.
  assert.doesNotMatch(EDITOR, /replace\(\/\\n\/g/);
  const db = read('supabase/migrations/20260928151147_products_admin_dashboard.sql');
  assert.match(db, /description\s+text/i, 'descriptions are stored as plain text, not HTML');
});

test('other multiline fields on the site keep the same treatment', () => {
  // Checkout's delivery note is free text a customer may span several lines;
  // it is already a textarea.
  const checkout = read('src/pages/Checkout.jsx');
  assert.match(checkout, /<textarea[^>]*id="co-note"/);
});

// ---- saving and re-opening does not collapse the formatting ----------------

test('a description round-trips through the save payload byte for byte', () => {
  const original = 'First paragraph.\n\nSecond paragraph.\n  Indented line.\n\tTabbed line.';
  // Read back the way the editor loads a row…
  const shared = sharedFromRow({ description: original, name: 'Linen Top', type: 'tops' });
  assert.equal(shared.desc, original, 'loading a row keeps the text as stored');
  // …and written back the way the editor saves it.
  const payload = createPayload(shared, { ...blankVariant('a'), colour: 'White', price: '700' });
  assert.equal(payload.description, original, 'saving sends the text unchanged');
  assert.ok(payload.description.includes('\n\n'), 'paragraph breaks survive the save');
  assert.ok(payload.description.includes('\t'), 'tabs survive the save');
});
