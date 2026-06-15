-- TBC draw mode split — run in Supabase SQL Editor
--
-- Adds a "called" flag so coordinators can advance entries through the draw
-- one at a time without entering a score (results come from judge's paperwork later).
--
-- Renames the existing "tbc" scoring mode → "tbc_class" (everyone in ring together).
-- The new "tbc" mode = individual draw visible, horses go one at a time, no live scoring.

alter table entries add column if not exists called boolean not null default false;

-- Migrate existing whole-class TBC rows to the new name
update classes set scoring_mode = 'tbc_class' where scoring_mode = 'tbc';
