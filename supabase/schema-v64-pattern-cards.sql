-- schema-v64: digital judge cards, stage 2 — pattern cards
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
-- Needs schema-v63 (judge cards) first.
--
-- Stage 1 gave judges a placings card and a 70-point scores card. Stage 2
-- adds the PATTERN cards from the club's AQHA score sheets — Trail, Western
-- Riding, Ranch Riding, and Showmanship / Horsemanship / Hunt Seat
-- Equitation — with obstacle / manoeuvre boxes, a content score per box
-- (-1½ … +1½ or -3 … +3), penalties under each box, tie-breaker obstacles
-- and the running total from 70.
--
--   classes.judge_card_type   which card the judge gets: null / 'auto'
--                             (worked out from the class name — "Trail" gets
--                             the Trail card), or one of placings | scores |
--                             trail | western_riding | ranch_riding | pattern3.
--   classes.judge_card_config the obstacle / manoeuvre names and tie-breaker
--                             order, { "boxes": ["Bridge", "Gate", …],
--                             "tiebreak": [3, 4, 5] } (0-based). Typed by
--                             the coordinator on the class, or by the first
--                             judge to set up the card; shared by both judges.
--   judge_cards.layout        the boxes exactly as THAT judge's card had them
--                             when it was signed (a judge may rename a box on
--                             the day), so the card can always be re-read.
-- The per-box marks live inside judge_cards.results (jsonb), one object per
-- horse: { entry_id, back_number, place, score, dq, note,
--          boxes: [{ c: <content>, p: [<penalties>] }], fe, off_pattern }.

alter table classes add column if not exists judge_card_type text;
alter table classes add column if not exists judge_card_config jsonb;
alter table judge_cards add column if not exists layout jsonb;

comment on column classes.judge_card_type is 'Digital judge card for this class: null/auto = from the class name; placings | scores | trail | western_riding | ranch_riding | pattern3';
comment on column classes.judge_card_config is 'Pattern card boxes: {"boxes": [names…], "tiebreak": [0-based box indexes in tie-break order]}';
comment on column judge_cards.layout is 'The boxes as this judge''s card had them when signed';
