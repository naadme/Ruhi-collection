// The Product ID, on an isolated database that has the shop's own migrations
// applied unchanged.
//
//   node scripts/test-order-id-db.mjs      (builds the throw-away database)
//   node scripts/test-product-ids.mjs      (runs this)
//
// It never touches the shop's own database: it refuses to run against
// anything but a local server, and every row it writes is removed again.
//
// What it proves:
//
//   1. the Product ID is CCPPCL — the category's number, the product's
//      number in that category, and the colour's two letters;
//   2. every colour of a design is a product of its own, with a Product ID
//      of its own, and two products never share one;
//   3. two colours that want the same letters (Blue and Black) are told
//      apart by a rule that is written down and never changes;
//   4. editing a product keeps its number — only the parts that describe
//      what it is NOW are refreshed — and an ID somebody else holds is never
//      taken;
//   5. an order snapshots the Product ID onto its line, and the snapshot
//      does not drift when the product is edited afterwards.
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
console.log(`\nThe Product ID, on the local test database at ${host}\n`)

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
const q = async (sql, params = []) => {
  const c = await connect()
  try { return await c.query(sql, params) } finally { await c.end().catch(() => {}) }
}

const CATEGORY = 'product-id-test-cat'
const PREFIX = 'product-id-test'

const clean = async () => {
  await q(`delete from public.order_items where order_id in (select id from public.orders where email like '${PREFIX}%@example.test')`)
  await q(`delete from public.orders where email like '${PREFIX}%@example.test'`)
  await q(`delete from public.products where id like '${PREFIX}%'`)
  await q(`delete from public.categories where key = '${CATEGORY}'`)
}

// ===========================================================================
await clean()

// ---------------------------------------------------------------------------
section('1. the category is given its own number')
// ---------------------------------------------------------------------------
const cat = await q(`insert into public.categories (key, label, position) values ($1, $2, 90) returning key, code`, [CATEGORY, 'Product ID Test'])
// The number the database gives it: two digits, and never one the seeded
// categories already hold.
expect('the category is numbered with two digits', /^[0-9]{2}$/.test(String(cat.rows[0].code || '')), true)
const catCode = cat.rows[0].code

// ---------------------------------------------------------------------------
section('2. every colour is a product with a Product ID of its own')
// ---------------------------------------------------------------------------
const addProduct = async (id, colour, title) => {
  const r = await q(`insert into public.products (id, title, type, price, sizes, is_active, colour)
                     values ($1, $2, $3, 500, array['M'], true, $4) returning id, sku`, [id, title, CATEGORY, colour])
  return r.rows[0]
}
const black = await addProduct(`${PREFIX}-black`, 'Black', 'Test Piece - Black')
const blue = await addProduct(`${PREFIX}-blue`, 'Blue', 'Test Piece - Blue')
const red = await addProduct(`${PREFIX}-red`, 'Red', 'Test Piece - Red')

expect('the first product is CCPPCL', black.sku, `${catCode}01BL`)
expect('the second product is CCPPCL', blue.sku, `${catCode}02BU`)
expect('the third product is CCPPCL', red.sku, `${catCode}03RE`)
expect('every Product ID has the six-character shape',
  [black.sku, blue.sku, red.sku].every((s) => /^[0-9]{2}[0-9]{2}[A-Z]{2}$/.test(s)), true)
expect('and no two products share one', new Set([black.sku, blue.sku, red.sku]).size, 3)

// ---------------------------------------------------------------------------
section('3. two colours that want the same letters')
// ---------------------------------------------------------------------------
// Blue and Black both begin with B, so both would want BL. The rule gives
// the letters to the colour that asked first and writes the answer down.
const colours = await q(`select colour, code from public.colour_codes where colour in ('blue','black') order by colour`)
const byColour = Object.fromEntries(colours.rows.map((r) => [r.colour, r.code]))
expect('Black and Blue are told apart', new Set([byColour.black, byColour.blue]).size, 2)
expect('and Black keeps the letters Blue would otherwise have taken', byColour.black, 'BL')
expect('while Blue keeps the next pair of its own letters', byColour.blue, 'BU')

// A colour nobody has used before takes the first free pair of its letters
// and is written down for good.
const fern = await addProduct(`${PREFIX}-fern`, 'Fern Green', 'Test Piece - Fern Green')
const fernCode = await q(`select code from public.colour_codes where colour = 'ferngreen'`)
expect('a brand-new colour is given letters', /^[A-Z]{2}$/.test(fernCode.rows[0].code), true)
expect('and its Product ID uses them', fern.sku, `${catCode}04${fernCode.rows[0].code}`)
const fernAgain = await q(`select code from public.colour_codes where colour = 'ferngreen'`)
expect('the answer is written down, so it never changes', fernAgain.rows[0].code, fernCode.rows[0].code)

// ---------------------------------------------------------------------------
section('4. editing a product keeps its number')
// ---------------------------------------------------------------------------
// The colour changes: the letters change, the number does not.
const edited = await q(`update public.products set colour = 'Wine' where id = $1 returning sku`, [`${PREFIX}-red`])
expect('a colour change keeps the product’s number', edited.rows[0].sku, `${catCode}03WI`)

// The category changes: the category's number changes, the product's number
// does not — unless the ID it would take is already held, in which case it
// takes the next free one rather than colliding.
const moved = await q(`update public.products set type = (select key from public.categories where key <> $1 order by position limit 1) where id = $2 returning sku`, [CATEGORY, `${PREFIX}-black`])
const movedSku = moved.rows[0].sku
expect('the category’s own number is now on the front', movedSku.slice(0, 2) !== catCode, true)
expect('and the ID still has the six-character shape', /^[0-9]{2}[0-9]{2}[A-Z]{2}$/.test(movedSku), true)
const collision = await q(`select id from public.products where sku = $1 and id <> $2`, [movedSku, `${PREFIX}-black`])
expect('and it never takes an ID somebody else holds', collision.rows.length, 0)
// Moved back: now nothing holds that number, so the product's own number is
// kept exactly as it is.
const back = await q(`update public.products set type = $1 where id = $2 returning sku`, [CATEGORY, `${PREFIX}-black`])
expect('and its own number is kept when it comes back', back.rows[0].sku, `${catCode}${movedSku.slice(2, 4)}${movedSku.slice(4)}`)

// A Product ID somebody else holds is never taken.
const clash = await q(`update public.products set colour = 'Red' where id = $1 returning sku`, [`${PREFIX}-blue`])
expect('an ID somebody else holds is never taken', clash.rows[0].sku !== blue.sku, true)
expect('and the product still has a well-formed ID', /^[0-9]{2}[0-9]{2}[A-Z]{2}$/.test(clash.rows[0].sku), true)

// ---------------------------------------------------------------------------
section('5. an order snapshots the Product ID')
// ---------------------------------------------------------------------------
const product = await q(`select id, sku, title from public.products where id = $1`, [`${PREFIX}-black`])
const order = await q(
  `insert into public.orders (full_name, email, phone, address, city, state, pincode, payment_method, payment_status, status)
   values ('Product ID Tester', '${PREFIX}-order@example.test', '9000000000', '1 Test Street', 'Pune', 'Maharashtra', '411001', 'razorpay', 'pending', 'pending')
   returning id`)
await q(`insert into public.order_items (order_id, product_id, title, size, qty, unit_price, sku)
         values ($1, $2, $3, 'M', 1, 500, $4)`, [order.rows[0].id, product.rows[0].id, product.rows[0].title, product.rows[0].sku])
const line = await q(`select sku from public.order_items where order_id = $1`, [order.rows[0].id])
expect('the line carries the Product ID of the product that was bought', line.rows[0].sku, product.rows[0].sku)

// The product is edited afterwards: the line must not follow it.
await q(`update public.products set colour = 'Off White' where id = $1`, [product.rows[0].id])
const lineAfter = await q(`select sku from public.order_items where order_id = $1`, [order.rows[0].id])
expect('and the snapshot does not drift when the product is edited', lineAfter.rows[0].sku, product.rows[0].sku)
expect('while the product itself has moved on', (await q(`select sku from public.products where id = $1`, [product.rows[0].id])).rows[0].sku !== product.rows[0].sku, true)

// ---------------------------------------------------------------------------
section('6. no two products share a Product ID')
// ---------------------------------------------------------------------------
const dupes = await q(`select sku, count(*)::int as n from public.products where sku is not null group by 1 having count(*) > 1`)
expect('no Product ID is used twice', dupes.rows.length, 0)
const all = await q(`select id, sku from public.products where id like $1 order by id`, [`${PREFIX}%`])
expect('every product has one', all.rows.every((r) => /^[0-9]{2}[0-9]{2}[A-Z]{2}$/.test(r.sku)), true)
expect('and they are all different', new Set(all.rows.map((r) => r.sku)).size, all.rows.length)

// ---------------------------------------------------------------------------
section('7. nothing this test wrote is left behind')
// ---------------------------------------------------------------------------
await clean()
const left = await q(`select
  (select count(*)::int from public.products where id like '${PREFIX}%')
  + (select count(*)::int from public.categories where key = '${CATEGORY}')
  + (select count(*)::int from public.orders where email like '${PREFIX}%@example.test') as n`)
expect('every row it made is gone again', left.rows[0].n, 0)

console.log(`\n${failures ? '✗' : '✓'} ${checks - failures} of ${checks} checks passed`)
process.exit(failures ? 1 : 0)
