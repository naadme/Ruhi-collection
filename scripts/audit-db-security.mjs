// Read-only database audit for the shop's own database.
//   node scripts/audit-db-security.mjs
//
// It only ever READS: every statement is a SELECT.
import { execFileSync } from 'node:child_process'

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

const show = async (title, sql) => {
  console.log(`\n--- ${title} ---`)
  const rows = await query(sql)
  console.table(rows)
  return rows
}

console.log('\nThe shop\'s own database, read only\n')

await show('every public table: RLS on, and what anon may write', `
  select c.relname as table,
         c.relrowsecurity as rls_enabled,
         (select count(*) from information_schema.role_table_grants g
           where g.table_schema = 'public' and g.table_name = c.relname
             and g.grantee = 'anon'
             and g.privilege_type in ('INSERT','UPDATE','DELETE'))::int as anon_writes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by c.relrowsecurity, c.relname`)

await show('every policy, and who it speaks for', `
  select tablename, policyname, cmd, roles::text as roles
    from pg_policies where schemaname = 'public'
   order by tablename, cmd, policyname`)

await show('functions an anonymous browser may call', `
  select p.proname as function,
         p.prosecdef as security_definer,
         pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'EXECUTE')
   order by p.proname`)

await show('the same, for a signed-in customer', `
  select p.proname as function,
         p.prosecdef as security_definer,
         pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
   order by p.proname`)

await show('the rows a signed-in customer can see in orders', `
  select count(*)::int as total_orders,
         count(*) filter (where user_id is not null)::int as tied_to_a_customer
    from public.orders`)

await show('the admin list', `
  select count(*)::int as admins from public.admins`)
