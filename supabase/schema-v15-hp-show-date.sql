-- schema-v15: store event date with high points records for reliable month labels
-- Run in Supabase: SQL Editor → New query → paste → Run

alter table high_points add column if not exists show_date date;
