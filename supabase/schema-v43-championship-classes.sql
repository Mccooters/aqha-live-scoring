-- schema-v43: championship (Champ & Reserve / Grand Champion) classes
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- A championship class doesn't take normal entries — it's filled with the
-- 1st and 2nd place-getters from its "feeder" classes (e.g. "QH Champ &
-- Reserve Filly/Mare" fills from "QH Filly 2 & 3 years" and "QH Mare 4 yrs
-- & over"). Staff pick the feeders when editing the class (the app suggests
-- them); the draw fills automatically when the last feeder completes.
--
--   champ_feeder_ids - JSON list of the feeder classes' ids. null/empty =
--                      a normal class.
--   champ_take       - who qualifies from each feeder: 'top2' (1st & 2nd,
--                      the default) or 'top1' (winners only — the pending
--                      committee option for GRAND CHAMPION classes).

alter table classes add column if not exists champ_feeder_ids jsonb;
alter table classes add column if not exists champ_take text not null default 'top2';
