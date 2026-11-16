-- schema-v70: names removed from a High Points leaderboard stay removed
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Owner's report, Nov 2026: horses that left, or that were accidentally
-- entered twice, couldn't be taken off the leaderboard — the ✕ deleted their
-- points, but the next "Push all HP" from the dashboard rebuilt them from the
-- class results. A name in this list (per season + category) is skipped by
-- every push until staff press Restore on the High Points page.

create table if not exists high_points_removed (
  id uuid primary key default gen_random_uuid(),
  season text not null,
  category text not null,
  entity_name text not null,          -- as shown on the leaderboard, e.g. "SC Seekretz (Paint)"
  removed_by text,                    -- staff email
  created_at timestamptz not null default now()
);
create unique index if not exists high_points_removed_one_per_name
  on high_points_removed (season, category, lower(entity_name));

alter table high_points_removed enable row level security;

-- Staff only (the public leaderboard simply doesn't show removed names).
do $$ begin
  create policy "staff read high_points_removed" on high_points_removed for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff write high_points_removed" on high_points_removed for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

grant select, insert, update, delete on high_points_removed to authenticated;
grant all on high_points_removed to service_role;

-- Committee read-only accounts (schema-v48) can look but not touch. Guarded
-- so this runs before v48 too — re-run after v48 in that case.
do $$
declare t text;
begin
  if to_regprocedure('is_staff_viewer()') is null then return; end if;
  foreach t in array array['high_points_removed'] loop
    execute format('drop policy if exists "viewers cannot insert" on %I', t);
    execute format('create policy "viewers cannot insert" on %I as restrictive for insert to authenticated with check (not is_staff_viewer())', t);
    execute format('drop policy if exists "viewers cannot update" on %I', t);
    execute format('create policy "viewers cannot update" on %I as restrictive for update to authenticated using (not is_staff_viewer()) with check (not is_staff_viewer())', t);
    execute format('drop policy if exists "viewers cannot delete" on %I', t);
    execute format('create policy "viewers cannot delete" on %I as restrictive for delete to authenticated using (not is_staff_viewer())', t);
  end loop;
end $$;
