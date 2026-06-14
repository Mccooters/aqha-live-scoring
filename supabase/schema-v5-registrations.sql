-- Online registrations + entry fee — run in Supabase SQL Editor

-- Add per-class entry fee to events table
alter table events add column if not exists entry_fee_cents integer not null default 0;

-- Online registrations submitted before the show
create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) not null,
  contact_name text not null,
  contact_email text not null,
  status text not null default 'pending', -- pending | paid | cancelled
  square_order_id text,
  square_checkout_url text,
  square_payment_id text,
  total_cents integer not null default 0,
  created_at timestamptz default now()
);

-- Individual class entries within a registration
create table if not exists registration_entries (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid references registrations(id) on delete cascade not null,
  class_id uuid references classes(id) not null,
  back_number integer not null,
  horse_name text not null,
  exhibitor text not null,
  created_at timestamptz default now()
);

-- RLS policies
alter table registrations enable row level security;
create policy "public read registrations"        on registrations for select using (true);
create policy "staff manage registrations"       on registrations for all to authenticated using (true) with check (true);

alter table registration_entries enable row level security;
create policy "public read registration_entries" on registration_entries for select using (true);
create policy "staff manage reg_entries"         on registration_entries for all to authenticated using (true) with check (true);

-- Anon can read (for success page); service role writes (API routes bypass RLS anyway)
grant select on registrations to anon;
grant select on registration_entries to anon;
grant all    on registrations to authenticated;
grant all    on registration_entries to authenticated;

-- Realtime (so coordinator dashboard updates live)
alter publication supabase_realtime add table registrations;
alter publication supabase_realtime add table registration_entries;
