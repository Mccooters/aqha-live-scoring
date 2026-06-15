-- Fix foreign key cascades — run in Supabase SQL Editor
-- Deleting a class now automatically removes any registration_entries that referenced it.

alter table registration_entries
  drop constraint if exists registration_entries_class_id_fkey;

alter table registration_entries
  add constraint registration_entries_class_id_fkey
  foreign key (class_id) references classes(id) on delete cascade;
