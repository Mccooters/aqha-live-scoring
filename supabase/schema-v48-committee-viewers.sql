-- schema-v48: committee read-only ("viewer") staff accounts
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Committee members can be given a staff login that sees the whole back end
-- but cannot change anything. Create their login as usual (Authentication →
-- Users → Add user), then add them to the viewers list — see the bottom of
-- this file.
--
-- Enforcement is in the database itself: RESTRICTIVE policies AND with the
-- existing allow-all staff policies, so a viewer keeps SELECT everywhere but
-- every INSERT/UPDATE/DELETE from their login is refused — whatever buttons
-- the pages show. API routes acting with the service-role key also check the
-- list before write actions.

create table if not exists staff_viewers (
  user_id    uuid primary key,   -- auth.users id of the read-only login
  email      text,               -- noted for humans reading this table
  created_at timestamptz default now()
);

alter table staff_viewers enable row level security;

-- Every signed-in staff account may see who the viewers are (the dashboard
-- uses it to show the read-only banner). Writes go through the same
-- restrictive policy as everything else, so viewers can't edit the list.
do $$ begin
  create policy "staff read staff_viewers" on staff_viewers
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff write staff_viewers" on staff_viewers
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

grant select, insert, update, delete on staff_viewers to authenticated;
grant select on staff_viewers to service_role;

-- security definer: the check runs with the function owner's rights, so
-- policies on other tables can consult staff_viewers without recursion.
create or replace function is_staff_viewer() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from staff_viewers v where v.user_id = auth.uid()) $$;

-- Block writes (not reads) for viewers on every staff-writable table.
do $$
declare t text;
begin
  foreach t in array array[
    'events','classes','entries','site_settings','horses','horse_registrations',
    'riders','rider_registrations','high_points','registrations','registration_entries',
    'membership_types','club_members','club_member_horses','club_member_people',
    'gate_codes','staff_viewers'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists "viewers cannot insert" on %I', t);
    execute format('create policy "viewers cannot insert" on %I as restrictive for insert to authenticated with check (not is_staff_viewer())', t);
    execute format('drop policy if exists "viewers cannot update" on %I', t);
    execute format('create policy "viewers cannot update" on %I as restrictive for update to authenticated using (not is_staff_viewer()) with check (not is_staff_viewer())', t);
    execute format('drop policy if exists "viewers cannot delete" on %I', t);
    execute format('create policy "viewers cannot delete" on %I as restrictive for delete to authenticated using (not is_staff_viewer())', t);
  end loop;
end $$;

-- Pattern / result-sheet uploads are writes too.
drop policy if exists "viewers cannot upload" on storage.objects;
create policy "viewers cannot upload" on storage.objects
  as restrictive for insert to authenticated with check (not is_staff_viewer());
drop policy if exists "viewers cannot update files" on storage.objects;
create policy "viewers cannot update files" on storage.objects
  as restrictive for update to authenticated using (not is_staff_viewer());

-- ============================================================
-- ADDING A COMMITTEE VIEWER (run for each person, after creating
-- their login in Authentication → Users):
--
--   insert into staff_viewers (user_id, email)
--   select id, email from auth.users where email = 'person@example.com'
--   on conflict (user_id) do nothing;
--
-- REMOVING one (gives them full staff access again):
--
--   delete from staff_viewers where email = 'person@example.com';
-- ============================================================
