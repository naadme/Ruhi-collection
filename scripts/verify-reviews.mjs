#!/usr/bin/env node
/**
 * Prove the review system against the LIVE database — not a copy, and not a
 * claim made by reading the migration file.
 *
 *   node scripts/verify-reviews.mjs      (npm run verify:reviews)
 *
 * Three groups of evidence:
 *
 *   1. What the database IS: the table, its CHECKs, its unique line key, RLS,
 *      the exact policies, and which roles may do what.
 *   2. What a BROWSER can do, asked through the public REST API with the
 *      publishable key — the same door every visitor uses. It may read
 *      published reviews; it may not insert, update or delete a row, and it
 *      may not call either function.
 *   3. What the WRITE PATH does, asked as the database itself inside one
 *      transaction that is ALWAYS rolled back: a signed-out caller is turned
 *      away, a stranger cannot review someone else's purchase, a short
 *      review is refused in the database's own words, the same purchase
 *      cannot be reviewed twice, and a genuine customer CAN review the piece
 *      she actually bought — landing as `pending`, not published.
 *
 * Nothing is written anywhere: every statement group runs inside a
 * transaction that ends in rollback, and the REST calls are refused by the
 * database itself. No customer's name, address or token is read or printed —
 * only the UUIDs the gates are keyed on.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const REF = 'xhsjwhzutalckeektluj'
const ok = (m) => console.log(`  \u2713 ${m}`)
const bad = (m) => { console.log(`  \u2717 ${m}`); failed = true }
const info = (m) => console.log(`    ${m}`)
let failed = false

// ---- the two doors --------------------------------------------------------

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)
const BASE = String(env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY

const token = execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], {
  encoding: 'utf8',
}).trim()

/** One statement group as the postgres role. Returns the first result set. */
async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) return { error: body?.message || JSON.stringify(body) }
  return { rows: Array.isArray(body) ? body : [] }
}

/** One call through the PUBLIC API, exactly as a browser would make it. */
async function rest(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      authorization: `Bearer ${ANON}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

/** The JWT claims a transaction runs under, as a set_config EXPRESSION.
 *  Always used inside a transaction that rolls back. */
const claim = (sub) => `set_config('request.jwt.claims',
  '{"sub":"${sub}","role":"authenticated"}', true)`

/**
 * Run one gate inside a transaction that is rolled back, and bring its answer
 * out as a ROW.
 *
 * The Management API does not hand back PL/pgSQL notices, so each gate writes
 * its own verdict into a transaction-local setting, which the closing SELECT
 * reads. The body is expected to catch the database's own refusal — a gate
 * that is allowed to pass writes "GATE FAILED" instead, which the caller
 * reports as a failure.
 */
async function gate(sub, body) {
  const r = await sql(`
begin;
${sub ? `select ${claim(sub)};` : ''}
do $do$
${body}
$do$;
select current_setting('ruhi.gate_result', true) as gate;
rollback;
`)
  if (r.error) return `ERROR: ${r.error}`
  return String(r.rows?.[0]?.gate ?? 'no answer')
}

/** A gate body: run `statements`, catch whatever the database says about it. */
const refuses = (statements) => `
declare v_err text := 'GATE FAILED: the database allowed it';
begin
  begin
    ${statements}
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('ruhi.gate_result', v_err, true);
end`

// ---------------------------------------------------------------------------
console.log('\n1. What the database is')
// ---------------------------------------------------------------------------

{
  const cols = await sql(`select column_name from information_schema.columns
    where table_schema='public' and table_name='product_reviews' order by ordinal_position`)
  const names = (cols.rows || []).map((c) => c.column_name)
  const want = ['id', 'product_id', 'order_item_id', 'user_id', 'rating', 'body', 'customer_name',
    'status', 'created_at', 'decided_at', 'decided_by']
  if (cols.error) bad(`the table could not be read: ${cols.error}`)
  else if (want.every((w) => names.includes(w))) ok(`the table exists with every column (${names.join(', ')})`)
  else bad(`missing columns: ${want.filter((w) => !names.includes(w)).join(', ')}`)
}

{
  const r = await sql(`select pg_get_constraintdef(oid) as def
    from pg_constraint where conrelid = 'public.product_reviews'::regclass
    and contype in ('c','u','p','f')`)
  const defs = (r.rows || []).map((x) => String(x.def))
  const has = (needle) => defs.some((d) => d.includes(needle))
  if (has('UNIQUE (order_item_id)')) ok('one order line can carry exactly one review (unique key)')
  else bad('the order line is not uniquely keyed')
  if (has('rating >= 1') && has('rating <= 5')) ok('the rating is CHECKed between 1 and 5')
  else bad('the rating CHECK is missing')
  if (has('status = ANY') && has('pending') && has('approved') && has('rejected')) {
    ok('the status is CHECKed to pending / approved / rejected')
  } else bad('the status CHECK is missing')
  if (defs.filter((d) => d.includes('ON DELETE CASCADE')).length >= 2) {
    ok('a deleted product or order line takes its reviews with it')
  } else bad('the cascade is missing')
}

{
  const r = await sql(`select relrowsecurity as rls from pg_class where oid='public.product_reviews'::regclass`)
  if (r.rows?.[0]?.rls === true) ok('row level security is ON')
  else bad(`row level security is ${r.rows?.[0]?.rls}`)
}

{
  const r = await sql(`select policyname, cmd, qual, with_check
    from pg_policies where schemaname='public' and tablename='product_reviews' order by policyname`)
  const rows = r.rows || []
  info(rows.map((x) => `${x.cmd}: ${x.policyname}`).join('\n    ') || 'no policies')
  if (rows.some((x) => x.cmd === 'INSERT')) bad('an INSERT policy exists — a browser could write a review')
  else ok('no INSERT policy: a browser cannot write a review by any route')
  if (rows.some((x) => x.cmd === 'SELECT' && /status = 'approved'/.test(x.qual || ''))) {
    ok('published reviews are readable by the public')
  } else bad('the public read policy is missing')
  const upd = rows.find((x) => x.cmd === 'UPDATE')
  if (upd && /is_admin\(\)/.test(upd.qual || '') && /is_admin\(\)/.test(upd.with_check || '')) {
    ok('only an admin may move a review between states')
  } else bad('the moderation policy is wrong or missing')
}

{
  const r = await sql(`
select
  has_table_privilege('anon', 'public.product_reviews', 'INSERT')   as anon_insert,
  has_table_privilege('anon', 'public.product_reviews', 'UPDATE')   as anon_update,
  has_table_privilege('anon', 'public.product_reviews', 'DELETE')   as anon_delete,
  has_table_privilege('anon', 'public.product_reviews', 'SELECT')   as anon_select,
  has_table_privilege('authenticated', 'public.product_reviews', 'INSERT') as auth_insert,
  has_table_privilege('authenticated', 'public.product_reviews', 'UPDATE') as auth_update,
  has_function_privilege('anon', 'public.submit_review(uuid,integer,text,text)', 'EXECUTE') as anon_submit,
  has_function_privilege('anon', 'public.reviewable_items(text[])', 'EXECUTE') as anon_reviewable,
  has_function_privilege('authenticated', 'public.submit_review(uuid,integer,text,text)', 'EXECUTE') as auth_submit`)
  const g = r.rows?.[0] || {}
  const no = (v) => v === false
  if (no(g.anon_insert) && no(g.anon_update) && no(g.anon_delete) && g.anon_select === true) {
    ok('anon may read and nothing else')
  } else bad(`anon privileges are wrong: ${JSON.stringify(g)}`)
  if (no(g.auth_insert) && g.auth_update === true) ok('authenticated may select and update — but never insert')
  else bad(`authenticated privileges are wrong: ${JSON.stringify(g)}`)
  if (no(g.anon_submit) && no(g.anon_reviewable) && g.auth_submit === true) {
    ok('both functions are refused to anon and offered to a signed-in customer')
  } else bad(`function privileges are wrong: ${JSON.stringify(g)}`)
}

// ---------------------------------------------------------------------------
console.log('\n2. What a browser can do (public API, publishable key)')
// ---------------------------------------------------------------------------

{
  const r = await rest('/rest/v1/product_reviews?select=id,status&limit=20')
  const rows = Array.isArray(r.body) ? r.body : []
  if (r.status !== 200) bad(`reading reviews failed: ${r.status} ${JSON.stringify(r.body)}`)
  else if (rows.every((x) => x.status === 'approved')) {
    ok(`a visitor can read reviews (${rows.length} published) and sees nothing else`)
  } else bad('a visitor was shown a review that is not published')
}

{
  // A real order line, taken straight from the database, so that if the write
  // were somehow allowed it WOULD be a valid review — and then it is checked,
  // row by row, that nothing was created.
  const line = await sql(`select oi.id as item, oi.product_id as product
    from public.order_items oi limit 1`)
  const item = line.rows?.[0]?.item
  const product = line.rows?.[0]?.product
  if (!item) {
    bad('there is no order line to test with')
  } else {
    const r = await rest('/rest/v1/product_reviews', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        product_id: product, order_item_id: item,
        user_id: '00000000-0000-0000-0000-000000000000',
        rating: 5, body: 'This is a test that must not be allowed to land.', customer_name: 'Nobody',
      }),
    })
    const count = await sql(`select count(*)::text as n from public.product_reviews`)
    const n = Number(count.rows?.[0]?.n)
    if (r.status >= 400 && n === 0) ok(`a visitor cannot insert a review (${r.status}) — and nothing landed`)
    else bad(`a visitor could insert a review: ${r.status} ${JSON.stringify(r.body)} — rows now ${n}`)
  }
}

{
  const patch = await rest('/rest/v1/product_reviews?id=eq.00000000-0000-0000-0000-000000000000', {
    method: 'PATCH', body: JSON.stringify({ status: 'approved' }),
  })
  if (patch.status >= 400) ok(`a visitor cannot publish a review (${patch.status})`)
  else bad(`a visitor could publish a review: ${JSON.stringify(patch.body)}`)

  const del = await rest('/rest/v1/product_reviews?id=eq.00000000-0000-0000-0000-000000000000', {
    method: 'DELETE',
  })
  if (del.status >= 400) ok(`a visitor cannot delete a review (${del.status})`)
  else bad(`a visitor could delete a review: ${JSON.stringify(del.body)}`)
}

{
  const submit = await rest('/rest/v1/rpc/submit_review', {
    method: 'POST',
    body: JSON.stringify({
      p_order_item_id: '00000000-0000-0000-0000-000000000000',
      p_rating: 5, p_body: 'A fine piece of clothing, well made.', p_name: 'Nobody',
    }),
  })
  if (submit.status >= 400) ok(`a visitor cannot call submit_review (${submit.status})`)
  else bad(`a visitor could call submit_review: ${JSON.stringify(submit.body)}`)

  const reviewable = await rest('/rest/v1/rpc/reviewable_items', {
    method: 'POST',
    body: JSON.stringify({ p_product_ids: ['anything'] }),
  })
  if (reviewable.status >= 400) ok(`a visitor cannot ask whose orders are reviewable (${reviewable.status})`)
  else bad(`a visitor could ask: ${JSON.stringify(reviewable.body)}`)
}

// ---------------------------------------------------------------------------
console.log('\n3. What the write path does (as the database, rolled back)')
// ---------------------------------------------------------------------------

{
  // A guest — the shop's most common customer — has no account to own an
  // order, so there is no review for them to write.
  const said = await gate(null, refuses(`
    perform public.submit_review('00000000-0000-0000-0000-000000000000', 5, 'A perfectly good review body.', 'A Visitor');`))
  if (/sign in/i.test(said)) ok(`a signed-out caller is refused: "${said}"`)
  else bad(`signed-out gate: ${said}`)
}

{
  const said = await gate('11111111-1111-1111-1111-111111111111', refuses(`
    perform public.submit_review('00000000-0000-0000-0000-000000000000', 5, 'A perfectly good review body.', 'A Stranger');`))
  if (/not on your account/i.test(said)) ok(`a stranger cannot review someone else's purchase: "${said}"`)
  else bad(`ownership gate: ${said}`)
}

{
  // Asked as the API would ask it: the authenticated role, with a customer's
  // claims on the connection. Even then the table itself refuses — only the
  // SECURITY DEFINER function may write a row.
  const r = await sql(`
begin;
select ${claim('22222222-2222-2222-2222-222222222222')};
set local role authenticated;
do $do$
declare v_err text := 'GATE FAILED: the database allowed it';
begin
  begin
    insert into public.product_reviews (product_id, order_item_id, user_id, rating, body, customer_name)
      values ('nothing', '00000000-0000-0000-0000-000000000000', auth.uid(), 5, 'A perfectly good review body.', 'Nobody');
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('ruhi.gate_result', v_err, true);
end
$do$;
select current_setting('ruhi.gate_result', true) as gate;
rollback;`)
  const role = r.rows?.[0]?.gate || r.error || 'no answer'
  if (/permission denied/i.test(role)) ok('a signed-in user cannot insert directly — only the function can')
  else bad(`direct-insert gate: ${role}`)
}

// The real thing: a genuine customer, a genuine purchase, one transaction,
// rolled back at the end.
const line = await sql(`
  select oi.id as item, oi.product_id as product, o.user_id as owner
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.user_id is not null and o.status <> 'cancelled'
    and not exists (select 1 from public.product_reviews r where r.order_item_id = oi.id)
  order by o.created_at desc limit 1`)
const { item, product, owner } = line.rows?.[0] || {}

if (!item) {
  info('No signed-in customer has an unreviewed purchase on file, so the write path is')
  info('proved against the gates above only.')
} else {
  {
    const said = await gate(owner, refuses(`
    perform public.submit_review('${item}', 5, 'Too short', 'Priya');`))
    if (/at least/i.test(said)) ok(`a too-short review is refused: "${said}"`)
    else bad(`short-body gate: ${said}`)
  }

  {
    const said = await gate(owner, refuses(`
    perform public.submit_review('${item}', 9, 'A perfectly good review body.', 'Priya');`))
    if (/between 1 and 5/i.test(said)) ok(`an out-of-range rating is refused: "${said}"`)
    else bad(`rating gate: ${said}`)
  }

  {
    const r = await sql(`
begin;
select ${claim(owner)};
do $do$
declare v_first text := 'GATE FAILED: the first review was not written';
         v_err  text := 'GATE FAILED: the database allowed a second review';
begin
  -- Each attempt in its own sub-transaction: the exception handler below
  -- undoes everything since ITS block began, so the two attempts must not
  -- share one — otherwise a refusal on the second would erase the first.
  begin
    perform public.submit_review('${item}', 5, 'Beautiful fabric and a lovely fit — washed well too.', 'Priya S.');
    v_first := 'first review written';
  exception when others then
    v_first := 'first review refused: ' || sqlerrm;
  end;
  begin
    perform public.submit_review('${item}', 4, 'Trying the same purchase a second time.', 'Priya S.');
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('ruhi.gate_result', v_first || ' | ' || v_err, true);
end
$do$;
select
  current_setting('ruhi.gate_result', true) as gate,
  (select status         from public.product_reviews order by created_at desc limit 1) as status,
  (select product_id     from public.product_reviews order by created_at desc limit 1) as product_id,
  (select (user_id is not null)::text
                          from public.product_reviews order by created_at desc limit 1) as has_owner;
rollback;`)
    const row = r.rows?.[0] || {}
    const said = row.gate
    if (/first review written/i.test(String(said))) ok('a genuine customer CAN review the piece she actually bought')
    else bad(`the happy path: ${said || r.error || 'no answer'}`)
    if (/already been reviewed/i.test(String(said))) ok('the same purchase cannot be reviewed twice')
    else bad(`duplicate gate: ${said || r.error || 'no answer'}`)
    if (row.status === 'pending') ok('a review that lands is PENDING — never published on the spot')
    else bad(`a new review landed as "${row.status}"`)
    if (row.product_id === product) ok('the review carries the product that was actually bought')
    else bad(`the review names "${row.product_id}", not the purchased product "${product}"`)
    if (row.has_owner === 'true') ok('and it is owned by the account that wrote it')
    else bad('the review does not record its author')
  }
}

console.log(failed ? '\n\u2717 the review system did not answer every question' : '\n\u2713 the review system answers every question')
process.exit(failed ? 1 : 0)
