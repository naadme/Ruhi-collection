import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { colName } from '../src/lib/xlsx.js';
import { EXPORT_COLUMNS, ordersToRows, ordersWorkbook } from '../src/admin/orderExport.js';

/** Extract (name -> bytes) from the store-only zip our writer produces. */
function unzip(buf) {
  const out = new Map();
  let off = 0;
  while (off + 4 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const method = buf.readUInt16LE(off + 8);
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = new TextDecoder().decode(buf.subarray(off + 30, off + 30 + nameLen));
    const dataStart = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error(`expected stored entry, got method ${method}`);
    out.set(name, Buffer.from(buf.subarray(dataStart, dataStart + compSize)));
    off = dataStart + compSize;
  }
  return out;
}

// column offsets in EXPORT_COLUMNS
const C = Object.fromEntries(EXPORT_COLUMNS.map((label, i) => [label, i]));

test('colName converts indexes to spreadsheet columns', () => {
  assert.equal(colName(0), 'A');
  assert.equal(colName(25), 'Z');
  assert.equal(colName(26), 'AA');
  assert.equal(colName(51), 'AZ');
  assert.equal(colName(52), 'BA');
});

test('every local zip entry passes its stored CRC-32 (matches zlib.crc32)', () => {
  const buf = Buffer.from(ordersWorkbook([{ reference: 'R1', order_items: [] }]));
  let off = 0;
  let seen = 0;
  while (off + 4 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const crc = buf.readUInt32LE(off + 14);
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const dataStart = off + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    assert.equal(zlib.crc32(data), crc);
    seen += 1;
    off = dataStart + compSize;
  }
  assert.ok(seen >= 4, 'workbook has multiple parts');
  assert.equal(buf.readUInt32LE(off), 0x02014b50, 'central directory follows local entries');
});

const order = {
  id: 'o1',
  reference: 'RUI-0001',
  full_name: 'Asha',
  phone: '9999999999',
  email: 'a@b.c',
  pincode: '600001',
  address: '12 MG Road',
  subtotal: 1200,
  shipping: 80,
  total: 1280,
  payment_method: 'razorpay',
  payment_status: 'paid',
  status: 'confirmed',
  note: 'gift wrap',
  created_at: '2026-10-10T10:00:00+00:00',
  coupon_code: 'WELCOME10',
  discount: 120,
  order_items: [
    { product_id: 'p1', title: 'Anarkali Kurta - Crimson Red', size: 'M', unit_price: 600, qty: 1 },
    { product_id: 'p1', title: 'Anarkali Kurta - Crimson Red', size: 'L', unit_price: 600, qty: 1 },
  ],
};

test('one spreadsheet row per item; order money only on the first row', () => {
  const rows = ordersToRows([order]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, EXPORT_COLUMNS.length);
  assert.equal(rows[1].length, EXPORT_COLUMNS.length);

  const [r1, r2] = rows;
  // item facts on every row
  assert.equal(r1[C['Order ID']], 'RUI-0001');
  for (const r of rows) {
    assert.equal(r[C.Product], 'Anarkali Kurta - Crimson Red');
    assert.equal(r[C.Colour], 'Crimson Red');
  }
  assert.equal(r1[C.Size], 'M');
  assert.equal(r2[C.Size], 'L');
  assert.equal(r1[C['Item price']], 600);
  assert.equal(r1[C['Item total']], 600);

  // order money only on the first row (so sums never double-count)
  assert.equal(r1[C['Coupon code']], 'WELCOME10');
  assert.equal(r1[C.Discount], 120);
  assert.equal(r1[C.Subtotal], 1200);
  assert.equal(r1[C.Shipping], 80);
  assert.equal(r1[C['Order total']], 1280);
  assert.equal(r1[C['Delivery note']], 'gift wrap');
  assert.equal(r2[C['Coupon code']], '');
  assert.equal(r2[C.Discount], '');
  assert.equal(r2[C.Subtotal], '');
  assert.equal(r2[C['Order total']], '');

  // colour parsed out of the title
  assert.equal(r1[C.Colour], 'Crimson Red');
});

test('legacy orders without coupon/discount export blank coupon cells', () => {
  const legacy = { ...order, coupon_code: undefined, discount: undefined, order_items: order.order_items.slice(0, 1) };
  const [r] = ordersToRows([legacy]);
  assert.equal(r[C['Coupon code']], '');
  assert.equal(r[C.Discount], 0);
  assert.equal(r[C['Order total']], 1280);
});

test('orders with no items still export one row carrying the order facts', () => {
  const [r] = ordersToRows([{ ...order, order_items: [] }]);
  assert.equal(r.length, EXPORT_COLUMNS.length);
  assert.equal(r[C['Order ID']], 'RUI-0001');
  assert.equal(r[C['Order total']], 1280);
  assert.equal(r[C.Product], '');
});

test('workbook contains the expected headers and data cells', () => {
  const buf = Buffer.from(ordersWorkbook([order]));
  assert.ok(buf.length > 500, 'file has content');
  const entries = unzip(buf);
  assert.ok(entries.has('xl/workbook.xml'));
  assert.ok(entries.has('xl/worksheets/sheet1.xml'));
  const sheet = entries.get('xl/worksheets/sheet1.xml').toString('utf8');
  for (const label of EXPORT_COLUMNS) assert.ok(sheet.includes(label), `header: ${label}`);
  assert.ok(sheet.includes('Anarkali Kurta - Crimson Red'));
  assert.ok(sheet.includes('WELCOME10'));
  assert.ok(sheet.includes('t="inlineStr"'), 'cells use inline strings');
});
