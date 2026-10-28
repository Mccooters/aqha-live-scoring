-- schema-v66: staff_viewers service-role grants
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- v48 created the read-only (committee view) list but only granted the
-- server's service_role SELECT on it. The "Staff access" page's API route
-- (app/api/staff/users) adds and removes rows with that role, so every
-- "Create login" with Read-only chosen, and every "Make read-only" click,
-- failed with "permission denied for table staff_viewers" (owner's report,
-- Oct 2026). Like v26/v27, the server role needs explicit table privileges.

grant select, insert, update, delete on staff_viewers to service_role;
