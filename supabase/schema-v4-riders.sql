-- Riders registry — run in Supabase SQL Editor
-- Tracks registered exhibitors separately from horses

create table if not exists riders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  member_number text,
  category text,   -- e.g. Amateur, Novice Amateur, Select, Beginner, Youth, EWD, Leadline
  notes text,
  created_at timestamptz default now()
);

alter table riders enable row level security;
create policy "public read riders"  on riders for select using (true);
create policy "staff write riders"  on riders for all to authenticated using (true) with check (true);

grant select on riders to anon;
grant insert, update, delete on riders to authenticated;

alter publication supabase_realtime add table riders;
