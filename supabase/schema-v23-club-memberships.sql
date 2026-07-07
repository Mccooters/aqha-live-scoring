-- schema-v23: club memberships (join + pay online, staff approve)
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Adds the online membership system:
--   * membership_types  — the kinds of membership on offer and their price
--                         (price starts at $0 — set real prices on the
--                         coordinator Memberships page when they're decided)
--   * club_members      — one row per membership application per season
--                         (season runs 1 August to 31 July)
--   * club_member_horses — the horse details a member adds when joining
--
-- Privacy: club_members and club_member_horses hold names, emails and phone
-- numbers, so — like online registrations since v16 — they are NOT publicly
-- readable. Only signed-in staff can see them; the public join form and
-- success page go through server API routes instead.

-- 1) Membership types (name + price). Public read so the join form can show
--    them; staff manage them on the coordinator Memberships page.
create table if not exists membership_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  fee_cents   integer not null default 0,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz default now()
);
alter table membership_types enable row level security;

drop policy if exists "public read membership_types" on membership_types;
create policy "public read membership_types"
  on membership_types for select using (true);

drop policy if exists "staff write membership_types" on membership_types;
create policy "staff write membership_types"
  on membership_types for all to authenticated
  using (true) with check (true);

grant select on membership_types to anon;
grant select, insert, update, delete on membership_types to authenticated;

-- The club's membership types, matching the existing paper/Google form.
-- Edit names and prices any time on the coordinator Memberships page.
insert into membership_types (name, description, fee_cents, sort_order)
select * from (values
  ('Family Membership', '2 adults, 2 children', 5000, 1),
  ('Single',            null,                   3500, 2),
  ('Youth',             null,                   1000, 3)
) as seed(name, description, fee_cents, sort_order)
where not exists (select 1 from membership_types);

-- 2) Members — one row per person per season.
--    status: pending  = submitted, awaiting payment
--            paid     = payment received, awaiting committee approval
--            approved = current member
--            rejected = declined by the committee
create table if not exists club_members (
  id                   uuid primary key default gen_random_uuid(),
  season               text not null,              -- e.g. '2026-2027' (1 Aug – 31 Jul)
  membership_type_id   uuid references membership_types(id) on delete set null,
  membership_type_name text,                       -- kept even if the type is renamed/deleted
  member_name          text not null,
  email                text not null,
  phone                text,
  address              text,
  aqha_member_number   text,                       -- AQHA member number, if they have one
  other_memberships    text,                       -- other breed/association memberships
  emergency_contact_name  text,
  emergency_contact_phone text,
  interests            text,                       -- what they'd like from the club (Shows, Clinics, ...)
  applicant_notes      text,                       -- feedback / anything else from the applicant

  status               text not null default 'pending',
  total_cents          integer not null default 0,
  square_order_id      text,
  square_checkout_url  text,
  square_payment_id    text,
  approved_at          timestamptz,
  created_at           timestamptz default now()
);
-- If an earlier copy of this file was already run, these make sure the newer
-- application-form fields exist too (they do nothing on a fresh table).
alter table club_members add column if not exists aqha_member_number      text;
alter table club_members add column if not exists other_memberships       text;
alter table club_members add column if not exists emergency_contact_name  text;
alter table club_members add column if not exists emergency_contact_phone text;
alter table club_members add column if not exists interests               text;

create index if not exists club_members_season_idx on club_members (season);
create index if not exists club_members_email_idx on club_members (lower(email));
create index if not exists club_members_square_order_idx on club_members (square_order_id);

alter table club_members enable row level security;

-- Staff-only: no anon policies at all. The join form, payment webhook and
-- success page act through server API routes (service role).
drop policy if exists "staff read club_members" on club_members;
create policy "staff read club_members"
  on club_members for select to authenticated using (true);

drop policy if exists "staff write club_members" on club_members;
create policy "staff write club_members"
  on club_members for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on club_members to authenticated;
revoke select, insert, update, delete on club_members from anon;

-- 3) Horses supplied with a membership application, for the committee to
--    review (and add to the permanent registry if appropriate).
create table if not exists club_member_horses (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references club_members(id) on delete cascade,
  horse_name    text not null,
  back_number   integer,                            -- if the horse already has one
  breed         text,                               -- e.g. Quarter Horse, Paint, Appaloosa
  registrations text,                               -- association + registration numbers
  notes         text,
  created_at    timestamptz default now()
);
create index if not exists club_member_horses_member_idx on club_member_horses (member_id);

alter table club_member_horses enable row level security;

drop policy if exists "staff read club_member_horses" on club_member_horses;
create policy "staff read club_member_horses"
  on club_member_horses for select to authenticated using (true);

drop policy if exists "staff write club_member_horses" on club_member_horses;
create policy "staff write club_member_horses"
  on club_member_horses for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on club_member_horses to authenticated;
revoke select, insert, update, delete on club_member_horses from anon;

-- 4) The "membership required to enter events" switch. Starts OFF so nothing
--    changes until members have actually been signed up — turn it on from the
--    coordinator Memberships page when ready.
insert into site_settings (key, value)
values ('membership_required', '{"enabled": false, "include_clinics": false}'::jsonb)
on conflict (key) do nothing;

-- 5) Live updates for the coordinator Memberships page.
do $$
begin
  alter publication supabase_realtime add table club_members;
exception when duplicate_object then null;
end $$;
