-- Clinic support — run in Supabase SQL Editor
--
-- event_type distinguishes horse shows from clinics.
-- capacity on classes limits spots for clinic registration types (e.g. "Rider spots", "Fence sitting").
-- back_number in registration_entries becomes optional — clinics auto-assign sequential numbers.

alter table events add column if not exists event_type text not null default 'show';
alter table classes add column if not exists capacity integer;
alter table registration_entries alter column back_number drop not null;
