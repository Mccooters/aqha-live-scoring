-- schema-v24: breed-specific high points (Paint, Appaloosa, ...)
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- The High Points page gains a breed selector: the existing AQHA leaderboards
-- stay exactly as they are, and separate leaderboards can be kept for Paint
-- horses, Appaloosas, and any other breed or colour association. A horse
-- registered with more than one association can hold points on each of its
-- breeds' leaderboards from the same class results.

-- 1) Every existing result becomes an "AQHA" result — nothing changes for
--    the current leaderboards.
alter table high_points add column if not exists breed text not null default 'AQHA';

-- 2) The duplicate-protection rule must now allow the same name/show/season
--    on DIFFERENT breed leaderboards (dual-registered horses).
alter table high_points
  drop constraint if exists high_points_season_category_entity_name_show_name_key;
do $$
begin
  alter table high_points
    add constraint high_points_season_category_entity_show_breed_key
    unique (season, category, entity_name, show_name, breed);
exception when duplicate_table or duplicate_object then null;
end $$;

-- 3) Which breed tabs the High Points page shows (staff can add more from
--    the page itself; requires v22's site_settings table).
insert into site_settings (key, value)
values ('high_points_breeds', '{"list": ["AQHA", "Paint", "Appaloosa"]}'::jsonb)
on conflict (key) do nothing;
