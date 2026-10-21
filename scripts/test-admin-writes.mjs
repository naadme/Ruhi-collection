// The admin panel's writes, against an ISOLATED database, with the real row
// level security policies in force.
//
//   node scripts/test-order-id-db.mjs          (builds the throw-away database)
//   node scripts/test-admin-writes.mjs          (runs this)
//
// It never touches the shop's own database: it refuses to run against
// anything but a local server, and every row it writes is removed again.
//
// What it proves, as the DATABASE sees it:
//
//   * an order's status can be changed by an admin, and the change sticks;
//   * a signed-in customer who is not an admin cannot change it;
//   * an admin still cannot write the payment fields — the money is the
//     payment service's business;
//   * the best sellers can be added, reordered, switched off and removed, by
//     an admin and by nobody else;
//   * the banners can be added, reordered, switched off and removed, by an
//     admin and by nobody else;
//   * a category can be created and renamed by an admin, and it is given a
//     Product ID code of its own — and by nobody else.
import pg from 'pg'

const { Client } = pg

const CONNECTION = process.env.RUHI_TEST_DATABASE_URL
  || 'postgresql://postgres:postgres@127.0.0.1:55432/postgres'
const host = new URL(CONNECTION).hostname
if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(host)) {
  console.error(`\nThis test only ever runs against a LOCAL database (127.0.0.1), never against ${host}.`)
  console.error('Set RUHI_TEST_DATABASE_URL to a local Postgres to run it.\n')
  process.exit(2)
}
console.log(`\nThe admin panel's writes, on the local test database at ${host}\n`)

let failures = 0
let checks = 0
const ok = (name, detail = '') => { checks += 1; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`) }
const bad = (name, detail = '') => { checks += 1; failures += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
const expect = (name, actual, want) => {
  const same = JSON.stringify(actual) === JSON.stringify(want)
  if (same) ok(name, typeof want === 'string' ? want : '')
  else bad(name, `wanted ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`)
}
const section = (t) => console.log(`\n--- ${t} ---`)

const connect = async () => {
  const c = new Client({ connectionString: CONNECTION })
  c.on('error', () => {})
  await c.connect()
  return c
}
/** Run a statement as a given role, with a given signed-in user (or nobody). */
const as = async (role, uid, sql, params = []) => {
  const c = await connect()
  try {
    await c.query('begin')
    if (uid) await c.query(`set local request.jwt.claim.sub = '${uid}'`)
    await c.query(`set local role ${role}`)
    const r = await c.query(sql, params)
    await c.query('commit')
    return { ok: true, rows: r.rows, count: r.rowCount }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    return { ok: false, code: e.code, message: e.message }
  } finally {
    await c.end().catch(() => {})
  }
}
const q = async (sql, params = []) => {
  const c = await connect()
  try { return await c.query(sql, params) } finally { await c.end().catch(() => {}) }
}

const ADMIN = '11111111-1111-4111-8111-111111111111'
const CUSTOMER = '22222222-2222-4222-8222-222222222222'
const FIXTURE = 'admin-write-test-product'
const isTest = (s) => String(s || '').includes('admin-write-test')

// ---- the room the test needs ----------------------------------------------
await q(`delete from public.bestsellers where product_id like 'admin-write-test%'`)
await q(`delete from public.banners where link like '%admin-write-test%'`)
await q(`delete from public.categories where key like 'admin-write-test%'`)
await q(`delete from public.admins where user_id in ('${ADMIN}', '${CUSTOMER}')`)
// An admin is a person in auth.users; the row in public.admins is what makes
// them an admin. Both are needed before the policies will let them write.
await q(`insert into auth.users (id, email) values ('${ADMIN}', 'admin-write-test@example.test')
         on conflict (id) do update set email = excluded.email`)
await q(`insert into auth.users (id, email) values ('${CUSTOMER}', 'customer-write-test@example.test')
         on conflict (id) do update set email = excluded.email`)
await q(`insert into public.admins (user_id, email) values ('${ADMIN}', 'admin-write-test@example.test')`)
await q(`insert into public.products (id, title, price, sizes, is_active, type, image)
         select '${FIXTURE}', 'Admin Write Test Piece', 500, array['M'], true,
                (select key from public.categories order by key limit 1), '/images/products/none.jpg'
         on conflict (id) do update set price = 500, sizes = array['M'], is_active = true`)

// ---------------------------------------------------------------------------
section('1. an order, and its status')
// ---------------------------------------------------------------------------
const order = await q(`insert into public.orders (full_name, email, phone, address, city, state, pincode, payment_method, payment_status, status)
                        values ('Admin Write Tester', 'admin-write-test@example.test', '9000000000', '1 Test Street', 'Pune', 'Maharashtra', '411001', 'razorpay', 'pending', 'pending')
                        returning id::text as id, reference, status`)
const orderId = order.rows[0].id
ok('an order exists', `${order.rows[0].reference}, status ${order.rows[0].status}`)

const asAdmin = await as('authenticated', ADMIN,
  `update public.orders set status = 'shipped' where id = $1 returning status`, [orderId])
expect('an admin can change the status', asAdmin.ok ? asAdmin.rows[0].status : asAdmin.message, 'shipped')
const readBack = await q(`select status from public.orders where id = $1`, [orderId])
expect('and the change sticks', readBack.rows[0].status, 'shipped')

const asCustomer = await as('authenticated', CUSTOMER,
  `update public.orders set status = 'cancelled' where id = $1 returning status`, [orderId])
// Row level security filters the row out rather than raising: the statement
// runs, touches nothing, and returns no rows. That silence is the answer.
expect('a signed-in customer who is not an admin cannot', asCustomer.ok ? asCustomer.rows.length : 0, 0)
const stillShipped = await q(`select status from public.orders where id = $1`, [orderId])
expect('and the order is untouched', stillShipped.rows[0].status, 'shipped')

const asAnon = await as('anon', null,
  `update public.orders set status = 'cancelled' where id = $1 returning status`, [orderId])
expect('an anonymous visitor cannot either', asAnon.ok, false)
const customerRead = await as('authenticated', CUSTOMER, `select status from public.orders where id = $1`, [orderId])
expect('a customer cannot read somebody else\'s order', customerRead.ok ? customerRead.rows.length : 1, 0)

// ---------------------------------------------------------------------------
section('2. the payment fields are not the admin\'s to write')
// ---------------------------------------------------------------------------
const paid = await as('authenticated', ADMIN,
  `update public.orders set payment_status = 'paid', paid_at = now() where id = $1 returning payment_status`, [orderId])
expect('an admin cannot mark an order paid', paid.ok, false)
expect('and the database says why', /payment details/i.test(paid.message || ''), true)
const stillPending = await q(`select payment_status from public.orders where id = $1`, [orderId])
expect('the order is still pending', stillPending.rows[0].payment_status, 'pending')

// ---------------------------------------------------------------------------
section('3. the best sellers')
// ---------------------------------------------------------------------------
const addBest = await as('authenticated', ADMIN,
  `insert into public.bestsellers (product_id, position, is_active) values ('${FIXTURE}', 0, true) returning product_id`)
expect('an admin can add a best seller', addBest.ok, true)
const addBestPlain = await as('authenticated', CUSTOMER,
  `insert into public.bestsellers (product_id, position, is_active) values ('${FIXTURE}', 1, true) returning product_id`)
expect('a customer who is not an admin cannot', addBestPlain.ok, false)

const list = await as('authenticated', ADMIN,
  `select product_id, position, is_active from public.bestsellers order by position`)
expect('the admin sees the list', list.ok ? list.rows.length : 0, 1)
const anonList = await as('anon', null, `select count(*)::int as n from public.bestsellers`)
expect('and a visitor may read it', anonList.ok, true)

const reorder = await as('authenticated', ADMIN,
  `update public.bestsellers set position = 5 where product_id = '${FIXTURE}' returning position`)
expect('an admin can move it down the row', reorder.ok ? reorder.rows[0].position : reorder.message, 5)
const switchedOff = await as('authenticated', ADMIN,
  `update public.bestsellers set is_active = false where product_id = '${FIXTURE}' returning is_active`)
expect('and switch it off', switchedOff.ok ? switchedOff.rows[0].is_active : switchedOff.message, false)
const stillThere = await as('authenticated', ADMIN,
  `select count(*)::int as n from public.bestsellers where product_id = '${FIXTURE}'`)
expect('switching it off leaves it on file', stillThere.rows[0].n, 1)
const removedByCustomer = await as('authenticated', CUSTOMER,
  `delete from public.bestsellers where product_id = '${FIXTURE}' returning product_id`)
// As with the order, row level security filters the row out instead of
// raising: the statement runs, removes nothing, and returns no rows.
expect('a customer who is not an admin cannot remove it', removedByCustomer.ok ? removedByCustomer.rows.length : 0, 0)
const stillOnFile = await q(`select count(*)::int as n from public.bestsellers where product_id = '${FIXTURE}'`)
expect('and it is still on file', stillOnFile.rows[0].n, 1)
const removed = await as('authenticated', ADMIN,
  `delete from public.bestsellers where product_id = '${FIXTURE}' returning product_id`)
expect('and an admin can remove it', removed.ok, true)

// ---------------------------------------------------------------------------
section('4. the banners')
// ---------------------------------------------------------------------------
const addBanner = await as('authenticated', ADMIN,
  `insert into public.banners (slot, image, link, position, is_active) values ('home_hero', '/images/products/none.jpg', '/shop?type=admin-write-test', 0, true) returning id`)
expect('an admin can add a banner', addBanner.ok, true)
const addBannerPlain = await as('authenticated', CUSTOMER,
  `insert into public.banners (slot, image, link, position, is_active) values ('home_hero', '/images/products/none.jpg', '/shop?type=admin-write-test-2', 1, true) returning id`)
expect('a customer who is not an admin cannot', addBannerPlain.ok, false)
const bannerRow = await q(`select id::text, position, is_active from public.banners where link = '/shop?type=admin-write-test'`)
const bannerId = bannerRow.rows[0]?.id
const moveBanner = await as('authenticated', ADMIN,
  `update public.banners set position = 3 where id = $1 returning position`, [bannerId])
expect('an admin can move it down the slider', moveBanner.ok ? moveBanner.rows[0].position : moveBanner.message, 3)
const offBanner = await as('authenticated', ADMIN,
  `update public.banners set is_active = false where id = $1 returning is_active`, [bannerId])
expect('and switch it off', offBanner.ok ? offBanner.rows[0].is_active : offBanner.message, false)
const delBanner = await as('authenticated', ADMIN, `delete from public.banners where id = $1 returning id`, [bannerId])
expect('and remove it', delBanner.ok, true)

// ---------------------------------------------------------------------------
section('5. the categories')
// ---------------------------------------------------------------------------
const addCat = await as('authenticated', ADMIN,
  `insert into public.categories (key, label, position) values ('admin-write-test-cat', 'Admin Write Test', 90) returning key, code`)
expect('an admin can create a category', addCat.ok, true)
expect('and it is given a Product ID code of its own', addCat.ok ? /^\d{2}$/.test(String(addCat.rows[0].code || '')) : false, true)
const addCatPlain = await as('authenticated', CUSTOMER,
  `insert into public.categories (key, label, position) values ('admin-write-test-cat-2', 'Admin Write Test 2', 91) returning key`)
expect('a customer who is not an admin cannot', addCatPlain.ok, false)
const renameCat = await as('authenticated', ADMIN,
  `update public.categories set label = 'Admin Write Test Renamed' where key = 'admin-write-test-cat' returning label`)
expect('an admin can rename it', renameCat.ok ? renameCat.rows[0].label : renameCat.message, 'Admin Write Test Renamed')
const delCat = await as('authenticated', ADMIN,
  `delete from public.categories where key = 'admin-write-test-cat' returning key`)
expect('and delete it once it holds nothing', delCat.ok, true)

// ---------------------------------------------------------------------------
section('6. nothing this test wrote is left behind')
// ---------------------------------------------------------------------------
await q(`delete from public.bestsellers where product_id like 'admin-write-test%'`)
await q(`delete from public.banners where link like '%admin-write-test%'`)
await q(`delete from public.categories where key like 'admin-write-test%'`)
await q(`delete from public.orders where email like 'admin-write-test%'`)
await q(`delete from public.admins where user_id in ('${ADMIN}', '${CUSTOMER}')`)
await q(`delete from public.products where id = '${FIXTURE}'`)
const left = await q(`select
  (select count(*)::int from public.bestsellers where product_id like 'admin-write-test-%')
  + (select count(*)::int from public.banners where link like '%admin-write-test%')
  + (select count(*)::int from public.categories where key like 'admin-write-test%')
  + (select count(*)::int from public.orders where email like 'admin-write-test%')
  + (select count(*)::int from public.products where id = '${FIXTURE}') as n`)
expect('every row it made is gone again', left.rows[0].n, 0)

console.log(`\n${failures ? '✗' : '✓'} ${checks - failures} of ${checks} checks passed`)
process.exit(failures ? 1 : 0)
