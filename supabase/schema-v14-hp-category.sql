-- schema-v14: link classes to high points categories
-- Run in Supabase: SQL Editor → New query → paste → Run

alter table classes add column if not exists hp_category text;
