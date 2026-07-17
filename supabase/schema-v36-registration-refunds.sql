-- schema-v36: track refunds issued from the app
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Lets staff issue a Square refund (all or part of an online entry) from the
-- coordinator Registrations page. This records how much has been refunded so
-- the page can show it and stop anyone refunding more than was paid. The money
-- itself is refunded by Square; these columns are just the app's record of it.

alter table registrations add column if not exists refunded_cents integer not null default 0;
alter table registrations add column if not exists last_refund_at timestamptz;
alter table registrations add column if not exists refund_reason text;
