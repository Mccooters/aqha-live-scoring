-- schema-v54: HCQHA membership numbers
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Every PERSON on an approved membership — the applicant and each family
-- member — gets a permanent club membership number. It is issued once and
-- follows the person across seasons: a renewal or re-join under the same
-- email keeps the applicant's number, and a family member with the same name
-- on that lineage keeps theirs. Numbers are assigned on approval / renewal,
-- and staff can number everyone already approved from the member list page.

alter table club_members       add column if not exists hcqha_number integer;
alter table club_member_people add column if not exists hcqha_number integer;
create index if not exists club_members_hcqha_number_idx       on club_members (hcqha_number);
create index if not exists club_member_people_hcqha_number_idx on club_member_people (hcqha_number);
