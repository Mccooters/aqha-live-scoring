-- AQHA Live Scoring — v18 migration: iPhone app device push tokens
-- The companion iPhone app registers its APNs device token so ordinary push
-- notifications (entries open, show live, results ready — the same ones the
-- website sends) also reach the app. Run in Supabase SQL Editor.

create table if not exists device_push_tokens (
  id           uuid primary key default gen_random_uuid(),
  device_token text not null unique,          -- APNs device token (hex)
  platform     text not null default 'ios',
  created_at   timestamptz default now()
);

-- Not publicly accessible: the app registers tokens through
-- /api/push/register-device (service role) and the send-push edge function
-- reads them with the service role. No anon/authenticated grants.
alter table device_push_tokens enable row level security;
revoke all on device_push_tokens from anon;
revoke all on device_push_tokens from authenticated;
