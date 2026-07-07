-- schema-v29: one-event day memberships
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Event registration can include a $20 day membership when annual membership
-- is required but the entrant only wants to attend this one event.

alter table registrations
  add column if not exists day_membership boolean not null default false;

alter table registrations
  add column if not exists day_membership_cents integer not null default 0;
