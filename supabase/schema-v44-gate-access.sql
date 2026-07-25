-- schema-v44: gate marshal access
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Lets the coordinator share a per-event link with the gate marshal. The link
-- carries a code that unlocks gate controls ONLY (advance the TBC draw,
-- scratch/restore at the gate) on that one event — it is not a staff login
-- and gives no access to the dashboard, money, memberships or anything else.

alter table events add column if not exists gate_code text;
