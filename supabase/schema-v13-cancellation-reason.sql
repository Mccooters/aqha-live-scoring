-- schema-v13: add cancellation_reason to events
-- Run in Supabase: SQL Editor → New query → paste → Run

alter table events add column if not exists cancellation_reason text;
