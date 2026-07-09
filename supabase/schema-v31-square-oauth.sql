-- schema-v31: Square OAuth connection (for the developer fee split)
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Payments can run through a Square *application* (OAuth) instead of the
-- club's own access token. The club authorises the app once from the
-- coordinator Registrations page; the tokens Square hands back live here.
-- With that connection in place, each checkout can carry a small application
-- fee (SQUARE_APP_FEE_BPS, e.g. 50 = 0.5%) that Square pays to the account
-- that owns the application — the developer — automatically.
--
-- These tokens can create payments, so this table is locked down exactly
-- like member_sessions: no browser role can touch it, service role only.

create table if not exists square_connection (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   text not null unique,     -- the club's Square merchant id
  access_token  text not null,            -- OAuth access token (expires ~30 days)
  refresh_token text,                     -- used to mint a fresh access token
  expires_at    timestamptz,              -- when access_token stops working
  connected_at  timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table square_connection enable row level security;

revoke all on square_connection from anon;
revoke all on square_connection from authenticated;
grant select, insert, update, delete on square_connection to service_role;
