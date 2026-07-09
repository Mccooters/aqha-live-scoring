-- schema-v32: cancelling online registrations (staff button + 48h auto-expiry)
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Pending registrations used to sit forever. Staff can now cancel one from
-- the Registrations page, and anything unpaid for 48 hours is cancelled
-- automatically. Cancelling also deletes the Square checkout link so it can
-- no longer be paid — which needs the link's id, stored here at creation.
-- (If a payment does somehow land on a cancelled registration — e.g. an old
-- link from before this change — the webhook still honours the money and
-- creates the entries.)

alter table registrations
  add column if not exists square_payment_link_id text;

alter table registrations
  add column if not exists cancelled_at timestamptz;

-- 'staff' (cancelled by a coordinator) or 'expired' (48h auto-expiry)
alter table registrations
  add column if not exists cancel_reason text;
