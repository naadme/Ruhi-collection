-- Ruhi Collection — an optional review headline, and permanent admin deletion.
--
-- 1. A nullable `title` column on `public.product_reviews`, so a customer may
--    give her review a headline. Optional: reviews written before this
--    migration keep NULL, and nothing about them changes.
-- 2. Permanent deletion of a review, but only by an admin. `delete` is granted
--    to the authenticated role and gated by an `is_admin()` RLS policy — the
--    same shape the existing approve/reject update policy uses. A customer,
--    signed in or not, can never delete a review, and no non-admin can.
--
-- No product, order, rating or status column is rewritten, and no existing
-- row is touched: every current review keeps exactly the values it has.

begin;

alter table public.product_reviews
  add column if not exists title text;

alter table public.product_reviews
  drop constraint if exists product_reviews_title_length;
alter table public.product_reviews
  add constraint product_reviews_title_length
  check (title is null or char_length(btrim(title)) <= 120);

-- The one way a review is born now also takes the optional headline.
create or replace function public.submit_review(
  p_order_item_id uuid,
  p_rating        integer,
  p_body          text,
  p_name          text,
  p_title         text
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
  v_title    text := btrim(coalesce(p_title, ''));
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

  if char_length(v_title) > 120 then
    raise exception 'The title can be up to 120 characters.'
      using errcode = '22023';
  end if;

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
      (product_id, order_item_id, user_id, rating, body, customer_name, title)
    values
      (v_item.product_id, v_item.id, v_uid, p_rating, v_body, v_name, v_title)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This purchase has already been reviewed.'
      using errcode = '23505';   -- unique_violation
  end;

  return v_id;
end;
$$;

revoke all on function public.submit_review(uuid, integer, text, text, text)
  from public, anon;
grant  execute on function public.submit_review(uuid, integer, text, text, text)
  to authenticated, service_role;

-- Permanent deletion, admin only.
grant delete on table public.product_reviews to authenticated;

drop policy if exists "admins remove reviews" on public.product_reviews;
create policy "admins remove reviews"
  on public.product_reviews for delete
  to authenticated
  using (public.is_admin());

commit;

-- ---------------------------------------------------------------------------
-- Record it in the platform's ledger, the way this project has been applying
-- its migrations (Management API, not the CLI).
-- ---------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261026120000', 'review_title_and_delete', '{}')
on conflict (version) do nothing;
