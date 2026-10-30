-- schema-v68: names on camping & yard bookings
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
-- (Or use the Health page's "Copy SQL for the n missing updates" button.)
--
-- Owner's request, Oct 2026: the entry form asks "How many camp sites?" and
-- a person's name for each additional site (the first is the booker's own;
-- names can repeat), and "How many yards?" with the horse's name for every
-- yard. The names are stored with the booking, one per site / yard in
-- order, and shown on the Registrations page, the printable camping &
-- yards list, the success page and the booking email.

alter table registration_extras add column if not exists names jsonb;

grant select, insert, update, delete on registration_extras to authenticated;
grant all on registration_extras to service_role;
