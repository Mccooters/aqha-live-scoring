-- schema-v20: program break headings
-- Run in Supabase: SQL Editor -> New query -> paste -> Run

alter table classes add column if not exists program_break_before text;
alter table classes add column if not exists program_break_after text;
