-- schema-v39: track new-number requests and the additional-number fee
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Two things:
-- 1. A member's FIRST horse number is covered by their membership; every
--    ADDITIONAL horse costs a $5 number fee (same as the replacement-number
--    fee). These columns record that fee per horse and whether it's been paid,
--    so the new "New numbers" staff list can show who owes what.
-- 2. A flag on online show entries marking the ones where the exhibitor asked
--    for a brand-new number (no existing back number), so those show up in the
--    same list.

alter table club_member_horses add column if not exists number_fee_cents integer not null default 0;
alter table club_member_horses add column if not exists number_fee_paid boolean not null default false;

alter table registration_entries add column if not exists new_number boolean not null default false;
