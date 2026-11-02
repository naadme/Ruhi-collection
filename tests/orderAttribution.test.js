// The ad visit saved on an order (tracking brief, Section 4, step 4): only the
// brief's columns, every value exactly as received, and nothing that is not a
// real value.

import test from 'node:test'
import assert from 'node:assert/strict'

import { ATTRIBUTION_COLUMNS, attributionColumns } from '../supabase/functions/_shared/attribution.mjs'

test('the brief’s columns, in its order', () => {
  assert.deepEqual(ATTRIBUTION_COLUMNS, [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'gclid', 'gbraid', 'wbraid', 'fbc', 'fbp',
  ])
})

test('values are kept exactly as received, case and spaces included', () => {
  assert.deepEqual(attributionColumns({
    utm_campaign: 'Diwali_Sale_2026', utm_term: 'anarkali kurta', gclid: 'Cj0KCQjwAbC-DeF_ghI',
    landing_page: 'https://www.ruhi-collections.com/?utm_source=Google', landing_time: '2026-11-02T09:55:00.000Z',
  }), {
    utm_campaign: 'Diwali_Sale_2026', utm_term: 'anarkali kurta', gclid: 'Cj0KCQjwAbC-DeF_ghI',
    landing_page: 'https://www.ruhi-collections.com/?utm_source=Google', landing_time: '2026-11-02T09:55:00.000Z',
  })
})

test('placeholders, empty strings, non-strings and oversize values stay out', () => {
  assert.deepEqual(attributionColumns({
    utm_source: 'undefined', utm_medium: 'NA', utm_content: '  ', utm_term: 42,
    gclid: 'x'.repeat(501), fbc: 'fb.1.1.' + 'y'.repeat(493), landing_page: 'z'.repeat(2001), landing_time: 'yesterday',
  }), { fbc: 'fb.1.1.' + 'y'.repeat(493) })
})

test('anything that is not one of the brief’s columns is ignored', () => {
  assert.deepEqual(attributionColumns({ payment_status: 'paid', is_test: true, total: 1 }), {})
  assert.deepEqual(attributionColumns(null), {})
  assert.deepEqual(attributionColumns(['gclid']), {})
  assert.deepEqual(attributionColumns('gclid=abc'), {})
})
