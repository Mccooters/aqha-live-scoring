-- schema-v44: gate marshal access
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Lets the coordinator share a per-event link with the gate marshal. The link
-- carries a long random code that unlocks gate controls ONLY (advance the TBC
-- draw, scratch/restore at the gate) on that one event — it is not a staff
-- login and gives no access to the dashboard, money, memberships or anything
-- else.
--
-- The codes live in their own locked-down table — NEVER on the publicly
-- readable events table — because the code IS the secret: staff read/create
-- them from the dashboard (authenticated), the gate API checks them with the
-- service role, and the public has no access at all.

create table if not exists gate_codes (
  event_id   uuid primary key references events(id) on delete cascade,
  code       text not null,
  created_at timestamptz default now()
);

alter table gate_codes enable row level security;

drop policy if exists "staff manage gate_codes" on gate_codes;
create policy "staff manage gate_codes" on gate_codes
  for all to authenticated using (true) with check (true);

revoke all on gate_codes from anon;
grant all on gate_codes to authenticated;
grant all on gate_codes to service_role;
