-- schema-v42: multiple association registrations per member (and family member)
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Members aren't all AQHA — many are Paint (PHAA), Appaloosa (AAA) or several
-- at once. Instead of one "AQHA member number" field, each member and each
-- family member can now list several clubs with their number, the same way a
-- horse lists multiple registrations. Stored as a JSON list of
-- {club, number} pairs. The old aqha_member_number / other_memberships columns
-- stay for existing data; the new list is the primary way going forward.

alter table club_members add column if not exists association_registrations jsonb;
alter table club_member_people add column if not exists association_registrations jsonb;
