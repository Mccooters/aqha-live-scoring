-- schema-v51: close bookings per spot type
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Lets staff close bookings for ONE spot type of a clinic (e.g. the rider
-- spots once their deadline passes or they're full) while another stays open
-- (fence sitting has no limit and can keep taking bookings right up until
-- the event's "Close entries" shuts everything). Toggled from the spot type's
-- ... menu on the dashboard; enforced server-side in registrations/create.

alter table classes add column if not exists entries_closed boolean not null default false;
