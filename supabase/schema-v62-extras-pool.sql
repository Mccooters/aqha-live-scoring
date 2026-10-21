-- schema-v62: camping & yards shared between events on the same weekend
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Owner's question, Oct 2026: two events on the same weekend at the same
-- place sell the same physical yards and camping sites. Giving the matching
-- item on each event the same "shared name" (event_extras.pool) makes them
-- one pool: what's left is counted across both events, and a person entering
-- the second event sees what they already booked with the first.

alter table event_extras add column if not exists pool text;
create index if not exists event_extras_pool_idx on event_extras (pool) where pool is not null;
