-- Ruhi Collection — reviews customers sent on WhatsApp, Instagram, by phone or
-- in the shop, uploaded by the owner from a sheet.
--
-- Past customers send their reviews to the shop directly, not through the
-- website form. The owner collects them in a sheet (one row per review) and
-- uploads it from Admin → Reviews. Nothing about how a review reaches the
-- product page changes:
--
--   * every uploaded review lands as `pending` and `verified = false`, exactly
--     like a website review, and appears nowhere until the owner approves it;
--   * "Verified purchase" is still her own decision, per review, after she has
--     checked her sales records;
--   * the customer's mobile, order number, how the review reached the shop
--     ("received via") and her own note go to the PRIVATE contacts table,
--     never onto the review.
--
-- What this migration does:
--
--   1. Three new public columns on `product_reviews`, shown with the review:
--      `reviewer_city`, `reviewer_state` and `size_bought`. Any review may
--      carry them; the website form simply does not ask for them yet.
--   2. A new `source`, 'imported', for a review uploaded from a sheet. Like a
--      website review it needs no order line and no account.
--   3. `customer_name` may be empty, for an uploaded review only. Customers
--      who have not agreed to their name being shown are uploaded without
--      one, and the product page shows a label in its place: "Verified Buyer"
--      once the owner has marked it verified, otherwise "Shopper from <city>"
--      (or "Ruhi Shopper" with no city). The label is worked out when the page
--      is drawn, never stored, so marking the review verified later changes
--      it by itself. Website and account reviews still need a name.
--   4. The private contacts table gains `channel` (how the review reached the
--      shop), `note` (the owner's own note) and `import_batch` (which upload
--      it came in, so a whole upload can be taken back while it is pending).
--   5. A signed-out visitor may read the three new public columns.
--   6. `public.import_reviews(rows)` — the one way an uploaded review is born.
--      Admin-only, all-or-nothing: if any row is refused, nothing from the
--      upload is stored, and the error names the row.
--
-- The date shown on an uploaded review is the day the customer sent it, when
-- the sheet gives one (`created_at`, as for every review, is "when it was
-- written"), else the moment of upload. The contact row's `created_at` is
-- always the moment of upload, so the panel can say when it was uploaded.
--
-- A known edge, left as it is: the website form's limit of 3 reviews a day
-- per mobile counts contact rows from the last 24 hours, and uploaded rows
-- are contact rows. A customer with 3 or more reviews in one upload could not
-- also use the website form for the next 24 hours. At this shop's volume that
-- is not worth changing `submit_public_review()` for.
--
-- What does NOT change: `submit_review()`, `submit_public_review()`,
-- `reviewable_items()`, the approve / reject / delete / verify policies, and
-- every product, order and payment table. There is still no INSERT policy or
-- INSERT grant on `product_reviews` or `product_review_contacts` for any
-- browser role.

begin;

-- ---------------------------------------------------------------------------
-- 1. Where the reviewer lives and the size she bought
-- ---------------------------------------------------------------------------
alter table public.product_reviews
  add column if not exists reviewer_city  text,
  add column if not exists reviewer_state text,
  add column if not exists size_bought    text;

alter table public.product_reviews
  drop constraint if exists product_reviews_city_length,
  drop constraint if exists product_reviews_state_length,
  drop constraint if exists product_reviews_size_length;
alter table public.product_reviews
  add constraint product_reviews_city_length
    check (reviewer_city is null or char_length(btrim(reviewer_city)) between 1 and 60),
  add constraint product_reviews_state_length
    check (reviewer_state is null or char_length(btrim(reviewer_state)) between 1 and 60),
  add constraint product_reviews_size_length
    check (size_bought is null or char_length(btrim(size_bought)) between 1 and 20);

comment on column public.product_reviews.reviewer_city is
  'Shown with the review, e.g. "Hyderabad". Optional.';
comment on column public.product_reviews.reviewer_state is
  'Shown with the review, e.g. "Telangana". Optional.';
comment on column public.product_reviews.size_bought is
  'The size the reviewer bought, shown with the review. Optional. The colour is the product row''s own.';

-- ---------------------------------------------------------------------------
-- 2. A third source: uploaded from a sheet
-- ---------------------------------------------------------------------------
alter table public.product_reviews
  drop constraint if exists product_reviews_source_known;
alter table public.product_reviews
  add constraint product_reviews_source_known
  check (source in ('account', 'public', 'imported'));

alter table public.product_reviews
  drop constraint if exists product_reviews_account_has_purchase;
alter table public.product_reviews
  add constraint product_reviews_account_has_purchase
  check (source in ('public', 'imported') or (order_item_id is not null and user_id is not null));

comment on column public.product_reviews.source is
  'account = written from a signed-in account against an order line; public = written from the website form; imported = uploaded by the owner from a sheet.';

-- ---------------------------------------------------------------------------
-- 3. An uploaded review may have no name
-- ---------------------------------------------------------------------------
alter table public.product_reviews
  alter column customer_name drop not null;

alter table public.product_reviews
  drop constraint if exists product_reviews_name_length;
alter table public.product_reviews
  add constraint product_reviews_name_length
  check (customer_name is null
         or (char_length(btrim(customer_name)) >= 2 and char_length(btrim(customer_name)) <= 60));

alter table public.product_reviews
  drop constraint if exists product_reviews_name_required;
alter table public.product_reviews
  add constraint product_reviews_name_required
  check (customer_name is not null or source = 'imported');

comment on column public.product_reviews.customer_name is
  'The name shown with the review. Empty only for an uploaded review whose customer did not agree to her name being shown; the page then shows "Verified Buyer" (once verified) or "Shopper from <city>".';

-- ---------------------------------------------------------------------------
-- 4. The owner's private record of an uploaded review
-- ---------------------------------------------------------------------------
alter table public.product_review_contacts
  add column if not exists channel      text,
  add column if not exists note         text,
  add column if not exists import_batch uuid;

alter table public.product_review_contacts
  drop constraint if exists product_review_contacts_channel_known,
  drop constraint if exists product_review_contacts_note_length;
alter table public.product_review_contacts
  add constraint product_review_contacts_channel_known
    check (channel is null or channel in ('whatsapp', 'instagram', 'phone', 'in_store', 'email', 'other')),
  add constraint product_review_contacts_note_length
    check (note is null or char_length(note) <= 500);

create index if not exists product_review_contacts_import_batch_idx
  on public.product_review_contacts (import_batch)
  where import_batch is not null;

comment on column public.product_review_contacts.channel is
  'How an uploaded review reached the shop: whatsapp, instagram, phone, in_store, email or other. Private.';
comment on column public.product_review_contacts.note is
  'The owner''s own note about an uploaded review. Private.';
comment on column public.product_review_contacts.import_batch is
  'Which sheet upload the review came in, so a whole upload can be taken back while it is pending.';

-- ---------------------------------------------------------------------------
-- 5. The public read: the three new columns the product page shows
--
--    Column grants add up, so this grants only the new ones; the columns
--    granted in 20261106120000_open_reviews.sql stay as they are.
-- ---------------------------------------------------------------------------
grant select (reviewer_city, reviewer_state, size_bought)
  on table public.product_reviews to anon;

-- ---------------------------------------------------------------------------
-- 6. The one way in from a sheet: import_reviews()
--
--    `p_rows` is a JSON array, one object per review:
--
--      row         the sheet's row number, used only in error messages
--      product_id  the colour row (products.id); must exist
--      rating      1–5
--      body        10–2000 characters
--      title       optional, up to 120
--      name        optional, 2–60 when given
--      city        optional, up to 60
--      state       optional, up to 60
--      size        optional, up to 20
--      written_on  optional 'YYYY-MM-DD', not after today in India
--      phone       optional, 8–15 digits (an Indian mobile as its 10 digits)
--      order_ref   optional, up to 40
--      channel     optional, one of the known channels
--      note        optional, up to 500
--
--    Admin-only. All-or-nothing: the first refused row stops the whole upload
--    and nothing is stored. Every review lands pending, imported, unverified,
--    with no order line and no account.
-- ---------------------------------------------------------------------------
create or replace function public.import_reviews(p_rows jsonb)
returns json
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch   uuid := gen_random_uuid();
  v_count   integer := 0;
  v_item    jsonb;
  v_n       bigint;
  v_label   text;
  v_product text;
  v_rating  integer;
  v_body    text;
  v_title   text;
  v_name    text;
  v_city    text;
  v_state   text;
  v_size    text;
  v_date    date;
  v_when    timestamptz;
  v_phone   text;
  v_ref     text;
  v_channel text;
  v_note    text;
  v_id      uuid;
begin
  if not public.is_admin() then
    raise exception 'Only the shop''s admin account can upload reviews.'
      using errcode = '42501';   -- insufficient_privilege
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The upload has no reviews in it.';
  end if;

  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Upload at most 500 reviews at a time.';
  end if;

  for v_item, v_n in
    select value, ordinality from jsonb_array_elements(p_rows) with ordinality
  loop
    v_label   := 'Row ' || coalesce(nullif(btrim(v_item->>'row'), ''), v_n::text) || ': ';
    v_product := btrim(coalesce(v_item->>'product_id', ''));
    v_body    := btrim(replace(coalesce(v_item->>'body', ''), E'\r\n', E'\n'));
    v_title   := nullif(btrim(coalesce(v_item->>'title', '')), '');
    v_name    := nullif(btrim(coalesce(v_item->>'name', '')), '');
    v_city    := nullif(btrim(coalesce(v_item->>'city', '')), '');
    v_state   := nullif(btrim(coalesce(v_item->>'state', '')), '');
    v_size    := nullif(btrim(coalesce(v_item->>'size', '')), '');
    v_ref     := nullif(btrim(coalesce(v_item->>'order_ref', '')), '');
    v_channel := nullif(btrim(coalesce(v_item->>'channel', '')), '');
    v_note    := nullif(btrim(coalesce(v_item->>'note', '')), '');
    v_phone   := regexp_replace(coalesce(v_item->>'phone', ''), '[^0-9]', '', 'g');

    if not exists (select 1 from public.products p where p.id = v_product) then
      raise exception '%This product is not in the catalogue.', v_label;
    end if;

    begin
      v_rating := (v_item->>'rating')::integer;
    exception when others then
      v_rating := null;
    end;
    if v_rating is null or v_rating < 1 or v_rating > 5 then
      raise exception '%Give a star rating from 1 to 5.', v_label;
    end if;

    if char_length(v_body) < 10 then
      raise exception '%A review needs at least 10 characters.', v_label;
    end if;
    if char_length(v_body) > 2000 then
      raise exception '%A review can be up to 2000 characters.', v_label;
    end if;

    if v_title is not null and char_length(v_title) > 120 then
      raise exception '%The title can be up to 120 characters.', v_label;
    end if;

    if v_name is not null and (char_length(v_name) < 2 or char_length(v_name) > 60) then
      raise exception '%The name must be between 2 and 60 characters.', v_label;
    end if;

    if v_city is not null and char_length(v_city) > 60 then
      raise exception '%The city can be up to 60 characters.', v_label;
    end if;
    if v_state is not null and char_length(v_state) > 60 then
      raise exception '%The state can be up to 60 characters.', v_label;
    end if;
    if v_size is not null and char_length(v_size) > 20 then
      raise exception '%The size can be up to 20 characters.', v_label;
    end if;

    -- An Indian mobile written as +91 98765 43210 or 098765 43210 is the same
    -- number as 9876543210, and is stored as those 10 digits, the way the
    -- website form stores it, so the panel can match it to orders.
    if char_length(v_phone) = 12 and left(v_phone, 2) = '91' then
      v_phone := right(v_phone, 10);
    elsif char_length(v_phone) = 11 and left(v_phone, 1) = '0' then
      v_phone := right(v_phone, 10);
    end if;
    if v_phone <> '' and (char_length(v_phone) < 8 or char_length(v_phone) > 15) then
      raise exception '%That mobile number does not look right.', v_label;
    end if;

    if v_ref is not null and char_length(v_ref) > 40 then
      raise exception '%The order number can be up to 40 characters.', v_label;
    end if;

    if v_channel is not null
       and v_channel not in ('whatsapp', 'instagram', 'phone', 'in_store', 'email', 'other') then
      raise exception '%"Received via" must be WhatsApp, Instagram, Phone call, In store, Email or Other.', v_label;
    end if;

    if v_note is not null and char_length(v_note) > 500 then
      raise exception '%The note can be up to 500 characters.', v_label;
    end if;

    v_date := null;
    if nullif(btrim(coalesce(v_item->>'written_on', '')), '') is not null then
      begin
        v_date := (v_item->>'written_on')::date;
      exception when others then
        raise exception '%The date received is not a date.', v_label;
      end;
      if v_date > (now() at time zone 'Asia/Kolkata')::date then
        raise exception '%The date received is in the future.', v_label;
      end if;
    end if;
    -- Midday in India on the day she sent it, so the date reads the same in
    -- every time zone the page might be drawn in.
    v_when := coalesce((v_date + time '12:00') at time zone 'Asia/Kolkata', now());

    insert into public.product_reviews
      (product_id, order_item_id, user_id, rating, body, customer_name, title,
       reviewer_city, reviewer_state, size_bought,
       status, source, verified, created_at)
    values
      (v_product, null, null, v_rating, v_body, v_name, v_title,
       v_city, v_state, v_size,
       'pending', 'imported', false, v_when)
    returning id into v_id;

    insert into public.product_review_contacts
      (review_id, email, phone, order_ref, channel, note, import_batch)
    values
      (v_id, null, nullif(v_phone, ''), v_ref, v_channel, v_note, v_batch);

    v_count := v_count + 1;
  end loop;

  return json_build_object('batch', v_batch, 'count', v_count);
end;
$$;

revoke all on function public.import_reviews(jsonb) from public, anon;
grant  execute on function public.import_reviews(jsonb) to authenticated, service_role;

commit;

-- ---------------------------------------------------------------------------
-- To revert (only once no uploaded review and no nameless review is stored):
--
--   begin;
--   drop function if exists public.import_reviews(jsonb);
--   revoke select (reviewer_city, reviewer_state, size_bought)
--     on table public.product_reviews from anon;
--   drop index if exists public.product_review_contacts_import_batch_idx;
--   alter table public.product_review_contacts
--     drop constraint if exists product_review_contacts_note_length,
--     drop constraint if exists product_review_contacts_channel_known,
--     drop column if exists import_batch,
--     drop column if exists note,
--     drop column if exists channel;
--   alter table public.product_reviews
--     drop constraint if exists product_reviews_name_required,
--     drop constraint if exists product_reviews_name_length;
--   alter table public.product_reviews
--     add constraint product_reviews_name_length
--     check (char_length(btrim(customer_name)) >= 2 and char_length(btrim(customer_name)) <= 60);
--   alter table public.product_reviews alter column customer_name set not null;
--   alter table public.product_reviews
--     drop constraint if exists product_reviews_account_has_purchase,
--     drop constraint if exists product_reviews_source_known;
--   alter table public.product_reviews
--     add constraint product_reviews_source_known check (source in ('account', 'public')),
--     add constraint product_reviews_account_has_purchase
--       check (source = 'public' or (order_item_id is not null and user_id is not null));
--   alter table public.product_reviews
--     drop constraint if exists product_reviews_size_length,
--     drop constraint if exists product_reviews_state_length,
--     drop constraint if exists product_reviews_city_length,
--     drop column if exists size_bought,
--     drop column if exists reviewer_state,
--     drop column if exists reviewer_city;
--   commit;
