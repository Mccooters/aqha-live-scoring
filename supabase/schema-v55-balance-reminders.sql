-- schema-v55: balance reminder emails
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Clinic deposit plans leave a balance owing. Staff can email everyone owing
-- a reminder (with the link to pay) from the Registrations page, and a clinic
-- can be set to send them automatically on chosen days before it starts.
-- Each registration keeps a log of every reminder sent and when the last one
-- went, so the page can show "Last reminder: 3 Oct (auto)".

alter table registrations add column if not exists balance_reminder_log jsonb not null default '[]'::jsonb;
alter table registrations add column if not exists balance_reminder_last_at timestamptz;
-- Days before the clinic to send automatic reminders, e.g. [14, 7, 3].
-- null / empty = automatic reminders off for that event.
alter table events add column if not exists balance_reminder_days jsonb;
