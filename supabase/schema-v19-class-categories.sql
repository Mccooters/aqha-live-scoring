-- schema-v19: class program categories
-- Run in Supabase: SQL Editor -> New query -> paste -> Run

alter table classes add column if not exists program_category text;
