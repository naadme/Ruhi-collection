// The order ID, under real concurrency, on an isolated test database.
//
//   npx supabase start                 (the local Postgres)
//   npx supabase db reset              (the shop's own migrations)
//   node scripts/test-order-id-concurrency.mjs
//
// This NEVER touches the shop's own database: it refuses to run against
// anything but a local server, and every row it writes is marked as a test
// row and removed again.
//
// What it proves, with real parallel connections rather than a simulation:
//
//   1. two orders created at exactly the same moment get different numbers;
//   2. a hundred and twenty orders at once do the same, and every one of
//      them that succeeds has a number of its own;
//   3. the numbers of a day run 01, 02, 03 … with no gaps and no repeats;
//   4. the next day starts again at 01, and the day is the shop's day
//      (Asia/Kolkata) and not the server's;
//   5. a transaction that fails, is rolled back or is killed at the server
//      takes nothing with it — no orphan order, and no number lost;
//   6. the same order retried does not become two orders or two numbers.
import pg from 'pg'

const { Client, Pool } = pg

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

/** Run a statement, and if it does not finish in time, say what it is
 *  waiting for — a lock, a row, another session — before giving up. */const withTimeout = async (label, promise, ms = 20000) => {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(async () => {
      const acts = await q(`select pid, state, wait_event_type, wait_event, left(query, 90) as query
                              from pg_stat_activity
                             where datname = current_database() and pid <> pg_backend_pid() and state <> 'idle'`)
        .then((r) => JSON.stringify(r.rows))
        .catch((e) => `could not ask: ${e.message}`)
      const locks = await q(`select l.pid, l.locktype, l.mode, l.granted, l.objid::regclass::text as obj
                               from pg_locks l
                              where l.granted = false`)
        .then((r) => JSON.stringify(r.rows))
        .catch((e) => `could not ask: ${e.message}`)
      reject(new Error(`${label} did not finish in ${ms}ms.\n    busy: ${acts}\n    waiting locks: ${locks}`))
    }, ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

const pool = new Pool({ connectionString: CONNECTION, max: 8 })
/** A connection of its own — the tests want many backends at once, and each
 *  one has to be connected before it is used. */
const connect = async () => {
  const client = new Client({ connectionString: CONNECTION })
  // A session the server kills says so on the wire. The test wants to see
  // that, so it is heard here rather than thrown at the top of the file.
  client.on('error', () => {})
  await client.connect()
  return client
}
const q = async (text, params) => (await pool.query(text, params))

const TEST_MAIL = 'order-id-test@example.test'
/** Every test order has an email of its own: the shop allows only one
 *  unfinished online order per email (a double-submit guard that has nothing
 *  to do with the order ID), so two test orders may not share one. */
const mailFor = (n) => `order-id-test-${n}@example.test`
const FIXTURE = 'order-id-test-product'

/** A product to order: the local catalogue may be empty, and the test needs
 *  one active product with a size and a price to order. */
const ensureFixture = async () => {
  // The product belongs to a category that really exists — the catalogue
  // keeps a foreign key to it.
  const category = await q(`select key from public.categories order by key limit 1`).then((r) => r.rows[0]?.key)
  if (!category) throw new Error('the test database has no category to hang the test product on')
  await q(`insert into public.products (id, title, price, sizes, is_active, type, image)
           values ($1, 'Concurrency Test Piece', 500, array['M'], true, $2, '/images/products/none.jpg')
           on conflict (id) do update set price = 500, sizes = array['M'], is_active = true, type = $2`,
    [FIXTURE, category])
}

/** Every row this test made, gone again. */
const clean = async () => {
  await q(`delete from public.order_items where order_id in (select id from public.orders where email like 'order-id-test%@example.test')`)
  await q(`delete from public.orders where email like 'order-id-test%@example.test'`)
  await q(`delete from public.products where id = $1`, [FIXTURE])
}

/** The order payload create_order() takes. */
const payload = (n) => ({
  items: [{ product_id: FIXTURE, size: 'M', qty: 1 }],
  email: mailFor(`many-${n}`),
  full_name: `Concurrency Tester ${n}`,
  phone: '9000000000',
  address: '1 Test Street',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  payment_method: 'razorpay',
})

// ===========================================================================
await clean()
await ensureFixture()

// ---------------------------------------------------------------------------
section('1. two orders created at exactly the same moment')
// ---------------------------------------------------------------------------
// The same created_at for both, in two separate transactions that overlap.
const AT = '2026-01-15T10:00:00.000Z'   // 15:30 in the shop's own time zone
const sameMoment = async (n) => {
  const client = await connect()
  try {
    await withTimeout('begin', client.query('begin'))
    await withTimeout('the insert', client.query(
      `insert into public.orders (created_at, full_name, email, phone, address, city, state, pincode, payment_method)
       values ($1, $2, $3, '9000000000', '1 Test Street', 'Pune', 'Maharashtra', '411001', 'razorpay')`,
      [AT, `Same Moment ${n}`, mailFor(`same-${n}`)]))
    await withTimeout('the commit', client.query('commit'))
    return client
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  }
}
// Both at once: two transactions, one moment, one day.
const [c1, c2] = await Promise.all([sameMoment(1), sameMoment(2)])
const refs = (await q(`select reference from public.orders where created_at = $1 order by reference`, [AT])).rows.map((r) => r.reference)
expect('both orders were given a number', refs.length, 2)
expect('and the numbers are different', new Set(refs).size, 2)
expect('they are the first two of that day', refs, ['15012601', '15012602'])
console.log(`    the day came out as 150126 — 15 January 2026, the shop's day`)
await c1.end(); await c2.end()

// ---------------------------------------------------------------------------
section('2. the same order, tried again')
// ---------------------------------------------------------------------------
const retryEmail = 'order-id-retry@example.test'
const first = await q(`select public.create_order($1::json) as order`, [JSON.stringify({ ...payload(1), email: retryEmail })])
const firstOrder = first.rows[0].order
const second = await q(`select public.create_order($1::json) as order`, [JSON.stringify({ ...payload(1), email: retryEmail })])
const secondOrder = second.rows[0].order
expect('the retry is the same order', secondOrder.id, firstOrder.id)
expect('with the same order number', secondOrder.reference, firstOrder.reference)
expect('and the shop knows it was a retry', secondOrder.reused, true)
expect('only one order was written',
  (await q(`select count(*)::int as n from public.orders where email = $1`, [retryEmail])).rows[0].n, 1)
await q(`delete from public.order_items where order_id in (select id from public.orders where email = $1)`, [retryEmail])
await q(`delete from public.orders where email = $1`, [retryEmail])

// ---------------------------------------------------------------------------
section('3. the same order, submitted at the same time')
// ---------------------------------------------------------------------------
// Ten copies of one checkout, all at once — the shopper pressed the button
// more than once, or the network sent it twice. There must be ONE order and
// ONE number, and the day must have given out one number, not ten.
const stormEmail = 'order-id-storm@example.test'
const storm = await Promise.all(Array.from({ length: 10 }, async () => {
  const client = await connect()
  try {
    const r = await client.query(`select public.create_order($1::json) as order`, [JSON.stringify({ ...payload('storm'), email: stormEmail })])
    return { ok: true, order: r.rows[0].order }
  } catch (e) {
    return { ok: false, message: e.message }
  } finally {
    await client.end()
  }
}))
const stormOrders = storm.filter((s) => s.ok).map((s) => s.order)
const stormRefs = [...new Set(stormOrders.map((o) => o.reference))]
expect('all ten calls answered with an order', stormOrders.length, 10)
expect('and they are all the same order', new Set(stormOrders.map((o) => o.id)).size, 1)
expect('with one order number between them', stormRefs.length, 1)
expect('and only one order was written',
  (await q(`select count(*)::int as n from public.orders where email = $1`, [stormEmail])).rows[0].n, 1)
expect('and the day gave out one number for it, not ten',
  (await q(`select count(*)::int as n from public.orders where reference like $1 and email = $2`,
    [`${(await q(`select to_char(now() at time zone 'Asia/Kolkata', 'DDMMYY') as day`)).rows[0].day}%`, stormEmail])).rows[0].n, 1)
await q(`delete from public.order_items where order_id in (select id from public.orders where email = $1)`, [stormEmail])
await q(`delete from public.orders where email = $1`, [stormEmail])

// ---------------------------------------------------------------------------
section('4. a hundred and twenty orders at the same time')
// ---------------------------------------------------------------------------
const N = 120
const started = Date.now()
const results = await Promise.all(Array.from({ length: N }, async (_, i) => {
  const client = await connect()
  try {
    const r = await client.query(`select public.create_order($1::json) as order`, [JSON.stringify(payload(i))])
    return { ok: true, order: r.rows[0].order }
  } catch (e) {
    return { ok: false, message: e.message }
  } finally {
    await client.end()
  }
}))
const took = ((Date.now() - started) / 1000).toFixed(1)
const succeeded = results.filter((r) => r.ok)
const refused = results.filter((r) => !r.ok)
const ids = succeeded.map((r) => r.order.reference)
console.log(`    ${N} parallel calls took ${took}s`)
console.log(`    ${succeeded.length} succeeded, ${refused.length} were refused`)
expect('every order that succeeded has a number of its own', new Set(ids).size, ids.length)
expect('and there is one of each', ids.length, new Set(ids).size)
const refusedMessages = [...new Set(refused.map((r) => r.message))]
console.log(`    the refusal said: ${refusedMessages.join(' | ') || '(none)'}`)
if (refused.length) {
  ok('the day’s limit was refused with a clear message',
    refusedMessages.every((m) => /limit of 99 orders for today/i.test(m)))
}

// ---------------------------------------------------------------------------
section('5. the numbers of the day')
// ---------------------------------------------------------------------------
const today = await q(`select to_char(now() at time zone 'Asia/Kolkata', 'DDMMYY') as day`).then((r) => r.rows[0].day)
// Ordered by the NUMBER, not by the text: a day that has passed 99 carries
// nine-digit IDs, and '211026100' sorts before '21102611' as a string.
const todays = await q(`select reference from public.orders where reference like $1 order by substr(reference, 7)::int`, [`${today}%`])
const numbers = todays.rows.map((r) => Number(r.reference.slice(6)))
expect('every number belongs to today', todays.rows.every((r) => r.reference.startsWith(today)), true)
expect('no number is repeated', new Set(numbers).size, numbers.length)
expect('they run 1, 2, 3 … with no gaps', numbers, numbers.map((_, i) => i + 1))
console.log(`    ${today}: ${numbers.length} orders, numbered ${numbers[0]} to ${numbers[numbers.length - 1]}`)

// ---------------------------------------------------------------------------
section('6. the next day, and the shop’s own calendar')
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
       values ($1, $2, $3, '9000000000', '1 Test Street', 'Pune', 'Maharashtra', '411001', 'razorpay')`,
      [at, name, mailFor(key)])
    await client.query('commit')
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    await client.end()
  }
}
await atMoment(BEFORE, 'Just Before Midnight', 'before-midnight')
await atMoment(AFTER, 'Just After Midnight', 'after-midnight')
const around = await q(`select reference, created_at from public.orders where created_at in ($1, $2) order by created_at`, [BEFORE, AFTER])
expect('the order placed before midnight belongs to the 15th', around.rows[0].reference.slice(0, 6), '150126')
expect('the order placed after midnight belongs to the 16th', around.rows[1].reference.slice(0, 6), '160126')
expect('and the new day starts at 01', around.rows[1].reference, '16012601')
console.log('    23:59:59 IST → 15012601, 00:00:00 IST → 16012601')

// Twenty orders on each side of midnight, all at once: the two days are
// counted separately, and neither day is given a number the other has.
const midnight = await Promise.all(Array.from({ length: 40 }, async (_, i) => {
  const at = i % 2 === 0 ? BEFORE : AFTER
  const client = await connect()
  try {
    await client.query('begin')
    await client.query(
      `insert into public.orders (created_at, full_name, email, phone, address, city, state, pincode, payment_method)
       values ($1, $2, $3, '9000000000', '1 Test Street', 'Pune', 'Maharashtra', '411001', 'razorpay')`,
      [at, `Midnight ${i}`, mailFor(`midnight-${i}`)])
    await client.query('commit')
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    await client.end()
  }
}))
const midnightRows = await q(`select reference from public.orders where full_name like 'Midnight %' order by reference`)
const before15 = midnightRows.rows.map((r) => r.reference).filter((r) => r.startsWith('150126')).map((r) => Number(r.slice(6)))
const after16 = midnightRows.rows.map((r) => r.reference).filter((r) => r.startsWith('160126')).map((r) => Number(r.slice(6)))
expect('the orders before midnight belong to the 15th', before15.length, 20)
expect('the orders after midnight belong to the 16th', after16.length, 20)
// Each day continues its own sequence — no gap, no repeat — whatever numbers
// the day already held.
const consecutive = (list) => list.every((n, i) => i === 0 || n === list[i - 1] + 1)
expect('the 15th numbers its own orders in a row', consecutive(before15), true)
expect('and so does the 16th', consecutive(after16), true)
expect('and no number is used twice', new Set(midnightRows.rows.map((r) => r.reference)).size, 40)
expect('and the two days are told apart by their date',
  new Set(midnightRows.rows.map((r) => r.reference.slice(0, 6))).size, 2)

// ---------------------------------------------------------------------------
section('7. a transaction that fails takes nothing with it')
// ---------------------------------------------------------------------------
// (a) an order that is written and then rolled back
const before = await q(`select coalesce(max(nullif(substr(reference, 7, 2), '')::integer), 0) as n
                          from public.orders where reference like '150126%'`).then((r) => r.rows[0].n)
const doomed = await connect()
await doomed.query('begin')
await doomed.query(
  `insert into public.orders (created_at, full_name, email, phone, address, city, state, pincode, payment_method)
   values ('2026-01-15T10:00:00.000Z', 'Doomed', $1, '9000000000', '1 Test Street', 'Pune', 'Maharashtra', '411001', 'razorpay')`,
  [mailFor('doomed')])
await doomed.query('rollback')
await doomed.end()
const after = await q(`select coalesce(max(nullif(substr(reference, 7, 2), '')::integer), 0) as n
                         from public.orders where reference like '150126%'`).then((r) => r.rows[0].n)
expect('a rolled-back order leaves no number behind', after, before)
expect('and leaves no row behind',
  (await q(`select count(*)::int as n from public.orders where full_name = 'Doomed'`)).rows[0].n, 0)

// (b) a session that is killed while it holds the number
const killed = await connect()
await killed.query('begin')
await killed.query(
  `insert into public.orders (created_at, full_name, email, phone, address, city, state, pincode, payment_method)
   values ('2026-01-15T10:00:00.000Z', 'Killed Mid Flight', $1, '9000000000', '1 Test Street', 'Pune', 'Maharashtra', '411001', 'razorpay')`,
  [mailFor('killed')])
const killedPid = (await killed.query('select pg_backend_pid() as pid')).rows[0].pid
await q('select pg_terminate_backend($1)', [killedPid])
await killed.end().catch(() => {})
const afterKill = await Promise.race([
  q(`select public.next_order_reference('2026-01-15T10:00:00.000Z'::timestamptz) as ref`),
  new Promise((_, reject) => setTimeout(() => reject(new Error('the number was still locked after 15 seconds')), 15000)),
]).then((r) => r.rows[0].ref).catch((e) => e.message)
const dayRows = await q(`select reference, full_name from public.orders where reference like '150126%' order by reference`)
console.log(`    the day holds: ${dayRows.rows.map((r) => `${r.reference} (${r.full_name})`).join(', ') || 'nothing'}`)
ok('the number was free again after the session was killed', String(afterKill))
expect('and no order was left behind by the killed session',
  (await q(`select count(*)::int as n from public.orders where full_name = 'Killed Mid Flight'`)).rows[0].n, 0)

// (c) an order that fails after its number was taken
const failing = await connect()
await failing.query('begin')
await failing.query(
  `insert into public.orders (created_at, full_name, email, phone, address, city, state, pincode, payment_method)
   values ('2026-01-15T10:00:00.000Z', 'Fails After', $1, '9000000000', '1 Test Street', 'Pune', 'Maharashtra', '411001', 'razorpay')`,
  [mailFor('fails')])
await failing.query(`insert into public.order_items (order_id, product_id, title, size, qty, unit_price)
                     select id, $1, 'Broken', 'M', 1, 1 from public.orders where full_name = 'Fails After'`, [FIXTURE])
// The line that breaks the order — the database refuses it, and the whole
// transaction goes with it.
let broke = ''
try {
  await failing.query(`update public.order_items set qty = -5 where title = 'Broken'`)
} catch (e) {
  broke = e.message
}
console.log(`    the order failed: ${broke.split('\n')[0]}`)
await failing.query('rollback')
await failing.end()
expect('a failed transaction leaves no order behind',
  (await q(`select count(*)::int as n from public.orders where full_name = 'Fails After'`)).rows[0].n, 0)
expect('and no order line behind either',
  (await q(`select count(*)::int as n from public.order_items where title = 'Broken'`)).rows[0].n, 0)

// ---------------------------------------------------------------------------
section('8. the numbers given out are still the day’s own')
// ---------------------------------------------------------------------------
const finalToday = await q(`select reference from public.orders where reference like $1 order by reference`, [`${today}%`])
expect('and every one of them is still unique', new Set(finalToday.rows.map((r) => r.reference)).size, finalToday.rows.length)
console.log(`    ${finalToday.rows.length} orders stand on ${today}, all with a number of their own`)

// ---------------------------------------------------------------------------
await clean()
await pool.end()

console.log(`\n${failures ? '✗' : '✓'} ${checks - failures} of ${checks} checks passed`)
process.exit(failures ? 1 : 0)
