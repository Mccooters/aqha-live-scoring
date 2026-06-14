-- High Points tracking — run in Supabase SQL Editor after schema.sql
-- Tracks cumulative points across a season, separately for horses and riders

create table if not exists high_points (
  id uuid primary key default gen_random_uuid(),
  season text not null,
  category text not null,
  entity_type text not null default 'rider',  -- 'horse' or 'rider'
  entity_name text not null,
  show_name text not null,
  points numeric not null default 0,
  created_at timestamptz default now(),
  unique(season, category, entity_name, show_name)
);

alter table high_points enable row level security;
create policy "public read high_points"  on high_points for select using (true);
create policy "staff write high_points"  on high_points for all to authenticated using (true) with check (true);

grant select on high_points to anon;
grant insert, update, delete on high_points to authenticated;

alter publication supabase_realtime add table high_points;
