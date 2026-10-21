// The admin's date filter, driven with the REAL orders from the database.
//
// The point of the check: the filter has to use the shop's own day, the same
// one the Order ID's business day uses. The orders placed tonight (21 October
// 2026 in the shop, 20 October in UTC) are the interesting ones — they are the
// first orders of a new business day.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

import { filterAndSortOrders } from '../src/lib/orderFiltering.js'
import { formatShopDateTime, shopDayOf } from '../src/lib/shopTime.js'

// The orders, read with the management API (the browser cannot read them).
const query = "select id, reference, previous_reference, created_at, status, payment_status from public.orders order by created_at desc"
const out = execFileSync('/tmp/sql.sh', [query], { encoding: 'utf8' })
const parsed = JSON.parse(out)
const rows = Array.isArray(parsed) ? parsed : (parsed[0] || [])
const orders = rows.map((r) => ({ ...r }))

console.log(`\n${orders.length} real orders, read from the database`)
const byDay = {}
for (const o of orders) {
  const day = shopDayOf(o.created_at)
  byDay[day] = byDay[day] || []
  byDay[day].push(o.reference)
}
console.log('  the business day each order belongs to (the shop\'s own):')
for (const day of Object.keys(byDay).sort()) {
  console.log(`    ${day}: ${byDay[day].length} order(s) — ${byDay[day].join(', ')}`)
}

const days = Object.keys(byDay).sort()
const latest = days[days.length - 1]

console.log(`\n--- filtering by the shop's day ${latest} ---`)
const onThatDay = filterAndSortOrders(orders, { from: latest, to: latest })
console.log(`  the filter returns ${onThatDay.length} order(s): ${onThatDay.map((o) => o.reference).join(', ')}`)
const expected = byDay[latest].length
console.log(`  the orders whose ID starts with that day: ${expected}`)
const ddmmyy = (day) => day.slice(8, 10) + day.slice(5, 7) + day.slice(2, 4)
console.log(`  every returned order carries that day in its ID: ${onThatDay.every((o) => o.reference.startsWith(ddmmyy(latest)))}`)

console.log('\n--- the day before ---')
const before = days[days.length - 2]
const onThatDayBefore = filterAndSortOrders(orders, { from: before, to: before })
console.log(`  ${before}: ${onThatDayBefore.length} order(s) — ${onThatDayBefore.map((o) => o.reference).join(', ')}`)
console.log(`  every returned order carries that day in its ID: ${onThatDayBefore.every((o) => o.reference.startsWith(ddmmyy(before)))}`)

console.log('\n--- a range across several days ---')
const range = filterAndSortOrders(orders, { from: days[0], to: latest })
console.log(`  ${days[0]} → ${latest}: ${range.length} order(s) of ${orders.length}`)

console.log('\n--- the order date the panel would show ---')
for (const o of orders.slice(0, 4)) {
  console.log(`  ${o.reference}  ${o.created_at}  →  ${formatShopDateTime(o.created_at)}`)
}

console.log('\n--- searching by the OLD reference still finds the order ---')
const old = orders.find((o) => o.previous_reference)
if (old) {
  const found = filterAndSortOrders(orders, { query: old.previous_reference })
  console.log(`  ${old.previous_reference} → ${found.map((o) => o.reference).join(', ') || 'NOT FOUND'}`)
  const byNew = filterAndSortOrders(orders, { query: old.reference })
  console.log(`  ${old.reference} → ${byNew.map((o) => o.reference).join(', ') || 'NOT FOUND'}`)
} else {
  console.log('  (no order with an old reference)')
}

fs.writeFileSync('/tmp/audit-orders.json', JSON.stringify(orders, null, 2))
