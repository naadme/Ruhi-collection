// The A/B tests an order was placed in (orders.experiments): what
// create-razorpay-order keeps of what checkout sends, how it saves it, and
// the migration that adds the column and its guard.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { MAX_TESTS, experimentsColumn } from '../supabase/functions/_shared/experiments.mjs'
import { MAX_RUNNING } from '../src/lib/experiments.js'

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('a sound list of tests is kept, in a fixed order', () => {
  assert.deepEqual(experimentsColumn({ aa_check: 'b' }), { aa_check: 'b' })
  assert.deepEqual(experimentsColumn({ pdp_fit: 'a', aa_check: 'c' }), { aa_check: 'c', pdp_fit: 'a' })
})

test('anything else is dropped whole, never stored half-right', () => {
  for (const value of [
    undefined, null, '', 'aa_check:b', 42, [], ['aa_check'], {},
    { aa_check: 'd' }, { aa_check: 'B' }, { aa_check: 1 }, { 'AA-check': 'b' }, { '': 'b' },
    { a_name_far_too_long_for_a_test: 'b' },
    { t1: 'a', t2: 'a', t3: 'a', t4: 'a', t5: 'a' },
    { aa_check: 'b', 'bad key': 'a' },
  ]) assert.equal(experimentsColumn(value), null, JSON.stringify(value))
})

test('the server allows exactly as many tests as the site can run at once', () => {
  assert.equal(MAX_TESTS, MAX_RUNNING)
})

test('create-razorpay-order saves the tests in a write of their own, alongside the Razorpay call', () => {
  const fn = read('supabase/functions/create-razorpay-order/index.ts')
  assert.match(fn, /import \{ experimentsColumn \} from '\.\.\/_shared\/experiments\.mjs'/)
  assert.match(fn, /const experiments = experimentsColumn\(body\.experiments\)/)
  assert.match(fn, /experiments \? recordOrderContext\(orderId, \{ experiments \}\) : null/)
  // The ad details' write is unchanged: a problem with the tests can never cost an order its ad details.
  assert.match(fn, /recordOrderContext\(orderId, \{\n\s+\.\.\.attributionColumns\(body\.attribution\),\n\s+is_test: mode === 'test',\n\s+\}\)/)
  assert.match(fn, /await Promise\.all\(\[\n\s+resolveRazorpayOrder\(/)
})

test('the migration adds the column with its own guard, leaving the payment-field guard alone', () => {
  const sql = read('supabase/migrations/20261113090000_order_experiments.sql')
  assert.match(sql, /add column if not exists experiments jsonb/)
  assert.match(sql, /check \(experiments is null or \(jsonb_typeof\(experiments\) = 'object'/)
  assert.match(sql, /before update of experiments on public\.orders/)
  assert.match(sql, /current_user in \('anon', 'authenticated'\)/)
  // Another change in progress rewrites protect_order_payment_fields(); this
  // migration must not, or the later of the two would undo the other.
  assert.doesNotMatch(sql, /create or replace function public\.protect_order_payment_fields/)
})
