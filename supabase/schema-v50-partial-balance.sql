-- schema-v50: partial payments on clinic balances
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Lets a clinic participant pay their remaining balance (schema-v47) in
-- more than one go: each Square part payment — and each cash/bank-transfer
-- amount staff record — is logged on the registration, the amount owing
-- counts down, and the balance is marked fully paid automatically when the
-- payments add up to the total.
--
-- balance_payments: the log, e.g.
--   [{"amount_cents":5000,"at":"2026-09-01T02:11:00Z","method":"square","payment_id":"..."},
--    {"amount_cents":2500,"at":"2026-09-10T05:00:00Z","method":"manual"}]
-- balance_checkout_cents: the amount of the currently outstanding balance
--   checkout link, so a link is only reused when it matches the amount asked.
-- balance_order_ids: every balance checkout order ever created for the
--   registration — the webhook also matches old links against this list, so
--   money paid through a superseded link is still recorded, never lost.

alter table registrations add column if not exists balance_payments      jsonb;
alter table registrations add column if not exists balance_checkout_cents integer;
alter table registrations add column if not exists balance_order_ids     jsonb;
