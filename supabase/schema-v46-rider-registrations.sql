-- schema-v46: rider association numbers in the registry
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Riders earn points with their association(s) too, so the Riders registry
-- now holds a list of club memberships per rider (AQHA, PHAA, ...), exactly
-- like horse_registrations does for horses. The entry form auto-fills a
-- rider's numbers when their name (or one of their numbers) matches the
-- registry, and paid entries copy new numbers back in — insert-only, never
-- overwriting what staff recorded. The legacy riders.member_number column
-- stays (seeded below as an AQHA row) as a fallback.

create table if not exists rider_registrations (
  id                  uuid primary key default gen_random_uuid(),
  rider_id            uuid not null references riders(id) on delete cascade,
  club                text not null,             -- e.g. "AQHA", "PHAA"
  registration_number text,
  created_at          timestamptz default now(),
  unique(rider_id, club)                          -- one membership per club per rider
);

alter table rider_registrations enable row level security;

do $$ begin
  create policy "public read rider_registrations" on rider_registrations
    for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "staff write rider_registrations" on rider_registrations
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

grant select on rider_registrations to anon;
grant select, insert, update, delete on rider_registrations to authenticated;

-- Seed from the legacy single member number (assumed AQHA).
insert into rider_registrations (rider_id, club, registration_number)
select id, 'AQHA', member_number
from riders
where member_number is not null and btrim(member_number) <> ''
on conflict (rider_id, club) do nothing;
