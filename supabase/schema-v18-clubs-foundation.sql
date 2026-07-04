-- schema-v18: multi-club foundation (ADDITIVE, NON-BREAKING)
--
-- Introduces the "club" concept so the app can eventually serve multiple clubs,
-- WITHOUT changing any current behaviour. HCQHA keeps working exactly as it does
-- today: this creates one club ("HCQHA"), tags all existing data as belonging to
-- it, and adds (but does not yet enforce) per-club staff logins.
--
-- Security stays exactly as it is now — any signed-in user can still write
-- everything. Per-club isolation (so Club A can never touch Club B's data) is a
-- later, deliberate step (schema-v19), done once the app is club-aware and every
-- staff member has a membership row below. Safe to run anytime, even mid-show.

-- 1) Clubs — each is a self-contained tenant with its own white-label branding.
create table if not exists clubs (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,            -- 'hcqha' — used in links and the app
  name          text not null,                   -- 'Hunter Coast Quarter Horse Association'
  short_name    text not null,                   -- 'HCQHA'
  logo_url      text,
  brand_paper   text not null default '#FBF8F2',
  brand_leather text not null default '#3A2A1C',
  brand_brass   text not null default '#A8843C',
  brand_clay    text not null default '#C24A2E',
  contact_email text,
  created_at    timestamptz default now()
);
alter table clubs enable row level security;
create policy "public read clubs" on clubs for select using (true); -- branding is public

insert into clubs (slug, name, short_name)
values ('hcqha', 'Hunter Coast Quarter Horse Association', 'HCQHA')
on conflict (slug) do nothing;

-- 2) Memberships — which user runs which club, and in what role.
create table if not exists memberships (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references clubs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'staff',      -- 'owner' | 'staff'
  created_at timestamptz default now(),
  unique (club_id, user_id)
);
alter table memberships enable row level security;
create policy "read own memberships" on memberships
  for select to authenticated using (user_id = auth.uid());

-- After running this, link your existing staff logins to HCQHA, e.g.:
--   insert into memberships (club_id, user_id, role)
--   select c.id, u.id, 'owner'
--   from clubs c, auth.users u
--   where c.slug = 'hcqha' and u.email = 'you@example.com'
--   on conflict do nothing;

-- 3) Tag existing data with its club (everything today is HCQHA).
alter table events               add column if not exists club_id uuid references clubs(id);
alter table classes              add column if not exists club_id uuid references clubs(id);
alter table entries              add column if not exists club_id uuid references clubs(id);
alter table registrations        add column if not exists club_id uuid references clubs(id);
alter table registration_entries add column if not exists club_id uuid references clubs(id);

update events e
  set club_id = c.id from clubs c
  where c.slug = 'hcqha' and e.club_id is null;
update classes k
  set club_id = e.club_id from events e
  where k.event_id = e.id and k.club_id is null;
update entries en
  set club_id = k.club_id from classes k
  where en.class_id = k.id and en.club_id is null;
update registrations r
  set club_id = e.club_id from events e
  where r.event_id = e.id and r.club_id is null;
update registration_entries re
  set club_id = k.club_id from classes k
  where re.class_id = k.id and re.club_id is null;

-- NOTE: the registry (horses / riders / back numbers / high points) becomes
-- club-aware in its own migration once the registry model is confirmed — see the
-- platform plan. Central horse identity + association registration numbers stay
-- shared; back numbers become per-club.
