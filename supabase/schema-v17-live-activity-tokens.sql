-- AQHA Live Scoring — v17 migration: iPhone Live Activity tokens
-- Backend support for the companion iPhone app's Lock Screen / Dynamic Island
-- "Live Activity". Each running activity on a phone registers a push token so
-- the server can push it live updates. Run in Supabase SQL Editor.

create table if not exists live_activity_tokens (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid references events(id) on delete cascade,
  push_token    text not null unique,             -- per-activity APNs update token
  activity_kind text not null default 'update',   -- 'update' (running) | 'start' (push-to-start, iOS 17.2+)
  created_at    timestamptz default now()
);

-- Not publicly accessible: the app registers tokens through
-- /api/live-activity/register (service role) and the send-live-activity
-- edge function reads them with the service role. No anon/authenticated grants.
alter table live_activity_tokens enable row level security;
revoke all on live_activity_tokens from anon;
revoke all on live_activity_tokens from authenticated;
