-- schema-v37: record how each online entry satisfied the membership rule
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Stamps every online registration, at the moment it's created, with WHY it was
-- allowed into the event. This removes all guesswork later when reviewing "how
-- did a non-member get in?". Possible values written by the app:
--   member        - the email had an approved club membership for the season
--   annual_join   - they joined the club as part of this entry (awaiting approval)
--   renewal       - a signed-in member renewed for next season with this entry
--   day_membership- they added a one-day membership for this event only
--   not_required  - the "membership required" switch was OFF when they entered
-- Old rows (created before this update) stay null; the Registrations page falls
-- back to working it out from the members list for those.

alter table registrations add column if not exists membership_basis text;
