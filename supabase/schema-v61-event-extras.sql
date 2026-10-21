-- schema-v61: camping & yards — bookable extras for shows and clinics
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Owner's request, Oct 2026: yards and camping can be booked through the
-- website with an entry (or on their own by someone who has already
-- entered). Staff define what's bookable per event from the dashboard's
-- "🏕 Camping & yards" button; exhibitors pick quantities and nights on the
-- entry form; the money rides the same checkout as the entries.

create table if not exists event_extras (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,                            -- "Yard", "Powered camping site"
  kind text not null default 'other',            -- yard | camping | other
  unit text not null default 'night',            -- night = priced per night; event = one price for the whole event
  price_cents integer not null default 0,
  capacity integer,                              -- how many exist (per night for night items); null = unlimited
  first_night date,                              -- night items: first bookable night (null = the night before the event starts)
  last_night date,                               -- night items: last bookable night (null = the event's last day)
  description text,
  active boolean not null default true,          -- switched off = not offered, bookings kept
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists event_extras_event_idx on event_extras (event_id);

-- One row per item booked on a registration. The extra can't be deleted
-- while bookings point at it (staff switch it off instead) — bookings are
-- money people have paid and are never removed as a side effect.
create table if not exists registration_extras (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id) on delete cascade,
  extra_id uuid not null references event_extras(id),
  quantity integer not null default 1,
  nights jsonb not null default '[]'::jsonb,     -- ["2026-11-14", ...] for night items; [] for event items
  amount_cents integer not null default 0,
  notes text,                                    -- horse names / vehicle, as typed by the exhibitor
  created_at timestamptz not null default now()
);
create index if not exists registration_extras_reg_idx on registration_extras (registration_id);
create index if not exists registration_extras_extra_idx on registration_extras (extra_id);

alter table event_extras        enable row level security;
alter table registration_extras enable row level security;

-- What's bookable is public (the entry form and the event page show it);
-- who booked what is staff-only, like registrations. The entry form gets
-- "how many are left" through /api/registrations/extras-status (counts only).
do $$ begin
  create policy "public read event_extras" on event_extras for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff write event_extras" on event_extras for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff read registration_extras" on registration_extras for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff write registration_extras" on registration_extras for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

grant select on event_extras to anon;
grant select, insert, update, delete on event_extras to authenticated;
grant all on event_extras to service_role;
grant select, insert, update, delete on registration_extras to authenticated;
grant all on registration_extras to service_role;

-- Committee read-only accounts (schema-v48) can look but not touch. Guarded
-- so this runs before v48 too — re-run after v48 in that case.
do $$
declare t text;
begin
  if to_regprocedure('is_staff_viewer()') is null then return; end if;
  foreach t in array array['event_extras', 'registration_extras'] loop
    execute format('drop policy if exists "viewers cannot insert" on %I', t);
    execute format('create policy "viewers cannot insert" on %I as restrictive for insert to authenticated with check (not is_staff_viewer())', t);
    execute format('drop policy if exists "viewers cannot update" on %I', t);
    execute format('create policy "viewers cannot update" on %I as restrictive for update to authenticated using (not is_staff_viewer()) with check (not is_staff_viewer())', t);
    execute format('drop policy if exists "viewers cannot delete" on %I', t);
    execute format('create policy "viewers cannot delete" on %I as restrictive for delete to authenticated using (not is_staff_viewer())', t);
  end loop;
end $$;
