-- schema-v56: raffles (fundraising) — separate from shows/clinics
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- A raffle has a fixed number of tickets (e.g. 100). Buyers open the public
-- raffle page, see the prizes, pick the numbers they want, and pay by card
-- through Square. Staff run it from /coordinator/raffles and draw the
-- winners with a verifiable random draw (see raffle_secrets).

create table if not exists raffles (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  description        text,
  prizes             jsonb not null default '[]'::jsonb,   -- [{title, detail}]
  ticket_price_cents integer not null default 500,
  ticket_count       integer not null default 100,
  status             text not null default 'draft',        -- draft | open | closed | drawn
  draw_date          text,                                 -- free text shown to buyers
  seed_hash          text,                                 -- sha256 of the secret seed, published BEFORE the draw
  seed_revealed      text,                                 -- the seed itself, published AFTER the draw
  drawn_at           timestamptz,
  draw_salt          text,                                 -- the draw moment's unpredictable salt, published with results
  draw_results       jsonb,                                -- [{prize_index, prize, number, buyer_name}]
  created_at         timestamptz default now()
);

-- The secret seed lives apart from the public raffle row: service role only.
create table if not exists raffle_secrets (
  raffle_id uuid primary key references raffles(id) on delete cascade,
  seed      text not null
);

create table if not exists raffle_orders (
  id                  uuid primary key default gen_random_uuid(),
  raffle_id           uuid not null references raffles(id) on delete cascade,
  buyer_name          text not null,
  buyer_email         text,
  buyer_phone         text,
  numbers             jsonb not null default '[]'::jsonb,
  total_cents         integer not null default 0,
  status              text not null default 'pending',     -- pending | paid | cancelled | expired
  method              text not null default 'square',      -- square | manual (cash / transfer recorded by staff)
  square_order_id     text,
  square_checkout_url text,
  square_payment_id   text,
  created_at          timestamptz default now(),
  paid_at             timestamptz
);
create index if not exists raffle_orders_raffle_idx on raffle_orders (raffle_id);
create index if not exists raffle_orders_square_idx on raffle_orders (square_order_id);

create table if not exists raffle_tickets (
  id          uuid primary key default gen_random_uuid(),
  raffle_id   uuid not null references raffles(id) on delete cascade,
  number      integer not null,
  order_id    uuid references raffle_orders(id) on delete cascade,
  status      text not null default 'reserved',             -- reserved | sold
  buyer_name  text,
  reserved_at timestamptz default now(),
  unique (raffle_id, number)                                 -- the referee for two people picking the same number
);
create index if not exists raffle_tickets_order_idx on raffle_tickets (order_id);

alter table raffles        enable row level security;
alter table raffle_secrets enable row level security;
alter table raffle_orders  enable row level security;
alter table raffle_tickets enable row level security;

-- Public can read raffles (prizes, price, status, results). Tickets and
-- orders hold names/emails: staff only — the public page gets the taken
-- numbers through /api/raffle/[id]/numbers. Secrets: service role only.
do $$ begin
  create policy "public read raffles" on raffles for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff write raffles" on raffles for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff read raffle_orders" on raffle_orders for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff write raffle_orders" on raffle_orders for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff read raffle_tickets" on raffle_tickets for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff write raffle_tickets" on raffle_tickets for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

grant select on raffles to anon;
grant select, insert, update, delete on raffles to authenticated;
grant all on raffles to service_role;
grant select, insert, update, delete on raffle_orders to authenticated;
grant all on raffle_orders to service_role;
grant select, insert, update, delete on raffle_tickets to authenticated;
grant all on raffle_tickets to service_role;
grant all on raffle_secrets to service_role;

-- Committee read-only accounts (schema-v48) can look but not touch. Guarded
-- so this runs before v48 too — re-run after v48 in that case.
do $$
declare t text;
begin
  if to_regprocedure('is_staff_viewer()') is null then return; end if;
  foreach t in array array['raffles', 'raffle_orders', 'raffle_tickets'] loop
    execute format('drop policy if exists "viewers cannot insert" on %I', t);
    execute format('create policy "viewers cannot insert" on %I as restrictive for insert to authenticated with check (not is_staff_viewer())', t);
    execute format('drop policy if exists "viewers cannot update" on %I', t);
    execute format('create policy "viewers cannot update" on %I as restrictive for update to authenticated using (not is_staff_viewer()) with check (not is_staff_viewer())', t);
    execute format('drop policy if exists "viewers cannot delete" on %I', t);
    execute format('create policy "viewers cannot delete" on %I as restrictive for delete to authenticated using (not is_staff_viewer())', t);
  end loop;
end $$;
