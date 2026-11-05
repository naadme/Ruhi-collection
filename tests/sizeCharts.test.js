import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIZE_CHARTS, chartsFor, rowsFor, toCm } from '../src/lib/sizeCharts.js';

const row = (chart, size) => SIZE_CHARTS[chart].rows.find((r) => r.size === size);

test('the tops chart is the owner\'s chart, size by size', () => {
  assert.deepEqual(SIZE_CHARTS.tops.rows.map((r) => r.size), ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL']);
  assert.deepEqual(row('tops', 'XS'), { size: 'XS', bust: 34, waist: 28, hip: 36, shoulder: 14, armhole: 16 });
  assert.deepEqual(row('tops', 'M'), { size: 'M', bust: 38, waist: 32, hip: 40, shoulder: 15, armhole: 18 });
  assert.deepEqual(row('tops', 'L'), { size: 'L', bust: 40, waist: 34, hip: 42, shoulder: 15.5, armhole: 19 });
  assert.deepEqual(row('tops', 'XXXL'), { size: 'XXXL', bust: 46, waist: 40, hip: 48, shoulder: 16.5, armhole: 22 });
  assert.deepEqual(row('tops', 'XXXXL'), { size: 'XXXXL', bust: 48, waist: 42, hip: 50, shoulder: 17, armhole: 23 });
});

test('the bottoms chart is waist only: S 30 to XXL 38', () => {
  assert.deepEqual(SIZE_CHARTS.bottoms.rows, [
    { size: 'S', waist: 30 }, { size: 'M', waist: 32 }, { size: 'L', waist: 34 },
    { size: 'XL', waist: 36 }, { size: 'XXL', waist: 38 },
  ]);
});

test('each category gets the right chart; sets get both; an unknown one gets both', () => {
  const keys = (type) => chartsFor(type).map((c) => c.key);
  assert.deepEqual(keys('tops'), ['tops']);
  assert.deepEqual(keys('dress'), ['tops']);
  assert.deepEqual(keys('trousers'), ['bottoms']);
  assert.deepEqual(keys('coord'), ['tops', 'bottoms']);
  assert.deepEqual(keys('winter-wear'), ['tops', 'bottoms']);
  assert.deepEqual(keys('a-category-added-later'), ['tops', 'bottoms']);
});

test('a product page shows only the sizes the product comes in', () => {
  assert.deepEqual(rowsFor(SIZE_CHARTS.tops, ['L', 'XL', 'M']).map((r) => r.size), ['M', 'L', 'XL']);
  assert.deepEqual(rowsFor(SIZE_CHARTS.bottoms, ['s', ' M ']).map((r) => r.size), ['S', 'M']);
});

test('a size the chart does not know never hides the chart', () => {
  assert.equal(rowsFor(SIZE_CHARTS.tops, ['M', 'Free size']).length, SIZE_CHARTS.tops.rows.length);
  assert.equal(rowsFor(SIZE_CHARTS.bottoms, []).length, SIZE_CHARTS.bottoms.rows.length);
});

test('every size sold today has a row in every chart its category shows', () => {
  // Live catalogue on 5 Nov 2026: S, M, L and XL across all categories.
  for (const type of ['tops', 'dress', 'trousers', 'coord', 'winter-wear']) {
    for (const chart of chartsFor(type)) {
      assert.equal(rowsFor(chart, ['S', 'M', 'L', 'XL']).length, 4, `${type} / ${chart.key}`);
    }
  }
});

test('centimetres', () => {
  assert.equal(toCm(38), 96.5);
  assert.equal(toCm(15.5), 39.4);
});
