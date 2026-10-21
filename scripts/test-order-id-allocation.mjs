// The order ID under real concurrency, on an isolated test database.
//
//   node scripts/test-order-id-db.mjs          (builds the throw-away database)
//   node scripts/test-order-id-allocation.mjs   (runs this)
//
// This NEVER touches the shop's own database: it refuses to run against
// anything but a local server, and every row it writes is marked as a test
// row and removed again.
//
// Run this on its own: every order-ID test writes to the shop's CURRENT day
// on the same database, so two of them at once would number each other's
// orders and neither would be telling the truth.
//
// What it proves, with real parallel connections rather than a simulation:
//
//   1. two orders created at exactly the same moment get different numbers;
//   2. a hundred and twenty orders at once all succeed, all get a number of
//      their own, and the day's numbers run 01..120 with no gap and no
//      repeat — including the hundredth, which is the first order of the
//      day whose number needs three digits;
//   3. every order that came back is really in the database, under the ID it
//      was given — nothing was lost, nothing was invented;
//   4. the numbers of a day run in order, and the next day starts again at
//      01, on the shop's own calendar (Asia/Kolkata) and not the server's;
//   5. a transaction that fails, is rolled back or is killed at the server
//      takes nothing with it — no orphan order, and no number lost;
//   6. the same order retried does not become two orders or two numbers;
//   7. the database refuses a duplicate number itself, and refuses a day
//      that has passed 999 orders with a clear message.
import pg from 'pg'

const { Client } = pg

// ---- the isolated database, and nothing else -----------------------------
const CONNECTION = process.env.RUHI_TEST_DATABASE_URL
  || 'postgresql://postgres:postgres@127.0.0.1:55432/postgres'
const host = new URL(CONNECTION).hostname
if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(host)) {
  console.error(`\nThis test only ever runs against a LOCAL database (127.0.0.1), never against ${host}.`)
  console.error('Set RUHI_TEST_DATABASE_URL to a local Postgres to run it.\n')
  process.exit(2)
}
console.log(`\nThe order ID under concurrency, on the local test database at ${host}\n`)

// ---- a small, honest test harness ---------------------------------------
let failures = 0
let checks = 0
const ok = (name, detail = '') => {
  checks += 1
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
}
const bad = (name, detail = '') => {
  checks += 1
  failures += 1
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}
const expect = (name, actual, want) => {
  const same = JSON.stringify(actual) === JSON.stringify(want)
  if (same) ok(name, typeof want === 'string' ? want : '')
  else bad(name, `wanted ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`)
}
const section = (title) => console.log(`\n--- ${title} ---`)

/** A connection of its own. The tests want many backends at once, and each
 *  one has to be connected before it is used. The error handler matters: a
 *  session that is killed at the server makes the client shout, and an
 *  unhandled 'error' event would take the whole test down with it. */
const connect = async () => {
  const client = new Client({ connectionString: CONNECTION })
  client.on('error', () => {})
  await client.connect()
  return client
}
const q = async (text, params) => {
  const client = await connect()
  try { return await client.query(text, params) } finally { await client.end().catch(() => {}) }
}
const count = async (sql, params) => Number((await q(sql, params)).rows[0].n)

const FIXTURE = 'order-id-allocation-test-product'
const mail = (n) => `order-id-allocation-test-${n}@example.test`
const isTestMail = (email) => String(email).startsWith('order-id-allocation-test-')

/** A product to order: the catalogue may be empty, and the test needs one
 *  active product with a size and a price to order. */
const ensureFixture = async () => {
  const category = await q(`select key from public.categories order by key limit 1`).then((r) => r.rows[0]?.key)
  if (!category) throw new Error('the test database has no category to hang the test product on')
  await q(`insert into public.products (id, title, price, sizes, is_active, type, image)
           values ($1, 'Order ID Test Piece', 500, array['M'], true, $2, '/images/products/none.jpg')
           on conflict (id) do update
             set price = 500, sizes = array['M'], is_active = true, type = $2`,
    [FIXTURE, category])
}

/** Every row this test made, gone again — and nothing else. */
const clean = async () => {
  await q(`delete from public.order_items
            where order_id in (select id from public.orders where email like 'order-id-allocation-test-%@example.test')`)
  await q(`delete from public.orders where email like 'order-id-allocation-test-%@example.test'`)
  await q(`delete from public.products where id = $1`, [FIXTURE])
}

/** The payload create_order() takes. Every test order has an email of its
 *  own: the shop allows one order per email in a short window (a
 *  double-submit guard that has nothing to do with the order ID), so two
 *  test orders may not share one. */
const payload = (n, payment = 'cod') => ({
  items: [{ product_id: FIXTURE, size: 'M', qty: 1 }],
  email: mail(n),
  full_name: `Order ID Tester ${n}`,
  phone: '9000000000',
  address: '1 Test Street',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  payment_method: payment,
})

/** The highest number used on a day, read the way the database reads it. */
const highestOn = async (day) => Number((await q(
  `select coalesce(max(nullif(substr(reference, 7), '')::integer), 0) as n
     from public.orders
    where left(reference, 6) = $1 and reference ~ '^[0-9]{8,9}$'`, [day])).rows[0].n)

/** The shop's day for the order the database has just written. */
const today = async () => (await q(
  `select to_char(now() at time zone 'Asia/Kolkata', 'DDMMYY') as day`)).rows[0].day

// ===========================================================================
try {
  await clean()
} catch (e) {
  console.error(`\n  the test database is not ready: ${e.message}`)
  console.error('  run: node scripts/test-order-id-db.mjs\n')
  process.exit(2)
}
await ensureFixture()

// The shop's own orders must not be touched by any of this. Only the
// orders that are not test rows of any kind are looked at, so a test that
// runs beside this one cannot make this one look wrong.
const shopBefore = await q(
  `select id::text as id, reference, coalesce(previous_reference, '') as previous_reference,
          created_at::text as created_at, email, total
     from public.orders where email not like '%@example.test' order by id`)

// ---------------------------------------------------------------------------
section('1. two orders created at exactly the same moment')
// ---------------------------------------------------------------------------
// The same created_at for both, in two separate transactions that overlap.
const AT = '2026-01-15T10:00:00.000Z'   // 15:30 in the shop's own time zone
const sameMoment = async (n) => {
  const client = await connect()
  try {
    await client.query('begin')
    await client.query(
      `insert into public.orders (created_at, full_name, email, phone, address, city, state, pincode, payment_method)
       values ($1, $2, $3, '9000000000', '1 Test Street', 'Pune', 'Maharashtra', '411001', 'cod')`,
      [AT, `Same Moment ${n}`, mail(`same-${n}`)])
    await client.query('commit')
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    await client.end().catch(() => {})
  }
}
await Promise.all([sameMoment(1), sameMoment(2)])
const same = await q(
  `select reference from public.orders where created_at = $1 order by reference`, [AT])
expect('both orders were given a number', same.rows.length, 2)
expect('and the numbers are different', new Set(same.rows.map((r) => r.reference)).size, 2)
expect('they are the first two of that day', same.rows.map((r) => r.reference), ['15012601', '15012602'])
console.log('    the day came out as 150126 — 15 January 2026, the shop\'s day')

// ---------------------------------------------------------------------------
section('2. a hundred and twenty orders at the same time')
// ---------------------------------------------------------------------------
const N = 120
// Where the day's numbering stands before these 120 orders ask for theirs.
const day = await today()
const startMax = await highestOn(day)
const started = Date.now()
const results = await Promise.all(Array.from({ length: N }, async (_, i) => {
  const client = await connect()
  try {
    const r = await client.query(`select public.create_order($1::json) as order`, [JSON.stringify(payload(`many-${i}`))])
    return { ok: true, order: r.rows[0].order }
  } catch (e) {
    return { ok: false, message: e.message }
  } finally {
    await client.end().catch(() => {})
  }
}))
const took = ((Date.now() - started) / 1000).toFixed(1)
const succeeded = results.filter((r) => r.ok)
const refused = results.filter((r) => !r.ok)
const ids = succeeded.map((r) => r.order.reference)
console.log(`    ${N} parallel calls took ${took}s`)
console.log(`    ${succeeded.length} succeeded, ${refused.length} were refused`)
if (refused.length) {
  console.log(`    the refusal said: ${[...new Set(refused.map((r) => r.message))].join(' | ')}`)
}
expect('every one of them was accepted', refused.length, 0)
expect('every order that succeeded has a number of its own', new Set(ids).size, ids.length)

// ---------------------------------------------------------------------------
section('3. every number that came back is real, and is the order\'s own')
// ---------------------------------------------------------------------------
const rows = await q(
  `select id::text as id, reference, email from public.orders where email like 'order-id-allocation-test-many-%@example.test'`)
expect('the database holds one row for each of them', rows.rows.length, succeeded.length)
const byId = new Map(rows.rows.map((r) => [r.id, r]))
const orphans = succeeded.filter((r) => !byId.has(r.order.id))
expect('and not one of them is missing from the database', orphans.length, 0)
const mismatched = succeeded.filter((r) => byId.get(r.order.id)?.reference !== r.order.reference)
expect('every order kept the number it was given', mismatched.length, 0)
const dupInDb = await q(
  `select reference, count(*)::int as n from public.orders group by 1 having count(*) > 1`)
expect('no number is used twice in the database', dupInDb.rows.length, 0)
// The 120 of them took the next 120 numbers of the day, one after another.
const mine = await q(
  `select reference from public.orders
    where email like 'order-id-allocation-test-many-%@example.test'
    order by substr(reference, 7)::int`)
const myNumbers = mine.rows.map((r) => Number(r.reference.slice(6)))
expect('the hundred and twenty took the next hundred and twenty numbers of the day',
  myNumbers, Array.from({ length: N }, (_, i) => startMax + 1 + i))

// ---------------------------------------------------------------------------
section('4. the numbers of the day')
// ---------------------------------------------------------------------------
// The day's rows, in NUMBER order — not in text order, which would put the
// nine-digit 100 before the eight-digit 11.
const todays = await q(
  `select reference from public.orders
    where left(reference, 6) = $1 and reference ~ '^[0-9]{8,9}$'
    order by substr(reference, 7)::int`, [day])
const numbers = todays.rows.map((r) => Number(r.reference.slice(6)))
expect('every number belongs to the shop\'s day', todays.rows.every((r) => r.reference.startsWith(day)), true)
expect('no number is repeated', new Set(numbers).size, numbers.length)
expect('they run in order with no gaps', numbers,
  numbers.map((_, i) => numbers[0] + i))
// A number is eight digits up to 99 and nine digits from 100 — the format
// grows by one digit exactly when it has to, and never before.
const wrongWidth = todays.rows.filter((r) => r.reference.length !== (Number(r.reference.slice(6)) < 100 ? 8 : 9))
expect('every number is as wide as it has to be', wrongWidth.length, 0)
expect('no number of 100 or more is eight digits',
  todays.rows.filter((r) => r.reference.length === 8).every((r) => Number(r.reference.slice(6)) <= 99), true)
expect('and no number below 100 is nine digits',
  todays.rows.filter((r) => r.reference.length === 9).every((r) => Number(r.reference.slice(6)) >= 100), true)
console.log(`    ${day}: ${numbers.length} orders, numbered ${numbers[0]} to ${numbers[numbers.length - 1]}`)
console.log(`    the first ${numbers.filter((n) => n < 100).length} are eight digits, the rest are nine`)

// ---------------------------------------------------------------------------
section('5. the next day, and the shop\'s own calendar')
// ---------------------------------------------------------------------------
// Two moments either side of midnight in the shop's time zone.
const BEFORE = '2026-01-15T18:29:59.000Z'  // 23:59:59 IST, 15 January
const AFTER = '2026-01-15T18:30:00.000Z'   // 00:00:00 IST, 16 January
const atMoment = async (at, name, key) => {
  const client = await connect()
  try {
    await client.query('begin')
    await client.query(
      `insert into public.orders (created_at, full_name, email, phone, address, city, state, pincode, payment_method)
       values ($1, $2, $3, '9000000000', '1 Test Street', 'Pune', 'Maharashtra', '411001', 'cod')`,
      [at, name, mail(key)])
    await client.query('commit')
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    await client.end().catch(() => {})
  }
}
await atMoment(BEFORE, 'Just Before Midnight', 'before-midnight')
await atMoment(AFTER, 'Just After Midnight', 'after-midnight')
const around = await q(
  `select reference, created_at from public.orders where created_at in ($1, $2) order by created_at`,
  [BEFORE, AFTER])
expect('the order placed before midnight belongs to the 15th', around.rows[0].reference.slice(0, 6), '150126')
expect('the order placed after midnight belongs to the 16th', around.rows[1].reference.slice(0, 6), '160126')
expect('and the new day starts at 01', around.rows[1].reference, '16012601')
console.log('    23:59:59 IST → 15012601, 00:00:00 IST → 16012601')

// ---------------------------------------------------------------------------
section('6. a transaction that fails takes nothing with it')
// ---------------------------------------------------------------------------
// (a) an order that is written and then rolled back
const before = await highestOn('150126')
const doomed = await connect()
await doomed.query('begin')
await doomed.query(
  `insert into public.orders (created_at, full_name, email, phone, address, city, state, pincode, payment_method)
   values ('2026-01-15T10:00:00.000Z', 'Doomed', $1, '9000000000', '1 Test Street', 'Pune', 'Maharashtra', '411001', 'cod')`,
  [mail('doomed')])
await doomed.query('rollback')
await doomed.end().catch(() => {})
expect('a rolled-back order leaves no number behind', await highestOn('150126'), before)
expect('and leaves no row behind', await count(`select count(*)::int as n from public.orders where full_name = 'Doomed'`), 0)

// (b) a session that is killed while it holds the number
const killed = await connect()
await killed.query('begin')
await killed.query(
  `insert into public.orders (created_at, full_name, email, phone, address, city, state, pincode, payment_method)
   values ('2026-01-15T10:00:00.000Z', 'Killed Mid Flight', $1, '9000000000', '1 Test Street', 'Pune', 'Maharashtra', '411001', 'cod')`,
  [mail('killed')])
const killedPid = (await killed.query('select pg_backend_pid() as pid')).rows[0].pid
await q('select pg_terminate_backend($1)', [killedPid])
await killed.end().catch(() => {})
const afterKill = await Promise.race([
  q(`select public.next_order_reference('2026-01-15T10:00:00.000Z'::timestamptz) as ref`),
  new Promise((_, reject) => setTimeout(() => reject(new Error('the number was still locked after 15 seconds')), 15000)),
]).then((r) => r.rows[0].ref).catch((e) => e.message)
ok('the number was free again after the session was killed', String(afterKill))
expect('and no order was left behind by the killed session',
  await count(`select count(*)::int as n from public.orders where full_name = 'Killed Mid Flight'`), 0)

// (c) an order that fails after its number was taken
const failing = await connect()
await failing.query('begin')
await failing.query(
  `insert into public.orders (created_at, full_name, email, phone, address, city, state, pincode, payment_method)
   values ('2026-01-15T10:00:00.000Z', 'Fails After', $1, '9000000000', '1 Test Street', 'Pune', 'Maharashtra', '411001', 'cod')`,
  [mail('fails')])
await failing.query(`insert into public.order_items (order_id, product_id, title, size, qty, unit_price)
                     select id, $1, 'Broken', 'M', 1, 1 from public.orders where full_name = 'Fails After'`, [FIXTURE])
// This one is refused by the database itself: a quantity of -5 cannot be
// written, and the transaction it is in dies with it.
const broken = await failing.query(`update public.order_items set qty = -5 where title = 'Broken'`)
  .then(() => 'ACCEPTED -> BROKEN')
  .catch((e) => e.code)
expect('a broken order line is refused by the database', broken, '23514')
await failing.query('rollback')
await failing.end().catch(() => {})
expect('a failed transaction leaves no order behind',
  await count(`select count(*)::int as n from public.orders where full_name = 'Fails After'`), 0)
expect('and no order line behind either',
  await count(`select count(*)::int as n from public.order_items where title = 'Broken'`), 0)
expect('and it took no number with it', await highestOn('150126'), before)

// ---------------------------------------------------------------------------
section('7. the same order, tried again')
// ---------------------------------------------------------------------------
const retryEmail = 'order-id-allocation-test-retry@example.test'
const first = await q(`select public.create_order($1::json) as order`,
  [JSON.stringify({ ...payload('retry'), email: retryEmail, payment_method: 'razorpay' })])
const firstOrder = first.rows[0].order
const second = await q(`select public.create_order($1::json) as order`,
  [JSON.stringify({ ...payload('retry'), email: retryEmail, payment_method: 'razorpay' })])
const secondOrder = second.rows[0].order
expect('the retry is the same order', secondOrder.id, firstOrder.id)
expect('with the same order number', secondOrder.reference, firstOrder.reference)
expect('and the shop knows it was a retry', secondOrder.reused, true)
expect('only one order was written',
  await count(`select count(*)::int as n from public.orders where email = $1`, [retryEmail]), 1)

// ---------------------------------------------------------------------------
section('8. the database refuses a duplicate number itself')
// ---------------------------------------------------------------------------
// The unique index is the last word: even a number that was forced in cannot
// be written twice.
const duplicate = await (async () => {
  const client = await connect()
  try {
    await client.query('begin')
    const existing = await client.query(`select reference from public.orders limit 1`)
    await client.query(
      `insert into public.orders (reference, full_name, email, phone, address, city, state, pincode, payment_method)
       values ($1, 'Duplicate', $2, '9000000000', '1 Test Street', 'Pune', 'Maharashtra', '411001', 'cod')`,
      [existing.rows[0].reference, mail('duplicate')])
    await client.query('commit')
    return 'ACCEPTED -> BROKEN'
  } catch (e) {
    await client.query('rollback').catch(() => {})
    return e.code === '23505' ? 'refused' : `refused (${e.code})`
  } finally {
    await client.end().catch(() => {})
  }
})()
expect('a number that is already taken', duplicate, 'refused')

// ---------------------------------------------------------------------------
section('9. and it says so when a day is full')
// ---------------------------------------------------------------------------
// 999 orders in one day is the ceiling. A day holding the last number must be
// refused with a message the shopper can read.
const FULL_DAY = '050226'
await q(`insert into public.orders (reference, full_name, email, phone, address, city, state, pincode, payment_method)
         values ($1, 'The Last Of The Day', $2, '9000000000', '1 Test Street', 'Pune', 'Maharashtra', '411001', 'cod')`,
  [`${FULL_DAY}999`, mail('full-day')])
const full = await q(`select public.next_order_reference('2026-02-05 10:00:00+00'::timestamptz) as ref`)
  .then((r) => r.rows[0].ref)
  .catch((e) => e.message)
ok('the thousandth order of the day was refused', String(full))
expect('with a message the shopper can read',
  /limit of 999 orders for today/i.test(String(full)), true)

// ---------------------------------------------------------------------------
section('10. the shop\'s own orders were not touched')
// ---------------------------------------------------------------------------
const shopAfter = await q(
  `select id::text as id, reference, coalesce(previous_reference, '') as previous_reference,
          created_at::text as created_at, email, total
     from public.orders where id = any($1::uuid[]) order by id`,
  [shopBefore.rows.map((r) => r.id)])
expect('every order the shop had is still there', shopAfter.rows.length, shopBefore.rows.length)
const beforeById = new Map(shopBefore.rows.map((r) => [r.id, JSON.stringify(r)]))
const changed = shopAfter.rows.filter((r) => beforeById.get(r.id) !== JSON.stringify(r))
expect('and every one of them is exactly as it was — same number, same date', changed.length, 0)
expect('and the test rows are the only ones this test made',
  await count(`select count(*)::int as n from public.orders where email like 'order-id-allocation-test-%@example.test'`) > 0, true)

// ---------------------------------------------------------------------------
await clean()
const left = await count(`select count(*)::int as n from public.orders where email like 'order-id-allocation-test-%@example.test'`)
expect('and every row it made is gone again', left, 0)

console.log(`\n${failures ? '✗' : '✓'} ${checks - failures} of ${checks} checks passed`)
process.exit(failures ? 1 : 0)
