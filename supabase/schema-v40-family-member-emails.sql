-- schema-v40: give each person on a membership their own email
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- A family membership covers several people. Until now only the applicant had
-- an email on file. This lets each additional person (spouse, children) have
-- their own email so they can enter events under it and be recognised as a
-- member. Optional — blank is fine.

alter table club_member_people add column if not exists email text;
