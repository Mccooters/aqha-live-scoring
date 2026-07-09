-- schema-v34: per-event ground fee and admin fee (charged once per person)
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Each event can now have a ground fee and an admin fee on top of the
-- per-class entry fee. They're charged ONCE per person per event: the first
-- time someone pays for entries at an event they pay the fees; if they come
-- back later and add more entries to the same event, the fees aren't charged
-- again. Set them on the coordinator dashboard (New event / Edit event).

alter table events add column if not exists ground_fee_cents integer not null default 0;
alter table events add column if not exists admin_fee_cents  integer not null default 0;

-- Records how much of a registration's total was one-off fees, so the
-- "already paid the fees for this event" check knows who really paid them
-- (and so the money is accounted for if fees change later).
alter table registrations add column if not exists fees_cents integer not null default 0;
