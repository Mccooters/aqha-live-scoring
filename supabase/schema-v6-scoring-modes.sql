-- Scoring modes per class — run in Supabase SQL Editor
-- score      : 70-point scale, one horse at a time (current default)
-- placing    : 1st/2nd/3rd etc, one horse at a time, no points
-- class_only : everyone in ring together, no live draw, placings entered after

alter table classes add column if not exists scoring_mode text not null default 'score';
