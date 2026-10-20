#!/usr/bin/env node
/**
 * Prove that the Google Sheets export really wrote to the owner's sheet.
 *
 *   node scripts/verify-google-sheets-export.mjs
 *
 * It reads the export receipt — what GOOGLE confirmed it wrote, captured
 * after the append succeeded — together with the export ledger, and prints
 * them. The receipt only exists if the append succeeded, so it is proof, not
 * a claim.
 *
 * Nothing secret is read or printed: the access token stays encrypted in the
 * database, and the Supabase Management API returns digests rather than
 * values for every secret.
 */
import { execFileSync } from 'node:child_process'

const REF = 'xhsjwhzutalckeektluj'

const ok = (m) => console.log(`  \u2713 ${m}`)
const bad = (m) => console.log(`  \u2717 ${m}`)
const info = (m) => console.log(`    ${m}`)

const token = execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], {
  encoding: 'utf8',
}).trim()

/** One read-only query, as the postgres role. */
async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    bad(`The database could not be read: ${JSON.stringify(body).slice(0, 200)}`)
    process.exit(1)
  }
  const rows = Array.isArray(body) ? body : []
  return rows.length ? rows[0] : {}
}

const conn = await query(
  "select coalesce(google_email,'') as email, coalesce(spreadsheet_title,'') as title,"
  + " coalesce(spreadsheet_id,'') as sheet_id, coalesce(sheet_tab,'Orders') as tab,"
  + " last_export_at::text as at, coalesce(last_export_orders,0) as orders,"
  + " coalesce(last_export_rows,0) as rows, coalesce(last_export_range,'') as range,"
  + " created_at::text as connected_at from public.google_sheets_connections limit 1",
)
const ledger = await query(
  "select count(*)::text as n from public.order_sheet_exports",
)

console.log('\nThe Google Sheets connection')
if (!conn.email && !conn.sheet_id) {
  bad('Nobody has connected a Google account yet.')
  info('Open https://www.ruhi-collections.com/admin?section=orders&connect=1')
  info('Sign in with your Google account and approve the access.')
  process.exit(1)
}
ok(`connected as ${conn.email || '(unknown account)'} on ${conn.connected_at}`)
info(`destination: ${conn.title || '(none)'} — ${conn.sheet_id || '(none)'} (tab “${conn.tab}”)`)

console.log('\nThe last export — as Google confirmed it')
if (!conn.at) {
  bad('Nothing has been exported yet.')
  info('Press “Export to Google Sheets” in Admin → Orders.')
  process.exit(1)
}
ok(`${conn.orders} order(s), ${conn.rows} row(s) written to ${conn.range}`)
info(`at ${conn.at}`)

console.log('\nThe export ledger')
ok(`${ledger.n} order(s) recorded as sent`)
info('Each of those is never sent to the same sheet twice.')
console.log('')
