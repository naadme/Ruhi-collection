-- Ruhi Collection — anyone may write a review; the owner decides what is
-- published and which reviews carry "Verified purchase".
--
-- Until now a review could only be written from a signed-in account, against
-- an order line that account owned, and "Verified purchase" was shown on every
-- such review automatically. Most of this shop's orders are guest checkouts,
-- so almost nobody could write one. The owner wants it the other way round:
--
--   * ANYONE can write a review from the product page — no account, no
--     purchase check. It always lands as `pending` and appears nowhere until
--     the owner approves it, exactly as before.
--   * "Verified purchase" becomes the owner's own decision, per review, after
--     she has checked it against her orders. It is a column (`verified`) that
--     only an admin can change, and the product page shows the label only
--     when it is true.
--
-- What this migration does:
--
--   1. `product_reviews.order_item_id` and `user_id` become nullable, so a
--      review written from the website form needs neither. The unique key on
--      `order_item_id` and both foreign keys stay: an account review is still
--      one review per purchase. A CHECK keeps that meaning — only a `public`
--      review may be missing them.
--   2. New columns: `verified`, `verified_at`, `verified_by`, and `source`
--      ('account' for the signed-in path, 'public' for the website form).
--      The few account reviews that may already exist keep today's meaning:
--      they were written against an order line, so they start verified.
--   3. A new PRIVATE table, `public.product_review_contacts`, holds the email,
--      mobile number and order number a website reviewer gives so the shop
--      can check her order. It is NOT a column of `product_reviews`, because
--      an approved review row is readable by anyone. Only an admin can read
--      it; nobody can write to it except the function below.
--   4. The signed-out read of approved reviews is narrowed to the columns
--      the product page shows. Before this, anyone with the site's public key
--      could also read `user_id`, `order_item_id` and `decided_by` of an
--      approved review. This is only half a fix: any signed-in account can
--      still read those ids, and anyone can make an account. Section 3 says
--      why, and what it would take to close it.
--   5. `public.submit_public_review(...)` is the one way a website review is
--      born: open to anyone, with a hidden honeypot field and two limits
--      against floods, and it never sets `verified`.
--
-- A known weakness, left as it is on purpose: the limits in section 5 slow a
-- careless person down, but they do not stop a script. The honeypot only
-- catches bots that fill in the page's form, and a script calling the
-- function directly leaves it empty. The 3-a-day limit is per email or
-- mobile, and a script can make up a new one each time. So a script could
-- fill the 20-review queue of every product. The website form would then
-- tell real customers "This product has many reviews waiting to be checked"
-- until the owner rejects or deletes those reviews in the admin panel. The
-- fix for that is a check a script cannot repeat cheaply, such as a
-- Cloudflare Turnstile challenge or a limit per network address. It is not
-- built here because the brief did not ask for it. If it ever happens, that
-- is the next step.
--
-- What does NOT change: `submit_review()` and `reviewable_items()` (the
-- signed-in path on the homepage and the order page) are untouched. A new
-- account review now starts with `verified = false` through the column
-- default, so the owner is the one who verifies it — the order line it was
-- written against is shown to her in the admin as the evidence. There is
-- still no INSERT policy and no INSERT grant on `product_reviews` for any
-- browser role. The approve / reject / delete policies are untouched, and no
-- product, order or payment table is touched. The admin already reads
-- `orders` and `order_items` through their existing `is_admin()` policies,
-- which is all the evidence panel needs, so nothing new is opened there.

begin;

-- ---------------------------------------------------------------------------
-- 1. A review no longer needs an order line or an account
-- ---------------------------------------------------------------------------
alter table public.product_reviews
  alter column order_item_id drop not null,
  alter column user_id       drop not null;

-- ---------------------------------------------------------------------------
-- 2. Where it came from, and the owner's own "Verified purchase"
-- ---------------------------------------------------------------------------
alter table public.product_reviews
  add column if not exists verified    boolean not null default false,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid,
  add column if not exists source      text not null default 'account';

alter table public.product_reviews
  drop constraint if exists product_reviews_source_known;
alter table public.product_reviews
  add constraint product_reviews_source_known
  check (source in ('account', 'public'));

-- An account review is still tied to the purchase and the account that wrote
-- it; only a website review may arrive without them.
alter table public.product_reviews
  drop constraint if exists product_reviews_account_has_purchase;
alter table public.product_reviews
  add constraint product_reviews_account_has_purchase
  check (source = 'public' or (order_item_id is not null and user_id is not null));

-- Reviews written before today were written against an order line, which is
-- what "Verified purchase" meant until now. They keep the label.
update public.product_reviews
   set verified = true
 where order_item_id is not null
   and verified = false;

comment on column public.product_reviews.verified is
  'Shows "Verified purchase" on the product page. Set only by an admin, after checking the order.';
comment on column public.product_reviews.source is
  'account = written from a signed-in account against an order line; public = written from the website form.';

-- ---------------------------------------------------------------------------
-- 3. The public read: only the columns the product page shows
--
--    Column privileges are per ROLE, not per policy. The owner's admin
--    account and every signed-in customer share the `authenticated` role, and
--    the admin panel needs the full row (user_id and order_item_id are part of
--    the evidence she checks), so `authenticated` keeps its table-wide SELECT.
--    Only `anon`, a visitor who is not signed in, is narrowed to the
--    published columns.
--
--    That does NOT keep the ids private. Sign-up is open and needs no email
--    confirmation (supabase/config.toml), so anyone can make an account in
--    seconds and then read every column of an APPROVED review: `user_id`,
--    `order_item_id`, `source`, `decided_at`, `verified_at`, and `decided_by`
--    and `verified_by`, which are the owner's own account id. These are
--    opaque ids and times. No email, phone or order number is among them:
--    those are in section 4's table, which only an admin can read.
--    Closing this fully would mean narrowing `authenticated` the same way
--    and serving the admin's full rows through an admin-only function. That
--    is a larger change to the admin panel's reads and is left for later.
--
--    The product page reads exactly these columns (src/lib/reviewStore.js,
--    fetchPublishedReviews), so nothing on the site changes.
-- ---------------------------------------------------------------------------
revoke select on table public.product_reviews from anon;
grant  select (id, product_id, rating, title, body, customer_name, status, created_at, verified)
  on table public.product_reviews to anon;

-- ---------------------------------------------------------------------------
-- 4. The website reviewer's private details
--
--    One row per website review, removed with it. RLS is on, there is no
--    policy for anon and no write policy for anyone: the function below,
--    running as the table's owner, is the only way a row is written, and an
--    admin is the only one who can read it.
-- ---------------------------------------------------------------------------
create table if not exists public.product_review_contacts (
  review_id  uuid primary key
             references public.product_reviews (id) on delete cascade,
  email      text,
  phone      text,
  order_ref  text,
  created_at timestamptz not null default now()
);

comment on table public.product_review_contacts is
  'Private: how to reach a website reviewer, so the shop can check her order. Admin-only, never shown on the site.';

alter table public.product_review_contacts enable row level security;

revoke all on table public.product_review_contacts from anon, authenticated;
grant  select on table public.product_review_contacts to authenticated;
grant  all on table public.product_review_contacts to service_role;

drop policy if exists "admins read review contacts" on public.product_review_contacts;
create policy "admins read review contacts"
  on public.product_review_contacts for select
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 5. The one way in from the website form: submit_public_review()
--
--    Open to anyone, so everything a stranger could abuse is decided here:
--      * a hidden field (`p_website`) that a person never sees and a bot
--        fills in — when it has a value, the answer looks like success and
--        nothing is stored;
--      * the product must exist and be on sale;
--      * the same limits, in the same words, as submit_review();
--      * an email or a 10-digit Indian mobile is required, kept only in the
--        private table, so the shop can check the order;
--      * at most 3 reviews per email or mobile in 24 hours, and at most 20
--        website reviews waiting on one product, so nobody can bury the
--        queue. Both are counted under one lock, so two reviews sent at the
--        same moment cannot both slip under a limit. (See the note at the top
--        of this file for what these limits do not stop.)
--
--    It always lands as `pending`, `source = 'public'`, `verified = false`,
--    with no order line. `user_id` is the signed-in account if there is one
--    (so she sees it under her account), and null otherwise.
-- ---------------------------------------------------------------------------
create or replace function public.submit_public_review(
  p_product_id text,
  p_rating     integer,
  p_title      text,
  p_name       text,
  p_body       text,
  p_email      text,
  p_phone      text,
  p_order_ref  text,
  p_website    text
) returns json
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_body   text := btrim(coalesce(p_body, ''));
  v_name   text := btrim(coalesce(p_name, ''));
  v_title  text := btrim(coalesce(p_title, ''));
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_phone  text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_ref    text := btrim(coalesce(p_order_ref, ''));
  v_recent integer;
  v_queued integer;
  v_id     uuid;
begin
  -- The honeypot. A success-shaped answer, so a bot learns nothing.
  if btrim(coalesce(p_website, '')) <> '' then
    return json_build_object('id', gen_random_uuid(), 'status', 'pending');
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = p_product_id and p.is_active = true
  ) then
    raise exception 'This product is not available for reviews.';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Choose a rating between 1 and 5 stars.';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'The name you show must be between 2 and 60 characters.';
  end if;

  if char_length(v_title) > 120 then
    raise exception 'The title can be up to 120 characters.';
  end if;

  if char_length(v_body) < 10 then
    raise exception 'A review needs at least a few words (10 characters).';
  end if;

  if char_length(v_body) > 2000 then
    raise exception 'A review can be up to 2000 characters.';
  end if;

  -- A mobile typed as +91 98765 43210, 098765 43210 or 9876543210 is the
  -- same number, stored as its 10 digits.
  if char_length(v_phone) = 12 and left(v_phone, 2) = '91' then
    v_phone := right(v_phone, 10);
  elsif char_length(v_phone) = 11 and left(v_phone, 1) = '0' then
    v_phone := right(v_phone, 10);
  end if;

  if v_email = '' and v_phone = '' then
    raise exception 'Give your email or mobile number so the shop can check your order.';
  end if;

  if v_email <> '' and (v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
                        or char_length(v_email) > 200) then
    raise exception 'That email address does not look right.';
  end if;

  if v_phone <> '' and v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'Enter a 10-digit Indian mobile number.';
  end if;

  if char_length(v_ref) > 40 then
    raise exception 'The order number can be up to 40 characters.';
  end if;

  -- One website review is counted and written at a time. Without this, two
  -- sent at the same moment would both count the same total and both pass.
  -- The lock is released when this transaction ends; at this shop's volume
  -- nobody waits for it.
  perform pg_advisory_xact_lock(hashtext('submit_public_review'));

  select count(*) into v_recent
  from public.product_review_contacts c
  where c.created_at > now() - interval '24 hours'
    and ((v_email <> '' and c.email = v_email)
      or (v_phone <> '' and c.phone = v_phone));

  if v_recent >= 3 then
    raise exception 'You have sent several reviews today. Please try again tomorrow.';
  end if;

  select count(*) into v_queued
  from public.product_reviews r
  where r.product_id = p_product_id
    and r.source = 'public'
    and r.status = 'pending';

  if v_queued >= 20 then
    raise exception 'This product has many reviews waiting to be checked. Please try again in a few days.';
  end if;

  insert into public.product_reviews
    (product_id, order_item_id, user_id, rating, body, customer_name, title,
     status, source, verified)
  values
    (p_product_id, null, v_uid, p_rating, v_body, v_name, nullif(v_title, ''),
     'pending', 'public', false)
  returning id into v_id;

  insert into public.product_review_contacts (review_id, email, phone, order_ref)
  values (v_id, nullif(v_email, ''), nullif(v_phone, ''), nullif(v_ref, ''));

  return json_build_object('id', v_id, 'status', 'pending');
end;
$$;

revoke all on function public.submit_public_review(text, integer, text, text, text, text, text, text, text)
  from public;
grant  execute on function public.submit_public_review(text, integer, text, text, text, text, text, text, text)
  to anon, authenticated, service_role;

commit;

-- ---------------------------------------------------------------------------
-- To revert (only once no website review is stored — the NOT NULLs below
-- would refuse them):
--
--   begin;
--   drop function if exists public.submit_public_review(text, integer, text, text, text, text, text, text, text);
--   drop table if exists public.product_review_contacts;
--   revoke select on table public.product_reviews from anon;
--   grant  select on table public.product_reviews to anon;
--   alter table public.product_reviews
--     drop constraint if exists product_reviews_account_has_purchase,
--     drop constraint if exists product_reviews_source_known,
--     drop column if exists source,
--     drop column if exists verified_by,
--     drop column if exists verified_at,
--     drop column if exists verified;
--   alter table public.product_reviews
--     alter column order_item_id set not null,
--     alter column user_id       set not null;
--   commit;
