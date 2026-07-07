-- schema-v25: member accounts (self-service portal at /account)
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
-- Run v23 (club memberships) first — this builds on it.
--
-- Lets members sign in with a 6-digit code emailed to them, then see and
-- update their own contact details, the people covered by their membership
-- (e.g. a Family membership's 2 adults + 2 children) and their horses.
--
-- IMPORTANT — why members do NOT get normal (Supabase auth) logins:
-- every database rule in this app treats "any signed-in user" as staff, with
-- full write access to everything. Members must therefore never become
-- Supabase auth users. Instead the app manages its own member sessions:
-- the emailed code proves they own the email address on their membership
-- application, and a session row below keeps them signed in. The three new
-- auth tables are reachable ONLY through the server (service role) — the
-- public and even signed-in staff browsers cannot touch them directly.

-- 1) Member accounts — one row per member login (keyed by email, stored
--    lowercase so matching is simple). A password is optional: members can
--    always sign in with an emailed code, and may set a password from the
--    portal to skip the email step (the code doubles as "forgot password").
create table if not exists member_accounts (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,     -- always stored lowercase
  password_hash text,                     -- scrypt hash; null = no password set
  password_failed_attempts integer not null default 0,
  password_locked_until    timestamptz,   -- set after too many wrong guesses
  created_at    timestamptz default now(),
  last_login_at timestamptz
);
-- If an earlier copy of this file was already run, add the password fields.
alter table member_accounts add column if not exists password_hash text;
alter table member_accounts add column if not exists password_failed_attempts integer not null default 0;
alter table member_accounts add column if not exists password_locked_until timestamptz;
alter table member_accounts enable row level security;
revoke all on member_accounts from anon;
revoke all on member_accounts from authenticated;
grant select, insert, update, delete on member_accounts to service_role;

-- 2) Sign-in codes — the 6-digit code we email. One live code per address;
--    expires after ~10 minutes; only a hash of the code is stored.
create table if not exists member_login_codes (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,        -- lowercase
  code_hash  text not null,               -- sha256 of the 6-digit code
  expires_at timestamptz not null,
  attempts   integer not null default 0,  -- wrong guesses (max 5, then a new code is needed)
  created_at timestamptz default now()    -- also drives the 60-second resend cooldown
);
alter table member_login_codes enable row level security;
revoke all on member_login_codes from anon;
revoke all on member_login_codes from authenticated;
grant select, insert, update, delete on member_login_codes to service_role;

-- 3) Sessions — keeps a member signed in for ~90 days. The browser cookie
--    holds a random token; only its hash is stored here.
create table if not exists member_sessions (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references member_accounts(id) on delete cascade,
  token_hash text not null unique,        -- sha256 of the cookie token
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
create index if not exists member_sessions_account_idx on member_sessions (account_id);
alter table member_sessions enable row level security;
revoke all on member_sessions from anon;
revoke all on member_sessions from authenticated;
grant select, insert, update, delete on member_sessions to service_role;

-- 4) People covered by a membership — the applicant themselves is the
--    member_name on club_members and is NOT duplicated here; these are the
--    extra people (e.g. the rest of a family). Staff-readable like
--    club_member_horses; members reach their own rows through the server.
create table if not exists club_member_people (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references club_members(id) on delete cascade,
  name        text not null,
  person_type text not null default 'adult',   -- 'adult' | 'child'
  sort_order  integer not null default 0,
  created_at  timestamptz default now()
);
create index if not exists club_member_people_member_idx on club_member_people (member_id);

alter table club_member_people enable row level security;

drop policy if exists "staff read club_member_people" on club_member_people;
create policy "staff read club_member_people"
  on club_member_people for select to authenticated using (true);

drop policy if exists "staff write club_member_people" on club_member_people;
create policy "staff write club_member_people"
  on club_member_people for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on club_member_people to authenticated;
revoke select, insert, update, delete on club_member_people from anon;
grant select, insert, update, delete on club_member_people to service_role;

-- 5) How many people a membership covers (including the applicant).
--    Editable per type on the coordinator Memberships page; snapshotted onto
--    each application (like membership_type_name) so renaming or deleting a
--    type never changes what an existing membership covers.
alter table membership_types add column if not exists included_people integer not null default 1;
alter table club_members     add column if not exists included_people integer;

-- Family Membership is "2 adults, 2 children" = 4 people. Only touches the
-- row if it's still at the default, so re-running never undoes staff edits.
update membership_types set included_people = 4
  where name = 'Family Membership' and included_people = 1;

-- 6) Live updates: member edits to people/horses show up on the coordinator
--    Memberships page without a refresh.
do $$
begin
  alter publication supabase_realtime add table club_member_people;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table club_member_horses;
exception when duplicate_object then null;
end $$;
