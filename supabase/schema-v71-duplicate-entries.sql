-- schema-v71: record entries that weren't added because the horse was already in the class
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Owner's report, Nov 2026: the exact same horse ended up in a class twice.
-- Two online bookings for the same horse and class, both made before either
-- was paid, each passed the "already entered?" check, and both became
-- entries when paid. The website now refuses the second booking up front,
-- and if one still gets paid, the horse is NOT added to the class a second
-- time — the skipped classes are noted here so staff can see who may be
-- owed a refund on the Registrations page.

alter table registrations add column if not exists skipped_entries jsonb;
-- [{ class_id, class_label, back_number, horse, reason, at }]
