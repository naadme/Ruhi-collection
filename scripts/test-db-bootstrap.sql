-- The scaffolding a Supabase project gives a database, for a plain PostgreSQL.
--
-- The migrations are written against a Supabase project: they grant to the
-- `anon`, `authenticated` and `service_role` roles, they read `auth.uid()`,
-- they write to `storage`, they read the vault, and they keep their ledger in
-- `supabase_migrations`. This file builds the same empty scaffolding on a
-- plain PostgreSQL, so the shop's own migrations can be applied to it
-- UNCHANGED — byte for byte, with no patching — on the isolated database the
-- order ID tests run against.
--
-- Nothing here is part of the shop. It is the empty room the migrations are
-- written for.

-- ---- the roles the migrations grant to ------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- ---- the schemas they reach into ------------------------------------------
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists vault;
create schema if not exists net;
create schema if not exists extensions;
create schema if not exists supabase_migrations;

-- ---- auth: who is asking --------------------------------------------------
create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

-- The signed-in customer, or nobody. On a real project this reads the
-- gateway's claim; here it reads the same setting, which is empty unless a
-- test sets it.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), ''), '')::uuid
$$;

-- ---- storage: the product photographs -------------------------------------
create table if not exists storage.buckets (
  id     text primary key,
  name   text,
  public boolean default false
);

create table if not exists storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text,
  name      text
);

-- ---- vault: the shop's own secrets -----------------------------------------
create table if not exists vault.decrypted_secrets (
  name              text primary key,
  description       text,
  decrypted_secret  text
);

-- ---- net: the queue a background call goes into ---------------------------
-- On a real project this is Supabase's `pg_net`; here it is a stub that only
-- says "queued". The order notifications call it, and they treat a failure as
-- a failure to tell anyone — an order is never held up by a queue.
create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 1000
) returns bigint
language sql volatile
as $$
  select 1::bigint
$$;

-- ---- the migration ledger the later migrations write to --------------------
create table if not exists supabase_migrations.schema_migrations (
  version    text primary key,
  name       text,
  statements text[]
);
