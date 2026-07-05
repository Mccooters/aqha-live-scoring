-- schema-v22: site-wide settings
-- Run in Supabase: SQL Editor -> New query -> paste -> Run

create table if not exists site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

insert into site_settings (key, value)
values ('high_points_notice', '{"enabled": false, "message": "Current results are not up to date. TBC."}'::jsonb)
on conflict (key) do nothing;

alter table site_settings enable row level security;

drop policy if exists "public read site_settings" on site_settings;
create policy "public read site_settings"
  on site_settings for select
  using (true);

drop policy if exists "staff write site_settings" on site_settings;
create policy "staff write site_settings"
  on site_settings for all
  to authenticated
  using (true)
  with check (true);

grant select on site_settings to anon;
grant select, insert, update, delete on site_settings to authenticated;
