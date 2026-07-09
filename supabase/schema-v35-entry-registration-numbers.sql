-- schema-v35: association registration numbers on show entries
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Show entries now collect, for points checking, the rider/owner's
-- association membership number(s) and the horse's registration number(s)
-- (AQHA / PHAA / AAA / ...). Stored on each pending entry as a list of
-- {"club": "AQHA", "number": "12345"} pairs:
--   * null  = not collected (entries from before this update, and clinics)
--   * []    = the entrant declared the rider/horse isn't registered with
--             any association
-- Horse numbers are also copied into the permanent horse registry
-- (horse_registrations) when the entry is paid, so they auto-fill next time.

alter table registration_entries add column if not exists rider_registrations jsonb;
alter table registration_entries add column if not exists horse_registrations jsonb;
