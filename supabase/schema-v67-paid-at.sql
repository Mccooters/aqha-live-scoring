-- schema-v67: when each payment was received (for the Revenue page)
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- The staff Revenue page (/coordinator/revenue) lists the club's money month
-- by month. Raffle orders already record paid_at, but event registrations
-- and memberships only had created_at / approved_at — so a registration
-- started on 31 July and paid on 1 August would land in the wrong month.
--
-- registrations.paid_at — set the moment the registration is approved
--   (Square/PayPal webhook, free entry, or the staff force-approve button).
-- club_members.paid_at  — set when the membership payment arrives (webhook),
--   when staff mark an application paid by hand, or when staff add / renew
--   a member manually.
--
-- Existing rows are backfilled from the best date already on record, so the
-- Revenue page shows history straight away. Until this file is run the page
-- falls back to those same dates itself — nothing breaks.

alter table registrations add column if not exists paid_at timestamptz;
alter table club_members  add column if not exists paid_at timestamptz;

update registrations
   set paid_at = coalesce(paid_at, created_at)
 where status = 'paid' and paid_at is null;

-- Online memberships were paid when they were created (the checkout follows
-- the form straight away); manually added ones when staff approved them.
update club_members
   set paid_at = coalesce(
         paid_at,
         case when square_order_id is null then approved_at end,
         created_at)
 where status in ('paid', 'approved') and total_cents > 0 and paid_at is null;
