-- Event lifecycle states — run in Supabase SQL Editor
--
-- New status values (replaces upcoming|live|completed):
--   pre_open  : coordinator is setting up, not yet visible to exhibitors for entry
--   open      : entries open, exhibitors can register online
--   closed    : entries closed, draw being finalised before the show
--   live      : show is happening now, live scoring active
--   completed : show finished, results viewable
--   archived  : hidden from the public home page, results still accessible via direct URL
--
-- Migrate existing "upcoming" events to "open"
-- (upcoming was used to mean "accepting entries", which maps to open)
update events set status = 'open' where status = 'upcoming';

-- The entries_open boolean (added in schema-v8) is superseded by status.
-- It is kept in the schema for backwards compatibility but is no longer read or written.
