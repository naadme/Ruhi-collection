// The two emails, rendered from a REAL order in the shop's own database.
//
//   node scripts/audit-order-emails.mjs
//
// It only reads: the order is fetched, the two email bodies are built from
// it and printed, and nothing is sent and nothing is written.
import { execFileSync } from 'node:child_process'
import { buildConfirmationText, buildConfirmationSubject, buildOwnerNotificationText, buildOwnerNotificationSubject } from '../supabase/functions/_shared/orderEmail.mjs'

const REF = 'xhsjwhzutalckeektluj'
const token = execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], { encoding: 'utf8' }).trim()
const query = (sql) => fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
}).then(async (r) => {
  const body = await r.json().catch(() => null)
  if (!r.ok) throw new Error(typeof body?.message === 'string' ? body.message : JSON.stringify(body))
  return body
})

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

console.log('\nThe order emails, built from a real order in the shop\'s database\n')

// The most recent order that has lines, so the email has something to list.
const rows = await query(`
  select o.id::text, o.reference, o.email, o.full_name, o.phone, o.address, o.city, o.state, o.pincode,
         o.payment_method, o.payment_status, o.status, o.subtotal, o.shipping, o.discount, o.total,
         o.created_at::text, o.note, o.coupon_code,
         json_agg(json_build_object(
           'title', i.title, 'size', i.size, 'qty', i.qty, 'unit_price', i.unit_price, 'sku', i.sku
         ) order by i.created_at) as items
    from public.orders o
    join public.order_items i on i.order_id = o.id
   group by o.id
   order by o.created_at desc
   limit 1`)
const order = rows[0]
const items = order.items
const plain = { ...order, items }

if (!order) {
  console.log('  the shop has no orders to build an email from')
  process.exit(0)
}

// ---------------------------------------------------------------------------
section('the customer\'s confirmation email')
// ---------------------------------------------------------------------------
const subject = buildConfirmationSubject(order.reference)
const text = buildConfirmationText(plain, items)
console.log(`    subject: ${subject}`)
console.log('    ' + text.split('\n').slice(0, 14).join('\n    '))

expect('the subject names the Order ID', subject.includes(order.reference), true)
expect('the body carries the Order ID', text.includes(order.reference), true)
expect('the body says "Order ID"', /Order ID/.test(text), true)
expect('the body has no "Product code"', /product code/i.test(text), false)
expect('the body has no "Product Code"', /Product Code/.test(text), false)

// The Product ID of every line that carries one.
const withId = items.filter((i) => String(i.sku || '').trim())
expect('every line that has a Product ID shows it', withId.every((i) => text.includes(i.sku)), true)
expect('and each of them is CCPPCL', withId.every((i) => /^[0-9]{2}[0-9]{2}[A-Z]{2}$/.test(i.sku)), true)
if (withId.length) console.log(`    Product ID(s) in the email: ${withId.map((i) => i.sku).join(', ')}`)

// ---------------------------------------------------------------------------
section('the owner\'s new-order notification')
// ---------------------------------------------------------------------------
const ownerSubject = buildOwnerNotificationSubject(plain)
const ownerText = buildOwnerNotificationText(plain, items)
console.log(`    subject: ${ownerSubject}`)
console.log('    ' + ownerText.split('\n').slice(0, 12).join('\n    '))

expect('the subject names the Order ID', ownerSubject.includes(order.reference), true)
expect('the body carries the Order ID', ownerText.includes(order.reference), true)
expect('the body has no "Product code"', /product code/i.test(ownerText), false)
expect('the body names the customer', ownerText.includes(order.full_name), true)
expect('and the Product ID of every line that has one', withId.every((i) => ownerText.includes(i.sku)), true)
expect('and the payment method', ownerText.length > 0 && /payment/i.test(ownerText), true)

// ---------------------------------------------------------------------------
section('the Order ID and the Product ID are two different things')
// ---------------------------------------------------------------------------
expect('the Order ID is DDMMYYNN', /^[0-9]{8}$/.test(order.reference), true)
const ids = withId.map((i) => i.sku)
expect('and the Product IDs are CCPPCL', ids.every((s) => /^[0-9]{2}[0-9]{2}[A-Z]{2}$/.test(s)), true)
expect('and the two never look alike', ids.every((s) => !s.startsWith(order.reference)), true)

console.log(`\n${failures ? '✗' : '✓'} ${checks - failures} of ${checks} checks passed`)
process.exit(failures ? 1 : 0)
