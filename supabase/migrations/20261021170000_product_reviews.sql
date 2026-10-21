-- Ruhi Collection — customer reviews, with moderation in the admin panel.
--
-- The shop had ratings typed in by hand in the product editor and nowhere for
-- a customer to say anything. This is the missing half: a review is written by
-- the account that BOUGHT the item, it sits hidden until the owner approves
-- it, and every rule about who may write one and who may publish one lives
-- here in the database — the browser is never asked and never trusted.
--
-- The shape:
--
--   * `public.product_reviews` holds one row per review, keyed to the exact
--     ORDER LINE that was bought (`order_item_id`, unique): one purchase, one
--     review. The product comes off the order line itself, so a review can
--     never be pointed at a product its author did not receive.
--   * Written only through `public.submit_review(...)`, a SECURITY DEFINER
--     function that checks the caller owns the order. There is NO insert
--     policy for the browser: RLS denies it, the grants revoke it, and the
--     function is the only door in.
--   * Read by anyone ONLY when `status = 'approved'`; the author sees her own
--     unapproved review; the admin sees and decides on all of them.
--   * `status` starts at `pending` and only an admin may move it. Approve,
--     reject and un-publish are the same one UPDATE, so a review can be taken
--     back off the site as easily as it was put on.
--
-- Signed-in accounts only, on purpose: most of this shop's orders are guest
-- checkouts (`orders.user_id` is null) and an email typed into a box proves
-- nothing — anyone could claim anyone's. An account owns its own orders, so
-- that is what ownership is measured against. A guest who wants to leave a
-- review can sign in and the order will be waiting for her.
--
-- No product, price, order or rating column of `public.products` is touched
-- by this migration.

begin;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists public.product_reviews (
  id            uuid primary key default gen_random_uuid(),

  -- The exact catalogue row that was bought — one row per colour, so this
  -- review belongs to the colour the customer actually received.
  product_id    text not null
                references public.products (id) on delete cascade,

  -- One purchase, one review: the line is the primary guard, so the same
  -- parcel cannot be used to fill a product with praise.
  order_item_id uuid not null unique
                references public.order_items (id) on delete cascade,

  -- The account that wrote it. Set by the function from auth.uid(), never
  -- from the request, and never editable afterwards.
  user_id       uuid not null,

  rating        integer not null,
  body          text not null,
  customer_name text not null,

  status        text not null default 'pending',

  created_at    timestamptz not null default now(),
  -- When and by whom it was decided, so the admin's history survives a
  -- second look. Null until an admin touches it.
  decided_at    timestamptz,
  decided_by    uuid,

  constraint product_reviews_rating_range check (rating >= 1 and rating <= 5),
  -- Whitespace-only is not a review, and neither is a novel.
  constraint product_reviews_body_length check (char_length(btrim(body)) >= 10
                                               and char_length(btrim(body)) <= 2000),
  constraint product_reviews_name_length check (char_length(btrim(customer_name)) >= 2
                                               and char_length(btrim(customer_name)) <= 60),
  constraint product_reviews_status_known check (status in ('pending', 'approved', 'rejected'))
);

comment on column public.product_reviews.order_item_id is
  'The order line this review was written for. Unique: one review per purchase.';
comment on column public.product_reviews.product_id is
  'Copied from the order line by submit_review(), so a review can only ever name a product that was bought.';
comment on column public.product_reviews.status is
  'pending (default) → approved (shown on the product page) or rejected (withheld). Admin-only.';

-- The storefront reads a design's published reviews across all of its colours
-- at once, newest first.
create index if not exists product_reviews_published_idx
  on public.product_reviews (product_id, created_at desc)
  where status = 'approved';

create index if not exists product_reviews_status_idx
  on public.product_reviews (status, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Grants — nobody writes from a browser except through the function
-- ---------------------------------------------------------------------------
alter table public.product_reviews enable row level security;

revoke all on table public.product_reviews from anon;
grant  select on table public.product_reviews to anon;

revoke all on table public.product_reviews from authenticated;
grant  select, update on table public.product_reviews to authenticated;

grant all on table public.product_reviews to service_role;

-- ---------------------------------------------------------------------------
-- 3. Policies — OR'd together, and no INSERT policy at all
--
--    The missing INSERT policy is the point: with RLS on and no policy
--    allowing it, a browser cannot insert a row however it asks. Only the
--    SECURITY DEFINER function below (running as the table's owner) can.
-- ---------------------------------------------------------------------------
drop policy if exists "published reviews are public" on public.product_reviews;
create policy "published reviews are public"
  on public.product_reviews for select
  to anon, authenticated
  using (status = 'approved');

drop policy if exists "a customer reads her own review" on public.product_reviews;
create policy "a customer reads her own review"
  on public.product_reviews for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "admins read every review" on public.product_reviews;
create policy "admins read every review"
  on public.product_reviews for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins move reviews between states" on public.product_reviews;
create policy "admins move reviews between states"
  on public.product_reviews for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. Which of this customer's purchases still owe a review
--
--    The storefront must not show a write box to someone who has not bought
--    the product, nor a second box to someone who has already used theirs.
--    Both facts are read here, from the orders the account owns, so the page
--    only has to ask once.
--
--    The whole DESIGN is passed at once (every colour row): a customer who
--    bought this design in three colours sees the three purchases she has not
--    yet reviewed, not one call per colour.
-- ---------------------------------------------------------------------------
create or replace function public.reviewable_items(p_product_ids text[])
returns table (order_item_id uuid, product_id text, title text, size text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select oi.id, oi.product_id, oi.title, oi.size
  from public.order_items oi
  join public.orders o      on o.id = oi.order_id
  left join public.product_reviews r on r.order_item_id = oi.id
  where (select auth.uid()) is not null
    and o.user_id = (select auth.uid())
    and o.status <> 'cancelled'
    and oi.product_id = any (p_product_ids)
    and r.id is null                -- already reviewed → nothing left to write
  order by oi.created_at desc, oi.id;
$$;

revoke all on function public.reviewable_items(text[]) from public, anon;
grant  execute on function public.reviewable_items(text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The one way in: submit_review()
--
--    Everything the request is not allowed to decide is decided here:
--      * WHO — the signed-in account must own the order the line belongs to,
--        so nobody can post as another customer;
--      * WHAT PRODUCT — read off the order line, never from the request;
--      * WHETHER — the order must still be a real, uncancelled order;
--      * ONCE — the unique key on the line answers a second attempt with a
--        clear error rather than a duplicate row.
--
--    It always lands as `pending`: a review is never public the moment it is
--    written.
-- ---------------------------------------------------------------------------
create or replace function public.submit_review(
  p_order_item_id uuid,
  p_rating        integer,
  p_body          text,
  p_name          text
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_item     public.order_items%rowtype;
  v_body     text := btrim(coalesce(p_body, ''));
  v_name     text := btrim(coalesce(p_name, ''));
  v_id       uuid;
begin
  if v_uid is null then
    raise exception 'You need to sign in to write a review.'
      using errcode = '28000';   -- not_authenticated
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Choose a rating between 1 and 5 stars.'
      using errcode = '22023';   -- invalid_parameter_value
  end if;

  if char_length(v_body) < 10 then
    raise exception 'A review needs at least a few words (10 characters).'
      using errcode = '22023';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'The name you show must be between 2 and 60 characters.'
      using errcode = '22023';
  end if;

  -- The line must belong to an order this account placed, and that order must
  -- not have been cancelled. The product is read from the line itself.
  select * into v_item
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = p_order_item_id
    and o.user_id = v_uid
    and o.status <> 'cancelled'
  for update of oi;

  if not found then
    raise exception 'That purchase is not on your account, so it cannot be reviewed.'
      using errcode = '42501';   -- insufficient_privilege
  end if;

  begin
    insert into public.product_reviews
      (product_id, order_item_id, user_id, rating, body, customer_name)
    values
      (v_item.product_id, v_item.id, v_uid, p_rating, v_body, v_name)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This purchase has already been reviewed.'
      using errcode = '23505';   -- unique_violation
  end;

  return v_id;
end;
$$;

revoke all on function public.submit_review(uuid, integer, text, text)
  from public, anon;
grant  execute on function public.submit_review(uuid, integer, text, text)
  to authenticated, service_role;

commit;

-- ---------------------------------------------------------------------------
-- 6. Record it in the platform's ledger, the way this project has been
--    applying its migrations (Management API, not the CLI).
-- ---------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261021170000', 'product_reviews', '{}')
on conflict (version) do nothing;
