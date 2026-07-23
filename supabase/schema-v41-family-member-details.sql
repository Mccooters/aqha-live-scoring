-- schema-v41: extra per-person details on a family membership
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Each person on a family membership is their own exhibitor, so they need
-- their own AQHA member number (for points) and their own contact details —
-- not just the applicant's. All optional; blank is fine.

alter table club_member_people add column if not exists aqha_member_number text;
alter table club_member_people add column if not exists phone text;
alter table club_member_people add column if not exists other_memberships text;
