-- Entry closure and draw randomisation — run in Supabase SQL Editor
-- entries_open defaults to true (new events accept registrations immediately).
-- Set to false to close online entry; the registration form will show "Entries closed".

alter table events add column if not exists entries_open boolean not null default true;
