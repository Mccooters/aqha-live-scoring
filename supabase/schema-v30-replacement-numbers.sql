-- schema-v30: replacement number add-on for event registrations
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Online event registration can include a $5 replacement-number add-on.

alter table registrations
  add column if not exists replacement_numbers boolean not null default false;

alter table registrations
  add column if not exists replacement_numbers_cents integer not null default 0;
