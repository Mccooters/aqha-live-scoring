-- AQHA Live Scoring — database schema
-- Run this once in Supabase: SQL Editor → New query → paste → Run

-- ========== TABLES ==========

create table events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  starts_on date,
  ends_on date,
  status text not null default 'upcoming', -- upcoming | live | completed
  created_at timestamptz default now()
);

create table classes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  num int not null,
  name text not null,
  judge text,
  status text not null default 'upcoming', -- upcoming | live | completed
  sort_order int not null default 0,
  pattern_url text, -- link to an uploaded pattern image/PDF (Supabase Storage)
  created_at timestamptz default now()
);

create table entries (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  back_number int not null,
  horse text not null,
  exhibitor text not null,
  draw_order int not null default 0,
  score numeric,
  scratched boolean not null default false,
  created_at timestamptz default now()
);

create index on classes (event_id, sort_order);
create index on entries (class_id, draw_order);

-- ========== SECURITY (Row Level Security) ==========
-- Anyone can READ (spectators need no account).
-- Only signed-in coordinators can WRITE.

alter table events  enable row level security;
alter table classes enable row level security;
alter table entries enable row level security;

create policy "public read events"  on events  for select using (true);
create policy "public read classes" on classes for select using (true);
create policy "public read entries" on entries for select using (true);

create policy "staff write events"  on events  for all to authenticated using (true) with check (true);
create policy "staff write classes" on classes for all to authenticated using (true) with check (true);
create policy "staff write entries" on entries for all to authenticated using (true) with check (true);

-- ========== REALTIME ==========
-- Lets every spectator's screen update the instant a score is saved.

alter publication supabase_realtime add table events, classes, entries;

-- ========== SAMPLE DATA (optional — delete this block for a clean start) ==========

with ev as (
  insert into events (name, location, starts_on, ends_on, status)
  values ('Sun Valley Summer Circuit', 'Sun Valley Equestrian Center · Arena 1', '2026-06-11', '2026-06-12', 'live')
  returning id
),
c1 as (
  insert into classes (event_id, num, name, judge, status, sort_order)
  select id, 14, 'Senior Western Pleasure', 'K. Maddox', 'live', 1 from ev
  returning id
),
c2 as (
  insert into classes (event_id, num, name, judge, status, sort_order)
  select id, 15, 'Amateur Trail', 'R. Calloway', 'upcoming', 2 from ev
  returning id
)
insert into entries (class_id, back_number, horse, exhibitor, draw_order, score)
select id, 301, 'Machine Made Lady', 'P. Santos', 1, 72.5 from c1 union all
select id, 287, 'Willy Be Invited', 'D. Kowalski', 2, 70 from c1 union all
select id, 214, 'Zippos Gold Bar', 'S. McAllister', 3, 74 from c1 union all
select id, 322, 'Blazing Hot Chips', 'L. Trevino', 4, null from c1 union all
select id, 269, 'A Sudden Vintage', 'E. Faulkner', 5, null from c1 union all
select id, 412, 'Smooth Talkin Te', 'G. Holloway', 1, null from c2 union all
select id, 388, 'Krymsun Kruzer', 'F. Ibarra', 2, null from c2 union all
select id, 401, 'Absolute Asset', 'W. Pruitt', 3, null from c2;
