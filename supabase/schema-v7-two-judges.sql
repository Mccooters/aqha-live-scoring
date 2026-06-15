-- Two-judge support — run in Supabase SQL Editor
-- Each class can have an optional second judge.
-- Each entry can store a second score (one per judge).
-- Combined score = score + score2 (both are stored separately for the export).

alter table classes add column if not exists judge2 text;
alter table entries add column if not exists score2 numeric;
