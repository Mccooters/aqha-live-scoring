-- schema-v65: withdrawn clinic entries (deposit kept, balance written off)
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Someone who paid a clinic deposit (schema-v47) and then pulled out keeps
-- owing the balance forever: BALANCE OVERDUE badge, reminder emails, the
-- "Balances owing" total. Staff had no way to say "they've withdrawn — the
-- non-refundable deposit is forfeited and the rest is no longer owed".
--
-- withdrawn_at: when staff marked the registration withdrawn. Set = the
--   balance is written off (nothing owing, no reminders, pay link refused,
--   not counted in Balances owing). Cleared = back to owing as before.
-- withdrawn_by: the staff email that did it (for the audit trail).
--
-- Removing the person's spot from the clinic stays a separate step on the
-- dashboard (Scratch / Delete), exactly like a refund.

alter table registrations add column if not exists withdrawn_at timestamptz;
alter table registrations add column if not exists withdrawn_by text;
