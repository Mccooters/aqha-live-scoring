-- schema-v57: raffles — live updates for the ticket board
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- v56 created the raffle tables but never switched them on for realtime, so
-- an open raffle page only learned about a sale when its timer next ticked
-- (and a tab left in the background on a phone can sit on stale numbers).
-- This file:
--   1) adds raffles.tickets_changed_at — the server bumps it every time a
--      number is reserved, sold, released or expires, so the PUBLIC page
--      (which can read raffles but not the ticket rows) hears about every
--      change the moment it happens and re-fetches the taken numbers;
--   2) adds the raffle tables to the realtime publication so the staff
--      Raffles page (and the public page via raffles) get live updates.

alter table raffles add column if not exists tickets_changed_at timestamptz default now();

do $$
begin
  alter publication supabase_realtime add table raffles;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table raffle_orders;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table raffle_tickets;
exception when duplicate_object then null;
end $$;
