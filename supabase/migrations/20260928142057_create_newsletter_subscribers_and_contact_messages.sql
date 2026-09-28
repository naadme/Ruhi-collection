-- Rohi Collection — newsletter + contact form persistence
--
-- Matches exactly what the frontend already sends (no more, no less):
--   src/components/Newsletter.jsx
--     .from('newsletter_subscribers').insert({ email })
--   src/pages/Contact.jsx
--     .from('contact_messages').insert({ name, email, phone, comment })
--
-- Verified before writing this file: neither table existed
-- (PostgREST returned PGRST205 "Could not find the table ... in the schema cache").

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text not null,
  phone text,
  comment text,
  created_at timestamptz not null default now()
);

alter table public.newsletter_subscribers enable row level security;
alter table public.contact_messages enable row level security;

-- INSERT only. Deliberately no SELECT / UPDATE / DELETE policies: the public may
-- submit entries, but clients must never be able to read or mutate them.
-- The `drop policy if exists` guards keep the migration safe to re-run without
-- ever leaving duplicate policies behind.

drop policy if exists "public can insert newsletter subscriptions"
  on public.newsletter_subscribers;
create policy "public can insert newsletter subscriptions"
  on public.newsletter_subscribers
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "public can insert contact messages"
  on public.contact_messages;
create policy "public can insert contact messages"
  on public.contact_messages
  for insert
  to anon, authenticated
  with check (true);
