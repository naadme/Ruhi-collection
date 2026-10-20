// The order-ID system, checked against the live database.
//
//   node scripts/verify-order-ids.mjs
//
// Every probe that needs an order runs inside a transaction that is rolled
// back, so no order is created and no order row is changed. The only thing
// this script leaves behind is the answer it prints.
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

let failures = 0
const ok = (m) => console.log(`  \u2713 ${m}`)
const bad = (m) => { console.log(`  \u2717 ${m}`); failures += 1 }
const check = (label, actual, expected) => {
  if (actual === expected) ok(`${label} = ${actual}`)
  else bad(`${label} = ${actual} (expected ${expected})`)
}

// ---------------------------------------------------------------------------
console.log('\n1. The format, and the day it belongs to')
{
  const rows = await query(`select
      public.next_order_reference('2026-10-01 10:00:00+00'::timestamptz) as october,
      public.next_order_reference('2026-12-31 20:00:00+00'::timestamptz) as new_years_eve,
      public.next_order_reference('2027-01-01 20:00:00+00'::timestamptz) as new_year,
      public.next_order_reference('2028-02-29 20:00:00+00'::timestamptz) as leap_day,
      public.next_order_reference('2026-10-01 18:29:59+00'::timestamptz) as just_before_midnight_ist,
      public.next_order_reference('2026-10-01 19:00:00+00'::timestamptz) as just_after_midnight_ist`)
  const r = rows[0]
  check('the first order of 1 October 2026', r.october, '01102601')
  check('31 December 2026 (still 2026 in India)', r.new_years_eve, '01012701')
  check('1 January 2027 (already 2027 in India)', r.new_year, '02012701')
  check('29 February 2028', r.leap_day, '01032801')
  check('an hour before midnight in India is still that day', r.just_before_midnight_ist, '01102601')
  check('half past midnight in India is the next day', r.just_after_midnight_ist, '02102601')
}

// ---------------------------------------------------------------------------
console.log('\n2. The first and second order of a day, and the day after')
{
  const rows = await query(`
    begin;
    insert into public.orders (reference, full_name, email, phone, address, city, state, pincode, subtotal, shipping, discount, total, created_at)
    values (null, 'Probe one', 'probe-one@example.invalid', '9000000001', '1 Test Street', 'Pune', 'MH', '411001', 100, 0, 0, 100, '2026-03-15 10:00:00+00'::timestamptz),
           (null, 'Probe two', 'probe-two@example.invalid', '9000000002', '2 Test Street', 'Pune', 'MH', '411001', 100, 0, 0, 100, '2026-03-15 18:00:00+00'::timestamptz),
           (null, 'Probe three', 'probe-three@example.invalid', '9000000003', '3 Test Street', 'Pune', 'MH', '411001', 100, 0, 0, 100, '2026-03-16 10:00:00+00'::timestamptz);
    select email, reference from public.orders where email like 'probe-%@example.invalid' order by email;
    rollback;`)
  const by = Object.fromEntries(rows.map((r) => [r.email.split('@')[0].replace('probe-', ''), r.reference]))
  check('the first order of 15 March 2026', by.one, '15032601')
  check('the second order of 15 March 2026', by.two, '15032602')
  check('the first order of 16 March 2026', by.three, '16032601')
}

// ---------------------------------------------------------------------------
console.log('\n3. Two orders placed at the same moment')
{
  // The lock is what makes this safe, so it is proved on a scratch table that
  // copies the pattern exactly: one transaction takes the day's lock and
  // commits, the other waits for it and must then take the NEXT number.
  await query(`create table if not exists public._order_id_probe (id serial primary key, ref text); truncate public._order_id_probe;
    drop function if exists public._order_id_probe_next(text);
    create function public._order_id_probe_next(p_day text)
    returns text language plpgsql volatile as $$
    declare v_next integer;
    begin
      perform pg_advisory_xact_lock(hashtext('probe'), hashtext(p_day));
      select coalesce(max(nullif(substr(ref, 7, 2), '')::integer), 0) + 1 into v_next
        from public._order_id_probe where ref ~ ('^' || p_day || '[0-9]{2}$');
      return p_day || lpad(v_next::text, 2, '0');
    end $$;`)
  const a = query(`begin;
      insert into public._order_id_probe (ref) values (public._order_id_probe_next('011026'));
      select pg_sleep(4); commit; select 'done' as marker;`)
  const b = (async () => {
    await new Promise((r) => setTimeout(r, 1500))
    return query(`begin; select public._order_id_probe_next('011026') as ref; commit;`)
  })()
  const [, bRes] = await Promise.all([a, b])
  check('the second order takes the next number', bRes[0].ref, '01102602')
  await query('drop table if exists public._order_id_probe; drop function if exists public._order_id_probe_next(text);')
}

// ---------------------------------------------------------------------------
console.log('\n4. A payment retry reuses the order and takes no new number')
{
  const rows = await query(`
    begin;
    select public.create_order('{"items":[{"product_id":"solid-shirts-blue","size":"M","qty":1}],
      "full_name":"Retry Probe","email":"retry-probe@example.invalid","phone":"9000000099",
      "address":"9 Retry Street","city":"Pune","state":"MH","pincode":"411001",
      "payment_method":"razorpay"}'::json) as first_call;
    select public.create_order('{"items":[{"product_id":"solid-shirts-blue","size":"M","qty":1}],
      "full_name":"Retry Probe","email":"retry-probe@example.invalid","phone":"9000000099",
      "address":"9 Retry Street","city":"Pune","state":"MH","pincode":"411001",
      "payment_method":"razorpay"}'::json) as second_call;
    select count(*)::int as orders_made, count(distinct reference)::int as numbers_used
      from public.orders where email = 'retry-probe@example.invalid';
    rollback;`)
  const counts = rows[rows.length - 1]
  check('the retry made no second order', String(counts.orders_made), '1')
  check('and used no second number', String(counts.numbers_used), '1')
}

// ---------------------------------------------------------------------------
console.log('\n5. The database refuses a duplicate, and stops at 99 a day')
{
  const rows = await query(`
    begin;
    create temporary table probe (what text primary key, value text);
    do $$
    begin
      -- an ID that a real order already holds
      insert into public.orders (reference, full_name, email, phone, address, city, state, pincode, subtotal, shipping, discount, total, created_at)
      values ('05102601', 'Duplicate', 'dup-probe@example.invalid', '9000000088', '8 Test Street', 'Pune', 'MH', '411001', 100, 0, 0, 100, '2026-03-15 10:00:00+00'::timestamptz);
      insert into probe values ('duplicate', 'ACCEPTED -> BROKEN');
    exception when unique_violation then
      insert into probe values ('duplicate', 'refused');
    end;
    $$;
    insert into probe select 'existing_format', count(*)::text || ' of ' || (select count(*)::text from public.orders) from public.orders where reference ~ '^[0-9]{8}$';
    insert into probe select 'previous_kept', count(*)::text from public.orders where previous_reference is not null;
    select what, value from probe order by what;
    rollback;`)
  const r = Object.fromEntries(rows.map((x) => [x.what, x.value]))
  check('a duplicate order ID', r.duplicate, 'refused')
  ok(`the orders in the shop: ${r.existing_format} carry the new format`)
  ok(`the orders that had an old ID keep it: ${r.previous_kept}`)
}

console.log('\n5b. A hundredth order in one day is refused')
{
  const rows = await query(`
    begin;
    create temporary table probe (what text primary key, value text);
    do $$
    declare i integer;
    begin
      for i in 1 .. 100 loop
        begin
          insert into public.orders (reference, full_name, email, phone, address, city, state, pincode, subtotal, shipping, discount, total, created_at)
          values (null, 'Limit probe ' || i, 'limit-' || i || '@example.invalid', '9000000' || lpad(i::text, 3, '0'),
                  'Limit Street', 'Pune', 'MH', '411001', 100, 0, 0, 100, '2026-04-02 10:00:00+00'::timestamptz);
        exception when others then
          insert into probe values ('the_100th', 'refused: ' || sqlerrm);
          return;
        end;
      end loop;
      insert into probe values ('the_100th', 'ACCEPTED -> BROKEN');
    end;
    $$;
    insert into probe select 'the_99th', reference from public.orders where email = 'limit-99@example.invalid';
    select what, value from probe order by what;
    rollback;`)
  const r = Object.fromEntries(rows.map((x) => [x.what, x.value]))
  check('the 99th order of the day', r.the_99th, '02042699')
  if (String(r.the_100th).startsWith('refused')) ok(`the 100th order was refused: ${r.the_100th}`)
  else bad(`the 100th order was ${r.the_100th}`)
}

// ---------------------------------------------------------------------------
console.log('\n6. The orders that already exist, and where the ID shows')
{
  const rows = await query(`select
      count(*)::int as orders,
      count(*) filter (where reference ~ '^[0-9]{8}$')::int as in_the_new_format,
      count(*) filter (where previous_reference is not null)::int as old_ids_kept,
      count(distinct reference)::int as distinct_ids,
      min(reference) as first_id,
      max(reference) as last_id
    from public.orders`)
  const r = rows[0]
  ok(`${r.orders} orders, ${r.in_the_new_format} in the new format, ${r.old_ids_kept} keeping their old ID`)
  check('every order ID is different', String(r.distinct_ids), String(r.orders))
  ok(`the IDs run from ${r.first_id} to ${r.last_id}`)
  const sample = await query(`select previous_reference || ' -> ' || reference as both
    from public.orders where previous_reference is not null order by created_at limit 3`)
  for (const s of sample) ok(`  ${s.both}`)
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nThe order ID system behaves as specified.')
process.exit(failures ? 1 : 0)
