-- schema-v27: member portal service-role grants
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- The member portal signs users in through the private account tables, then
-- loads their membership application rows and related horses/people through
-- server API routes. The browser roles remain restricted; service_role is the
-- server-only role used by those routes.

grant select, insert, update, delete on membership_types to service_role;
grant select, insert, update, delete on club_members to service_role;
grant select, insert, update, delete on club_member_horses to service_role;
grant select, insert, update, delete on club_member_people to service_role;
