// Apply a migration to the shop's own database through the Management API,
// with a snapshot of every order taken before and after so it can be proved
// that nothing was renumbered, deleted or altered.
//
//   node scripts/apply-migration.mjs supabase/migrations/<file>.sql
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

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

const files = process.argv.slice(2)
if (!files.length) {
  console.error('\nusage: node scripts/apply-migration.mjs <migration.sql> [...]\n')
  process.exit(2)
}

// ---- what the orders look like now ---------------------------------------
const SNAPSHOT = `select id::text as id, reference, coalesce(previous_reference, '') as previous_reference,
                         created_at::text as created_at, payment_method, payment_status, status,
                         subtotal, shipping, discount, total, email
                    from public.orders order by id`
const before = await query(SNAPSHOT)
console.log(`\n  ${before.length} orders before`)

for (const file of files) {
  const sql = fs.readFileSync(file, 'utf8')
  console.log(`\n  applying ${file}`)
  try {
    await query(`begin;\n${sql}\ncommit;`)
    console.log('    applied')
  } catch (e) {
    console.error(`    FAILED: ${e.message}`)
    try { await query('rollback;') } catch { /* nothing to roll back */ }
    process.exit(1)
  }
}

// ---- and afterwards -------------------------------------------------------
const after = await query(SNAPSHOT)
console.log(`\n  ${after.length} orders after`)

const key = (r) => r.id
const beforeMap = new Map(before.map((r) => [key(r), JSON.stringify(r)]))
const afterMap = new Map(after.map((r) => [key(r), JSON.stringify(r)]))

const changed = [...beforeMap.keys()].filter((k) => afterMap.has(k) && beforeMap.get(k) !== afterMap.get(k))
const removed = [...beforeMap.keys()].filter((k) => !afterMap.has(k))
const added = [...afterMap.keys()].filter((k) => !beforeMap.has(k))

console.log(`  orders changed : ${changed.length}`)
console.log(`  orders removed : ${removed.length}`)
console.log(`  orders added   : ${added.length}`)
if (changed.length) {
  console.log('\n  CHANGED:')
  for (const k of changed.slice(0, 10)) {
    console.log('   before', beforeMap.get(k))
    console.log('   after ', afterMap.get(k))
  }
}
if (removed.length) console.log('  REMOVED:', removed.slice(0, 10))
if (added.length) console.log('  ADDED:', added.slice(0, 10))
console.log(changed.length || removed.length || added.length
  ? '\n  the orders are NOT as they were\n'
  : '\n  every order is exactly as it was\n')
process.exit(changed.length || removed.length || added.length ? 1 : 0)
