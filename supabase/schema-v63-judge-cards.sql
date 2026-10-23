-- schema-v63: digital judge cards (stage 1)
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Judges score on their own phone or tablet instead of paper. The coordinator
-- shares one private link per judge per event (like the gate marshal link);
-- the judge's device downloads the show, works with no reception, and sends
-- each signed card when a signal returns. A signed card writes that judge's
-- column on the entries (score / score2) exactly as typing it in would, and
-- closes the class once every judge has signed.
--
-- Three pieces:
--   1) judge_codes   — the per-judge link secret. NEVER on the public events
--                      table: staff + service role only, no anon access.
--   2) judge_cards   — one row per class per judge: what the judge sent (the
--                      placings / scores and notes), when, from which device,
--                      and whether staff have unlocked it for a correction.
--                      Staff read (dashboard shows "sent / waiting"); the
--                      judge route writes with the service role.
--   3) events.judge_entry_mode — 'judge' (judges tap their own device) or
--                      'scribe' (a scribe enters for the judge and signs with
--                      their own name). Chosen per event.

create table if not exists judge_codes (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events(id) on delete cascade,
  judge_name   text not null,                -- matches classes.judge / judge2 (trimmed, case-insensitive)
  code         text not null unique,         -- long crypto-random token; the link IS the key
  revoked      boolean not null default false,
  last_seen_at timestamptz,
  created_at   timestamptz default now(),
  unique (event_id, judge_name)
);

alter table judge_codes enable row level security;

drop policy if exists "staff manage judge_codes" on judge_codes;
create policy "staff manage judge_codes" on judge_codes
  for all to authenticated using (true) with check (true);

revoke all on judge_codes from anon;
grant all on judge_codes to authenticated;
grant all on judge_codes to service_role;

create table if not exists judge_cards (
  id          uuid primary key,                 -- generated on the judge's device, so a re-send never duplicates
  class_id    uuid not null references classes(id) on delete cascade,
  judge_slot  integer not null check (judge_slot in (1, 2)),  -- 1 = classes.judge (score), 2 = classes.judge2 (score2)
  judge_name  text not null,
  card_type   text not null default 'placings', -- 'placings' | 'scores'
  status      text not null default 'signed',   -- 'signed' | 'unlocked' (staff let the judge correct it)
  results     jsonb not null default '[]'::jsonb, -- [{entry_id, back_number, place, score, dq, note}]
  notes       text,
  entered_by  text,                              -- scribe's name when a scribe entered for the judge
  device_id   text,
  version     integer not null default 1,
  signed_at   timestamptz,
  received_at timestamptz default now(),
  unlocked_at timestamptz,
  unlocked_by text,
  unique (class_id, judge_slot)
);

alter table judge_cards enable row level security;

drop policy if exists "staff manage judge_cards" on judge_cards;
create policy "staff manage judge_cards" on judge_cards
  for all to authenticated using (true) with check (true);

revoke all on judge_cards from anon;
grant all on judge_cards to authenticated;
grant all on judge_cards to service_role;

-- Live "sent / waiting" on the dashboard.
do $$
begin
  alter publication supabase_realtime add table judge_cards;
exception when duplicate_object then null;
end $$;

alter table events add column if not exists judge_entry_mode text not null default 'judge';

-- Committee read-only logins (schema-v48) must not write here either.
do $$
declare t text;
begin
  if to_regprocedure('is_staff_viewer()') is null then return; end if;
  foreach t in array array['judge_codes', 'judge_cards'] loop
    execute format('drop policy if exists "viewers cannot insert" on %I', t);
    execute format('create policy "viewers cannot insert" on %I as restrictive for insert to authenticated with check (not is_staff_viewer())', t);
    execute format('drop policy if exists "viewers cannot update" on %I', t);
    execute format('create policy "viewers cannot update" on %I as restrictive for update to authenticated using (not is_staff_viewer()) with check (not is_staff_viewer())', t);
    execute format('drop policy if exists "viewers cannot delete" on %I', t);
    execute format('create policy "viewers cannot delete" on %I as restrictive for delete to authenticated using (not is_staff_viewer())', t);
  end loop;
end $$;
