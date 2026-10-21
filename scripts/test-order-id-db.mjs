// The isolated test database the order ID tests run against.
//
//   node scripts/test-order-id-db.mjs
//
// It builds a throw-away PostgreSQL in Docker, gives it the scaffolding a
// Supabase project has (scripts/test-db-bootstrap.sql), and then applies the
// SHOP'S OWN MIGRATIONS — every file in supabase/migrations, in order,
// unchanged — so the logic under test is exactly the logic that runs in
// production.
//
// The shop's own database is never touched: the container is created from a
// plain postgres image, and nothing here knows the shop's connection string.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const CONTAINER = 'ruhi-order-id-test'
const PORT = 55432
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim()
const exists = (name) => {
  try { docker('inspect', '--format', '{{.Name}}', name); return true } catch { return false }
}

console.log('\nThe isolated test database\n')

// ---- the container ---------------------------------------------------------
// It is given room for 300 connections: the test opens one connection for
// every order it creates at once, and the default 100 is not enough.
if (exists(CONTAINER)) {
  const running = docker('inspect', '--format', '{{.State.Running}}', CONTAINER) === 'true'
  if (running) {
    console.log('  the test database is already running')
  } else {
    docker('start', CONTAINER)
    console.log('  the test database was started again')
  }
} else {
  console.log('  creating a throw-away PostgreSQL…')
  docker('run', '-d', '--name', CONTAINER,
    '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=postgres',
    '-p', `${PORT}:5432`, 'postgres:16-alpine',
    '-c', 'postgres', '-c', 'max_connections=300')
}

// ---- the `pg_net` stub -----------------------------------------------------
// One migration asks for Supabase's `pg_net` extension, which is what gives
// it `net.http_post`. A plain PostgreSQL has no such extension, so a stub is
// installed into the container's extension directory: the migration then runs
// exactly as it does in production, and the stub only ever answers "queued".
const PGNET_CONTROL = `comment = 'stub of pg_net for the isolated order ID test database'
default_version = '1.0'
relocatable = false
`
const PGNET_SQL = `-- The stub is empty on purpose: net.http_post itself is part of the
-- scaffolding in scripts/test-db-bootstrap.sql, so nothing here has to be a
-- member of the extension. The migration only asks for the extension to
-- exist, and it does.
`
const put = (pathInContainer, text) => {
  const res = spawnSync('docker', ['exec', '-i', CONTAINER, 'sh', '-c', `cat > ${pathInContainer}`], { input: text, encoding: 'utf8' })
  if (res.status !== 0) throw new Error(`could not write ${pathInContainer}: ${res.stderr}`)
}
// The extension directory is wherever this image keeps it.
const extensionDir = docker('exec', CONTAINER, 'sh', '-c', 'pg_config --sharedir') + '/extension'
put(`${extensionDir}/pg_net.control`, PGNET_CONTROL)
put(`${extensionDir}/pg_net--1.0.sql`, PGNET_SQL)

// ---- wait for it to accept connections -------------------------------------
const client = new pg.Client({ connectionString: URL })
let up = false
for (let i = 0; i < 40 && !up; i += 1) {
  await new Promise((r) => setTimeout(r, 500))
  try { await client.connect(); up = true } catch { /* not yet */ }
}
if (!up) {
  console.error('\n  the test database did not come up\n')
  process.exit(1)
}
console.log('  the test database is ready')

// ---- room for a hundred and twenty parallel connections -------------------
// The test opens a connection for every order it creates at once, so the
// test database is given room for them. (This is the throw-away database,
// not the shop.) Postgres only reads this number when it starts, so a
// container that was made with the old limit is restarted once.
const limit = (await client.query('show max_connections')).rows[0].max_connections
if (Number(limit) < 250) {
  await client.query('alter system set max_connections = 300')
  await client.end()
  docker('restart', CONTAINER)
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    try { await client.connect(); break } catch { /* not yet */ }
  }
  console.log('  the test database has room for 300 connections')
}

// ---- a clean room, then the scaffolding ------------------------------------
await client.query('drop schema if exists public cascade; create schema public;')
const bootstrap = fs.readFileSync(path.join(here, 'test-db-bootstrap.sql'), 'utf8')
await client.query(bootstrap)
console.log('  the scaffolding is in place')

// ---- the shop's own migrations, unchanged ----------------------------------
const dir = path.join(root, 'supabase', 'migrations')
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
let applied = 0
for (const file of files) {
  const sql = fs.readFileSync(path.join(dir, file), 'utf8')
  try {
    await client.query('begin')
    await client.query(sql)
    await client.query('commit')
    applied += 1
  } catch (e) {
    await client.query('rollback').catch(() => {})
    console.error(`\n  ✗ ${file} could not be applied:\n    ${e.message}\n`)
    process.exit(1)
  }
}
console.log(`  ${applied} of the shop's own migrations applied, unchanged`)

// ---- what the test database now holds --------------------------------------
const orders = await client.query('select count(*)::int as n from public.orders')
const products = await client.query('select count(*)::int as n from public.products')
const fn = await client.query(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                               where n.nspname = 'public' and proname in ('create_order','next_order_reference','assign_order_reference')
                               order by proname`)
console.log(`  the order functions are here: ${fn.rows.map((r) => r.proname).join(', ')}`)
console.log(`  ${orders.rows[0].n} orders and ${products.rows[0].n} products in the empty shop`)

await client.end()
console.log(`\n  the test database is ready at ${URL}\n`)
