-- schema-v26: member account service-role grants
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- v25 intentionally hides member account/session/code tables from public
-- browser roles. The server API uses SUPABASE_SERVICE_ROLE_KEY to manage them,
-- so the service_role database role must have explicit table privileges too.

grant select, insert, update, delete on member_accounts to service_role;
grant select, insert, update, delete on member_login_codes to service_role;
grant select, insert, update, delete on member_sessions to service_role;
