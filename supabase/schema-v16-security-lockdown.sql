-- AQHA Live Scoring — v16 migration: security lockdown
-- Closes public database access that was wider than the app needs.
-- Run in Supabase SQL Editor. Safe to run more than once.
--
-- IMPORTANT: deploy the matching code update BEFORE running this file —
-- the registration success page and the "Notify me" button now go through
-- the server instead of reading these tables directly. Running this SQL
-- against the OLD code will break those two things until the new code is live.

-- 1) Online registrations: contact names and email addresses were readable
--    by anyone on the internet. Now only signed-in staff can read them.
--    The public success page uses /api/registrations/status instead, keyed
--    by the registration's unguessable ID.
drop policy if exists "public read registrations" on registrations;
drop policy if exists "public read registration_entries" on registration_entries;
revoke select on registrations from anon;
revoke select on registration_entries from anon;

-- 2) Push notification subscriptions: the keys that let someone send
--    notifications straight to a subscriber's phone were publicly readable,
--    and anyone could delete every subscription in one request. Now the
--    table is not publicly accessible at all — the "Notify me" button goes
--    through /api/push/subscribe, and the send-push function (service role)
--    still reads and prunes subscriptions as before.
drop policy if exists "public read push_subscriptions" on push_subscriptions;
drop policy if exists "public insert push_subscriptions" on push_subscriptions;
drop policy if exists "public delete push_subscriptions" on push_subscriptions;
revoke select, insert, update, delete on push_subscriptions from anon;
revoke select, insert, update, delete on push_subscriptions from authenticated;
