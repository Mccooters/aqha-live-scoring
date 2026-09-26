-- schema-v53: break timer for the live view
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Staff (dashboard) or the gate marshal (gate page) can start a timed break —
-- "Break for gear change, back at 10:15" — and everyone watching the live
-- page sees a countdown and the estimated return time. break_until is when
-- the break ends; break_label is what it's called (usually the program's own
-- break heading). A break in the past is simply over — nothing to clean up.

alter table events add column if not exists break_until timestamptz;
alter table events add column if not exists break_label text;
