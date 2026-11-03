import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanProductUrl, productWhatsAppLink } from '../src/lib/whatsapp.js';

const textOf = (href) => new URL(href).searchParams.get('text');

test('the chat opens to the shop\'s number with the product named and linked', () => {
  const href = productWhatsAppLink({
    number: '919046651272',
    title: 'Embroidery Coord set',
    color: 'Pista green',
    size: 'M',
    price: '₹849',
    url: 'https://www.ruhi-collections.com/product/embroidery-coord-set-pista-green',
  });
  assert.ok(href.startsWith('https://wa.me/919046651272?text='));
  assert.equal(
    textOf(href),
    'Hi Ruhi, I have a question about the Embroidery Coord set (Pista green, size M) – ₹849.\n' +
      'https://www.ruhi-collections.com/product/embroidery-coord-set-pista-green',
  );
});

test('a size not chosen yet, or a single-colour product, is simply left out', () => {
  const href = productWhatsAppLink({
    number: '919046651272', title: 'Denim Dress', price: '₹900', url: 'https://x.test/product/denim-dress',
  });
  assert.equal(textOf(href), 'Hi Ruhi, I have a question about the Denim Dress – ₹900.\nhttps://x.test/product/denim-dress');
});

test('the product link carries no ad tags or click IDs', () => {
  assert.equal(
    cleanProductUrl('https://www.ruhi-collections.com', 'stripes-dress-blue'),
    'https://www.ruhi-collections.com/product/stripes-dress-blue',
  );
});
