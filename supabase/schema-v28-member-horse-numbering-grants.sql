-- schema-v28: member horse numbering service-role grants
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- The member portal assigns horse back numbers on the server. It checks the
-- official horse registry first, then falls back to the next available number.
-- Browser roles stay restricted; service_role is the server-only role used by
-- /api/account/horses.

grant select on horses to service_role;
grant select on horse_registrations to service_role;
