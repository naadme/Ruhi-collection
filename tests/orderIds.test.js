// The order ID system: the DDMMYYNN format, where the number comes from,
// and the promise that nothing else about an order changed.
//
// The format itself is proved against the live database by
// scripts/verify-order-ids.mjs — these tests pin the code that produces it
// and the rules that must not drift.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const MIG = 'supabase/migrations/20261020190000_order_ids.sql'
const SQL = read(MIG)
const PREV = 'supabase/migrations/20261020090000_refuse_unpayable_orders.sql'

/** The create_order definition inside a migration, as raw lines. */
function createOrderLines(label) {
  const lines = read(label).split('\n')
  const s = lines.findIndex((l) => l.startsWith('create or replace function public.create_order(payload json)'))
  assert.ok(s !== -1, `create_order is defined in ${label}`)
  const e = lines.findIndex((l, i) => i > s && l.trim() === 'end $$;')
  assert.ok(e !== -1, `create_order is closed in ${label}`)
  return lines.slice(s, e + 1)
}

// ---------------------------------------------------------------------------
// The format
// ---------------------------------------------------------------------------

test('the ID is built as DDMMYY + a two-digit number for that day', () => {
  // The day, the month and the year are taken in the shop's own time zone.
  assert.match(SQL, /to_char\(v_at at time zone 'Asia\/Kolkata', 'DDMMYY'\)/,
    "the day, month and year come from the shop's time zone")
  // The number for that day is zero-padded to two digits.
  assert.match(SQL, /lpad\(v_next::text, 2, '0'\)/, 'the number is two digits')
  assert.match(SQL, /return v_day \|\| lpad\(v_next::text, 2, '0'\)/,
    'and the ID is the day followed by the number')
})

test('the number for a day starts at 01 and counts up', () => {
  assert.match(SQL, /coalesce\(max\(nullif\(substr\(reference, 7, 2\), ''\)::integer\), 0\) \+ 1/,
    'the next number is one after the highest already used for that day')
  // The 7th and 8th characters are the number: DDMMYY is six.
  assert.match(SQL, /substr\(reference, 7, 2\)/, 'the number is characters 7 and 8')
})

test('the ID is the order\'s own clock, and a caller cannot choose it', () => {
  assert.match(SQL, /new\.reference := public\.next_order_reference\(new\.created_at\)/,
    "the order's own created_at is the clock")
  assert.match(SQL, /new\.reference !~ '\^\[0-9\]\{8\}\$'/,
    'anything that is not already an 8-digit number is replaced')
})

test('the format is enforced by the database', () => {
  assert.match(SQL, /add constraint orders_reference_chk check \(reference ~ '\^\[0-9\]\{8\}\$'\)/,
    'the constraint only allows the new format')
  assert.match(SQL, /drop constraint if exists orders_reference_chk/,
    'and the old constraint is replaced, not left to fight it')
})

// ---------------------------------------------------------------------------
// Atomicity and the limit
// ---------------------------------------------------------------------------

test('two orders placed at the same moment cannot be given the same number', () => {
  assert.match(SQL, /pg_advisory_xact_lock\(hashtext\('ruhi\.collection\.order_reference'\), hashtext\(v_day\)\)/,
    "the day's number is allocated under a lock, held until the transaction ends")
  // The number is read AFTER the lock is taken, so the other order is counted.
  const lockAt = SQL.indexOf('pg_advisory_xact_lock')
  const readAt = SQL.indexOf('coalesce(max(nullif(substr(reference, 7, 2)')
  assert.ok(lockAt > 0 && readAt > lockAt, 'the highest number used is read after the lock is taken')
  // And the unique index has the final word.
  assert.match(read('supabase/migrations/20260928181500_orders_and_checkout.sql'),
    /reference\s+text not null unique/,
    'the order reference is unique in the database')
})

test('a hundredth order in one day is refused, not given a broken number', () => {
  assert.match(SQL, /if v_next > 99 then[\s\S]*raise exception 'We have reached the limit of 99 orders for today/,
    'the limit is refused with a sentence the shop can read')
  assert.match(SQL, /errcode = 'P0001'/, 'and it is the friendly kind of error')
})

test('the number is the database\'s own business', () => {
  assert.match(SQL, /revoke all on function public\.next_order_reference\(timestamptz\) from public, anon, authenticated/,
    'a browser cannot ask what the next number would be')
  assert.match(SQL, /security definer[\s\S]{0,200}set search_path = public, pg_temp/,
    'and the function cannot be led anywhere by a search path')
})

// ---------------------------------------------------------------------------
// create_order
// ---------------------------------------------------------------------------

test('create_order is copied byte-exact, with only the order ID changed', () => {
  const before = createOrderLines(PREV)
  const after = createOrderLines(MIG)
  const changed = []
  for (let i = 0; i < Math.max(before.length, after.length); i += 1) {
    if (before[i] !== after[i]) changed.push([before[i], after[i]])
  }
  assert.equal(changed.length, 1, 'exactly one line of create_order may differ')
  assert.match(changed[0][0], /'RCH-' \|\| upper\(substr\(md5/, 'the old line was the random reference')
  assert.match(changed[0][1], /public\.next_order_reference\(\)/, 'the new line asks the database for the ID')
})

test('the guard that refuses an order that could never be paid is carried over', () => {
  const after = createOrderLines(MIG).join('\n')
  assert.match(after, /if coalesce\(v_order\.total, 0\) < 1 then/,
    'the unpayable-order guard is still there')
  assert.match(after, /This order comes to ₹0, so there is nothing to pay/,
    'with its own message')
})

// ---------------------------------------------------------------------------
// The orders that already exist
// ---------------------------------------------------------------------------

test('the old IDs are kept, never thrown away', () => {
  assert.match(SQL, /add column if not exists previous_reference text/,
    'the previous reference is kept beside the new one')
  assert.match(SQL, /set reference = v_new,\s*previous_reference = r\.reference/,
    'and the old value is written into it')
})

test('the existing orders are numbered oldest first, and checked for collisions', () => {
  assert.match(SQL, /order by created_at, id/, 'oldest first')
  assert.match(SQL, /while exists \(select 1 from public\.orders o where o\.reference = v_new\) loop/,
    'and a number already in use is never taken')
  assert.match(SQL, /previous_reference is not null|previous_reference = r\.reference/)
})

test('the migration changes nothing else about an order', () => {
  // The new code — everything before the copied create_order — must not write
  // to anything but the two ID columns of the orders table.
  const NEW = SQL.slice(0, SQL.indexOf('-- 7. create_order'))
  const backfill = NEW.slice(NEW.indexOf('-- 5. The orders that already exist.'), NEW.indexOf('-- 6. Now that every row is a number'))
  const writes = backfill.match(/update public\.orders/gi) || []
  assert.equal(writes.length, 1, 'the backfill writes to the orders table once')
  assert.match(backfill, /set reference = v_new,\s*previous_reference = r\.reference/,
    'and it writes the two ID columns and nothing else')
  assert.doesNotMatch(NEW, /update public\.order_items/i, 'no order item is touched')
  assert.doesNotMatch(NEW, /update public\.products/i, 'no product is touched')
  assert.doesNotMatch(NEW, /delete from/i, 'nothing is deleted')
  assert.doesNotMatch(NEW, /drop table/i, 'no table is dropped')
  assert.doesNotMatch(NEW, /truncate/i, 'nothing is truncated')
  assert.doesNotMatch(NEW, /alter table public\.orders drop column/i,
    'the internal primary key column is not removed')
})

test('the product ID system is not touched', () => {
  const NEW = SQL.slice(0, SQL.indexOf('-- 7. create_order'))
  assert.doesNotMatch(NEW, /sku/i,
    'the six-character product ID is left alone')
  assert.doesNotMatch(NEW, /update public\.products/i, 'and no product is written')
  assert.doesNotMatch(NEW, /insert into public\.products/i, 'and none is created')
})

// ---------------------------------------------------------------------------
// Everywhere the ID shows
// ---------------------------------------------------------------------------

test('the old reference still finds the order in the admin search', () => {
  const filtering = read('src/lib/orderFiltering.js')
  assert.match(filtering, /order\.previous_reference/,
    'a customer with the old number written down can still be found')
})

test('the shop\'s own policy page describes the new ID', () => {
  const policy = read('src/pages/Policy.jsx')
  assert.match(policy, /\d{8}/, 'the example is an eight-digit ID')
  assert.doesNotMatch(policy, /RCH-/, 'and the old format is not described any more')
})
