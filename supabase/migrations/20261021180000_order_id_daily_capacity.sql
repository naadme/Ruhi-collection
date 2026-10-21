-- Ruhi Collection — a shop day may hold more than 99 orders.
--
-- WHY
-- The Order ID is DDMMYYNN: the day, then the order's number for that day.
-- The number was two digits, so a day could hold 99 orders and the hundredth
-- was REFUSED — the shopper was told to phone the shop instead. That is a
-- ceiling on the FORM, not on the shop: the busiest day this shop has ever
-- had is 13 orders, and a sale, a market or a post that lands well can put
-- more than 99 through the door. An order that is refused is an order that
-- is lost.
--
-- WHAT CHANGES
--   * Orders 01..99 keep exactly the ID they have always had — DDMMYYNN,
--     eight digits. The format a customer reads does not change.
--   * From the hundredth order of a day the number needs a third digit, so
--     the ID is nine digits: DDMMYYNNN. The first six digits still say the
--     day, so 211026100 is the hundredth order of the 21st of October 2026.
--     A nine-digit ID cannot be mistaken for an eight-digit one — they are
--     different lengths — and the day is read from the front either way.
--   * A day can hold 999 orders. Beyond that the order is still refused,
--     with a clear message: 999 orders in one day is a business decision,
--     not a formatting one.
--
-- WHAT DOES NOT CHANGE
--   * No order is renumbered, none is deleted, and no existing ID moves.
--     `previous_reference` keeps the old RCH- number beside it.
--   * The Order ID is still allocated by the database, in the shop's own
--     time zone (Asia/Kolkata), from the order's own created_at — so the ID
--     and the timestamp can never disagree about which day an order is on.
--
-- HOW THE NUMBER IS ALLOCATED
--   * `public.next_order_reference()` takes an advisory lock for that day,
--     so two orders placed at the same moment cannot be given the same
--     number: the second waits for the lock, and reads the day's highest
--     number only AFTER the lock is held.
--   * The number is now read as the WHOLE tail of the ID — 13 from
--     21102613, 100 from 211026100 — so a day that has crossed 99 keeps
--     counting from where it really is, and a day holding both eight- and
--     nine-digit IDs still hands out the number after the highest of them.
--     (The old read took two characters, which would have handed out 11
--     again after a hundred.)
--   * A BEFORE INSERT trigger assigns the number, so no code path can write
--     an order without one.
--   * The unique index on `orders.reference` has the final word.

-- ---------------------------------------------------------------------------
-- 1. The reference may now be eight OR nine digits.
--
--    Only widened, never narrowed: every ID that was legal before is still
--    legal, and the eight-digit IDs already in the table stay untouched.
-- ---------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_reference_chk;
alter table public.orders
  add constraint orders_reference_chk check (reference ~ '^[0-9]{8,9}$');

-- ---------------------------------------------------------------------------
-- 2. The number.
--
--    One number per order, per day, in the shop's time zone. The day's
--    numbers are allocated under an advisory lock, so two orders placed in
--    the same moment are given different numbers; the lock is held until the
--    transaction ends and the highest number already used is read after it
--    is taken, so the second order sees the first one.
-- ---------------------------------------------------------------------------
create or replace function public.next_order_reference(p_at timestamptz default null)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_at   timestamptz := coalesce(p_at, now());
  v_day  text;
  v_next integer;
begin
  -- The business day, in the shop's own time zone.
  v_day := to_char(v_at at time zone 'Asia/Kolkata', 'DDMMYY');

  -- One order at a time for that day.
  perform pg_advisory_xact_lock(hashtext('ruhi.collection.order_reference'), hashtext(v_day));

  -- Read AFTER the lock is held, so a concurrent order's number is already
  -- in the table by the time this one is counted.
  --
  -- The tail is read WHOLE, not two characters: '13' from 21102613, '100'
  -- from 211026100. A day that has passed 99 therefore keeps counting from
  -- where it really is, and a day holding both eight- and nine-digit IDs
  -- still hands out the number after the highest of them.
  select coalesce(max(nullif(substr(reference, 7), '')::integer), 0) + 1
    into v_next
    from public.orders
   where left(reference, 6) = v_day
     and reference ~ '^[0-9]{8,9}$';

  if v_next > 999 then
    raise exception 'We have reached the limit of 999 orders for today. Please call the store so we can take your order.'
      using errcode = 'P0001';
  end if;

  -- 01..99 are the eight digits the shop has always used (DDMMYYNN). From
  -- 100 the number needs a third digit, and the ID is nine long (DDMMYYNNN).
  if v_next < 100 then
    return v_day || lpad(v_next::text, 2, '0');
  end if;
  return v_day || lpad(v_next::text, 3, '0');
end;
$$;

-- The number is for the database's own use: a browser has no business asking
-- it what today's next number would be.
revoke all on function public.next_order_reference(timestamptz) from public, anon, authenticated;
grant execute on function public.next_order_reference(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The trigger that puts the number on an order.
--
--    Unchanged in what it does — a reference that is not a well-formed Order
--    ID is replaced by one the database hands out — except that nine digits
--    are now a well-formed Order ID too, so the hundredth order of a day is
--    not overwritten with a fresh eight-digit number.
-- ---------------------------------------------------------------------------
create or replace function public.assign_order_reference()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if new.reference is null or btrim(new.reference) = '' or new.reference !~ '^[0-9]{8,9}$' then
    new.reference := public.next_order_reference(new.created_at);
  end if;
  return new;
end;
$$;

revoke all on function public.assign_order_reference() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. An index for the day's numbers.
--
--    Finding the day's highest number used to be a scan of the whole table:
--    the old test was a regular expression, which no ordinary index can
--    serve. It is now a plain comparison on the first six characters, which
--    this index can — so the number of a shop with years of orders behind it
--    is found in the same time as a shop with a dozen.
-- ---------------------------------------------------------------------------
create index if not exists orders_reference_day_idx
  on public.orders (left(reference, 6))
  where reference ~ '^[0-9]{8,9}$';

-- ---------------------------------------------------------------------------
-- To revert:
--
--   alter table public.orders drop constraint if exists orders_reference_chk;
--   alter table public.orders
--     add constraint orders_reference_chk check (reference ~ '^[0-9]{8}$');
--   drop index if exists public.orders_reference_day_idx;
--   -- and put the two functions back as they were in
--   -- 20261020190000_order_ids.sql.
--
-- No order is touched by any of that, and no order is touched by this
-- migration either.
