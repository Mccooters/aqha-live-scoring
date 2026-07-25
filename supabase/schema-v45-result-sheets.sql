-- schema-v45: judges' result sheet photos per class
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Staff photograph each judge's paper results and attach them to the class
-- (uploaded from the phone into the existing public "patterns" storage bucket
-- under results/...). Stored as a JSON list of { url, label } — one entry per
-- photo, labelled with the judge's name, multiple pages allowed. Shown as
-- links on the public Results page next to the typed results.

alter table classes add column if not exists result_sheets jsonb;
