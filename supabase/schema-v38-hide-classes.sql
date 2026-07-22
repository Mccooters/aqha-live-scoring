-- schema-v38: hide classes instead of deleting them
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- When closing entries you can now HIDE empty classes rather than delete them.
-- A hidden class disappears from the public event page, schedule, program and
-- results, but is kept so it can be reactivated in one click if someone pays
-- for that class on the day. This adds the flag that marks a class hidden;
-- everything defaults to visible (hidden = false).

alter table classes add column if not exists hidden boolean not null default false;
