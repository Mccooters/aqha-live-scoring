-- AQHA Live Scoring — v2 migration
-- Adds: horse registry, club registrations, push subscriptions, day field on classes
-- Run in Supabase SQL Editor AFTER schema.sql has been applied.

-- ========== HORSE REGISTRY ==========
-- back_number is permanent for life (never changes)

create table if not exists horses (
  id          uuid primary key default gen_random_uuid(),
  back_number int  unique not null,
  name        text not null,
  owner       text,
  created_at  timestamptz default now()
);

create table if not exists horse_registrations (
  id                  uuid primary key default gen_random_uuid(),
  horse_id            uuid not null references horses(id) on delete cascade,
  club                text not null,             -- e.g. "AQHA", "PHAA Paint"
  registration_number text,
  created_at          timestamptz default now(),
  unique(horse_id, club)                          -- one registration per club per horse
);

-- ========== WEB PUSH SUBSCRIPTIONS ==========
-- Spectators opt in via the live view to receive browser notifications.

create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  endpoint   text unique not null,
  p256dh     text not null,
  auth_key   text not null,
  created_at timestamptz default now()
);

-- ========== MULTI-DAY SHOWS: day column on classes ==========
-- Defaults to 1 for all existing classes (works as-is for single-day shows).

alter table classes add column if not exists day int not null default 1;

-- ========== PATTERN STORAGE BUCKET ==========
-- Stores class pattern files (images/PDFs).
-- If the INSERT below errors, create the bucket manually in:
--   Supabase Dashboard → Storage → New bucket → name: patterns, Public: on

insert into storage.buckets (id, name, public)
values ('patterns', 'patterns', true)
on conflict (id) do nothing;

create policy "public read patterns"
  on storage.objects for select
  using (bucket_id = 'patterns');

create policy "staff write patterns"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'patterns');

create policy "staff update patterns"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'patterns');

-- ========== SECURITY (Row Level Security) ==========

alter table horses              enable row level security;
alter table horse_registrations enable row level security;
alter table push_subscriptions  enable row level security;

create policy "public read horses"              on horses              for select using (true);
create policy "public read horse_registrations" on horse_registrations for select using (true);

create policy "staff write horses"              on horses              for all to authenticated using (true) with check (true);
create policy "staff write horse_registrations" on horse_registrations for all to authenticated using (true) with check (true);

-- Anyone can subscribe or unsubscribe themselves
create policy "public insert push_subscriptions" on push_subscriptions for insert with check (true);
create policy "public delete push_subscriptions" on push_subscriptions for delete using (true);
create policy "public read push_subscriptions"   on push_subscriptions for select using (true);

-- ========== REALTIME ==========

alter publication supabase_realtime add table horses, horse_registrations;
