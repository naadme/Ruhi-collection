-- When the Express switch was on and when it was paused (25 Nov 2026).
--
-- The A/B test express_offer (src/lib/experimentList.js) keeps splitting
-- visitors while Express is paused, and the owner reads its results for the
-- hours Express was on and the hours it was paused separately. shop_settings
-- keeps only the switch's current value; this table keeps every change, the
-- way stock_changes does for sold-out sizes. Nobody writes it by hand: a
-- trigger adds a row whenever express_delivery changes, and the changes from
-- before this table are filled in from the record.
begin;

create table if not exists public.express_switch_changes (
  id                bigint generated always as identity primary key,
  express_delivery  boolean not null,
  changed_at        timestamptz not null default now(),
  changed_by        uuid,
  source            text not null default 'switch' check (source in ('switch', 'backfill'))
);

create index if not exists express_switch_changes_at_idx on public.express_switch_changes (changed_at);

alter table public.express_switch_changes enable row level security;
revoke all on table public.express_switch_changes from anon, authenticated;
grant select on table public.express_switch_changes to authenticated;
grant all on table public.express_switch_changes to service_role;

drop policy if exists "admins can read express switch changes" on public.express_switch_changes;
create policy "admins can read express switch changes"
  on public.express_switch_changes for select to authenticated
  using (public.is_admin());

create or replace function public.shop_settings_log_express()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.express_delivery is distinct from old.express_delivery then
    insert into public.express_switch_changes (express_delivery, changed_by)
    values (new.express_delivery, (select auth.uid()));
  end if;
  return null;
end $$;

revoke all on function public.shop_settings_log_express() from public, anon, authenticated;

drop trigger if exists shop_settings_log_express on public.shop_settings;
create trigger shop_settings_log_express
after update of express_delivery on public.shop_settings
for each row execute function public.shop_settings_log_express();

-- The changes before this table existed, India time: Express went live with
-- the 19 Nov release at 4:19 PM (#30, switch on), was paused on 20 Nov at
-- 11:46 AM and came back on 23 Nov at 9:18 AM (shop_settings.updated_at, read
-- on 21 and 24 Nov). Added once.
insert into public.express_switch_changes (express_delivery, changed_at, source)
select v.express_delivery, v.changed_at, 'backfill'
from (values
  (true,  timestamptz '2026-11-19 16:19:00+05:30'),
  (false, timestamptz '2026-11-20 11:46:00+05:30'),
  (true,  timestamptz '2026-11-23 09:18:18+05:30')
) as v(express_delivery, changed_at)
where not exists (select 1 from public.express_switch_changes where source = 'backfill');

commit;
