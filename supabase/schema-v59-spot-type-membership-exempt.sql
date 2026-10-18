-- schema-v59: "no membership needed" per clinic spot type
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Owner's rule, Oct 2026: fence sitting at a clinic needs no club membership,
-- while rider spots keep the membership rule. Staff flip this from a clinic
-- spot type's ⋯ menu on the dashboard; when every spot type in a booking is
-- exempt, the entry form and the server skip the membership check.

alter table classes add column if not exists membership_exempt boolean not null default false;
