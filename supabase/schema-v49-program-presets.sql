-- schema-v49: shared program presets
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Lets staff save a show's program layout (the class list with section
-- headings, breaks, scoring modes and championship links) as a named preset
-- that every staff login can see and apply to future events from the
-- Program builder page. The preset itself holds no personal data — just
-- class names — so it is readable like the other show tables.

create table if not exists program_presets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  items      jsonb not null default '[]'::jsonb,  -- [{num, name, day, scoring_mode, capacity, hp_category, program_category, program_break_before, program_break_after, champ_feeder_nums, champ_take}]
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table program_presets enable row level security;

do $$ begin
  create policy "read program_presets" on program_presets
    for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff write program_presets" on program_presets
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

grant select on program_presets to anon;
grant select, insert, update, delete on program_presets to authenticated;
grant all on program_presets to service_role;

-- Committee read-only accounts (schema-v48) must not edit presets either.
-- Guarded so this file still runs cleanly if v48 hasn't been applied yet —
-- re-run it after v48 in that case (v48 doesn't know about this table).
do $$
begin
  if to_regprocedure('is_staff_viewer()') is null then return; end if;
  drop policy if exists "viewers cannot insert" on program_presets;
  create policy "viewers cannot insert" on program_presets
    as restrictive for insert to authenticated with check (not is_staff_viewer());
  drop policy if exists "viewers cannot update" on program_presets;
  create policy "viewers cannot update" on program_presets
    as restrictive for update to authenticated using (not is_staff_viewer()) with check (not is_staff_viewer());
  drop policy if exists "viewers cannot delete" on program_presets;
  create policy "viewers cannot delete" on program_presets
    as restrictive for delete to authenticated using (not is_staff_viewer());
end $$;
