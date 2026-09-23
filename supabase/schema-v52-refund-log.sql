-- schema-v52: keep Square's reference for every refund
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Until now the app only kept a running total of what had been refunded
-- (schema-v36). Staff had no way to see whether Square had actually
-- COMPLETED a refund, or which refunds were Square ones versus cash/transfer
-- ones recorded by hand. This log holds one line per refund:
--   { amount_cents, at, method: 'square' | 'manual', refund_id, status, reason }
-- For Square refunds, refund_id and status come straight from Square
-- (PENDING -> COMPLETED, or REJECTED/FAILED) and the Registrations page can
-- re-check the status with Square at any time.

alter table registrations add column if not exists refund_log jsonb not null default '[]'::jsonb;
