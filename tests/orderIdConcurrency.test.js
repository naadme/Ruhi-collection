// The order ID concurrency test and the isolated database it runs on.
//
// The behaviour itself is proved by scripts/test-order-id-concurrency.mjs,
// which needs Docker and a throw-away PostgreSQL. These tests guard the
// TOOLING, so that it can never do harm and never stops covering what it
// is meant to cover:
//   * it refuses to run against anything but a local database;
//   * it runs the shop's own migrations, unchanged, on that database;
//   * and it really does ask the questions it claims to ask.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const TEST = read('scripts/test-order-id-concurrency.mjs')
const SETUP = read('scripts/test-order-id-db.mjs')
const BOOTSTRAP = read('scripts/test-db-bootstrap.sql')

test('the concurrency test refuses to run against anything but a local database', () => {
  assert.match(TEST, /This test only ever runs against a LOCAL database/,
    'it says so when pointed at the wrong server')
  assert.match(TEST, /\['127\.0\.0\.1', 'localhost', '::1', '0\.0\.0\.0'\]\.includes\(host\)/,
    'and it checks the host before it connects')
  assert.match(TEST, /process\.exit\(2\)/,
    'and it stops rather than carrying on')
  // The shop's own connection string is nowhere in it.
  assert.ok(!/supabase\.co/.test(TEST), 'the shop\'s own address is nowhere in the test')
})

test('the test database is built from the shop\'s own migrations, unchanged', () => {
  assert.match(SETUP, /supabase['"]\s*,\s*['"]migrations['"]/,
    'it reads the migrations folder')
  assert.match(SETUP, /readFileSync\(path\.join\(dir, file\), 'utf8'\)/,
    'and reads each file whole')
  assert.match(SETUP, /await client\.query\(sql\)/,
    'and applies it as it stands')
  // Nothing is edited on the way in.
  assert.ok(!/\.replace\(/.test(SETUP.split('the shop\'s own migrations')[1] || ''),
    'no migration is rewritten on its way into the test database')
})

test('the scaffolding gives the migrations the Supabase pieces they expect', () => {
  for (const piece of ['auth.users', 'auth.uid()', 'storage.buckets', 'storage.objects',
    'vault.decrypted_secrets', 'net.http_post', 'supabase_migrations.schema_migrations']) {
    assert.ok(BOOTSTRAP.includes(piece), `the scaffolding provides ${piece}`)
  }
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.ok(BOOTSTRAP.includes(`rolname = '${role}'`), `the scaffolding provides the ${role} role`)
  }
})

test('the concurrency test asks the questions it is meant to ask', () => {
  // Two orders at the same moment.
  assert.match(TEST, /two orders created at exactly the same moment/,
    'the same-moment case')
  assert.match(TEST, /Promise\.all\(\[sameMoment\(1\), sameMoment\(2\)\]/,
    'and they really run at the same time')
  // A hundred and twenty at once.
  assert.match(TEST, /const N = 120/,
    'a hundred and twenty parallel orders')
  assert.match(TEST, /Promise\.all\(Array\.from\(\{ length: N \}/,
    'and they are started together')
  // Every number is its own.
  assert.match(TEST, /new Set\(ids\)\.size, ids\.length/,
    'no two successful orders share a number')
  // The day\'s own sequence.
  assert.match(TEST, /numbers, numbers\.map\(\(_, i\) => i \+ 1\)/,
    'the numbers of a day run in a row')
  // The shop\'s calendar, not the server\'s.
  assert.match(TEST, /Asia\/Kolkata/,
    'the day is the shop\'s')
  // Failures, rollbacks and retries.
  assert.match(TEST, /a transaction that fails takes nothing with it/,
    'the failure cases')
  assert.match(TEST, /pg_terminate_backend/,
    'including a session killed at the server')
  assert.match(TEST, /the same order, tried again/,
    'and the same order tried again')
})

test('the test cleans up after itself', () => {
  assert.match(TEST, /delete from public\.orders where email like 'order-id-test%/,
    'the orders it made are removed')
  assert.match(TEST, /delete from public\.products where id = \$1/,
    'and so is the product it borrowed')
})
