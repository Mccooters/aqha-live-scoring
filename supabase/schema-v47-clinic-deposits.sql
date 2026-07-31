-- schema-v47: clinic deposits + per-spot-type pricing
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Clinics can now charge a NON-REFUNDABLE deposit at registration, with the
-- balance payable separately any time up to 2 weeks before the clinic. Each
-- spot type also gets its own price (e.g. Fence sitting cheaper than a
-- Rider spot) instead of one event-wide fee.
--
--   * classes.fee_cents      — this spot type's full price (null = use the
--                              event's entry fee, as before)
--   * classes.deposit_cents  — the non-refundable deposit for this spot type
--                              (null/0 = no deposit option, pay in full only)
--   * registrations.deposit_cents        — what the payer paid up front when
--                              they chose the deposit option (0/null = paid
--                              in full). total_cents stays the FULL price.
--   * registrations.balance_*            — the second Square checkout for the
--                              remaining balance, and when it was paid.

alter table classes add column if not exists fee_cents integer;
alter table classes add column if not exists deposit_cents integer;

alter table registrations add column if not exists deposit_cents integer;
alter table registrations add column if not exists balance_square_order_id text;
alter table registrations add column if not exists balance_checkout_url text;
alter table registrations add column if not exists balance_payment_id text;
alter table registrations add column if not exists balance_paid_at timestamptz;
