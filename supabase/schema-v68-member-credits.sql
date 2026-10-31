-- schema-v68: member credits — credit instead of a refund, spent on a later event
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Owner's request, Oct 2026: someone who over-booked camping wanted the
-- difference kept as a credit on their membership rather than refunded.
--
-- member_credits — a ledger per EMAIL ADDRESS (the same email-as-identity
--   rule memberships use everywhere): "+" rows are credit given by staff
--   (the Registrations page's "Keep as club credit instead", or by hand on
--   the Memberships page); "−" rows are credit used on a registration
--   (written by the server the moment that registration is approved) or
--   taken back by staff.
-- registrations.credit_cents — how much credit a registration applied: held
--   while its checkout is unpaid, consumed when it is approved. Unpaid
--   checkouts lapse after 48 hours and release the hold.

create table if not exists member_credits (
  id uuid primary key default gen_random_uuid(),
  email text not null,                     -- stored lower-case
  amount_cents integer not null,           -- + given, − used / taken back
  kind text not null default 'credit',     -- credit | use | adjust
  reason text,
  event_id uuid references events(id) on delete set null,
  registration_id uuid references registrations(id) on delete set null,
  created_by text,                         -- staff email, or 'system'
  created_at timestamptz not null default now()
);
create index if not exists member_credits_email_idx on member_credits (lower(email));
-- A registration's credit is spent at most once, however many times the
-- payment webhook retries.
create unique index if not exists member_credits_one_use_per_registration
  on member_credits (registration_id) where kind = 'use';

alter table registrations add column if not exists credit_cents integer not null default 0;

alter table member_credits enable row level security;

-- Staff see and manage credits; the public never reads them (the member
-- portal and the entry form go through the server, which shows a person
-- only their own). No anon access at all.
do $$ begin
  create policy "staff read member_credits" on member_credits for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff write member_credits" on member_credits for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

grant select, insert, update, delete on member_credits to authenticated;
grant all on member_credits to service_role;

-- Committee read-only accounts (schema-v48) can look but not touch. Guarded
-- so this runs before v48 too — re-run after v48 in that case.
do $$
declare t text;
begin
  if to_regprocedure('is_staff_viewer()') is null then return; end if;
  foreach t in array array['member_credits'] loop
    execute format('drop policy if exists "viewers cannot insert" on %I', t);
    execute format('create policy "viewers cannot insert" on %I as restrictive for insert to authenticated with check (not is_staff_viewer())', t);
    execute format('drop policy if exists "viewers cannot update" on %I', t);
    execute format('create policy "viewers cannot update" on %I as restrictive for update to authenticated using (not is_staff_viewer()) with check (not is_staff_viewer())', t);
    execute format('drop policy if exists "viewers cannot delete" on %I', t);
    execute format('create policy "viewers cannot delete" on %I as restrictive for delete to authenticated using (not is_staff_viewer())', t);
  end loop;
end $$;
