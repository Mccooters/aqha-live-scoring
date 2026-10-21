-- schema-v60: website fees ledger + monthly statement
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Owner's decision, Oct 2026: the website fee is no longer taken out of each
-- Square payment (Square's "app fee", which also hid Apple Pay on every
-- checkout). Instead every online payment — Square AND PayPal — adds a line
-- here with the fee it earned, and the staff "Website fees" page turns a
-- month's lines into a statement to bill the club.
--
-- website_fees: one row per online payment (or refund / by-hand adjustment).
-- website_fee_months: whether each month's statement has been billed / paid.

create table if not exists website_fees (
  id uuid primary key default gen_random_uuid(),
  paid_at timestamptz not null default now(),
  provider text not null default 'square',      -- square | paypal | manual (by-hand line)
  payment_id text,                               -- Square payment id / PayPal capture id (null for by-hand lines)
  kind text not null default 'other',            -- entry | balance | membership | raffle | refund | other
  description text not null default '',          -- what the money was for (event / raffle / membership)
  payer_name text,                               -- who paid (staff-only page; never shown publicly)
  event_id uuid references events(id) on delete set null,
  registration_id uuid references registrations(id) on delete set null,
  member_id uuid,                                -- club_members.id (no FK: that table is optional, schema-v23)
  raffle_order_id uuid,                          -- raffle_orders.id (no FK: schema-v56)
  amount_cents integer not null default 0,       -- what the payer paid (negative for a refund / credit)
  percent_bps integer not null default 0,        -- rate used, e.g. 50 = 0.5%
  percent_fee_cents integer not null default 0,
  flat_fee_cents integer not null default 0,     -- the once-per-person-per-event flat part
  fee_cents integer not null default 0,          -- percent_fee_cents + flat_fee_cents (negative for a credit)
  note text,
  added_by text,                                 -- staff email for by-hand lines
  created_at timestamptz not null default now()
);

-- A provider retry (webhook redelivery) must never add the same payment
-- twice. By-hand lines have no payment id, so any number of them is fine.
create unique index if not exists website_fees_payment_idx on website_fees (provider, payment_id);
create index if not exists website_fees_paid_at_idx on website_fees (paid_at);

create table if not exists website_fee_months (
  month text primary key,                        -- 'YYYY-MM' (Sydney time)
  status text not null default 'open',           -- open | billed | paid
  billed_at timestamptz,
  paid_at timestamptz,
  note text,                                     -- e.g. invoice number
  updated_at timestamptz not null default now()
);

alter table website_fees       enable row level security;
alter table website_fee_months enable row level security;

-- Staff only (names + money). No public access at all. The settlement code
-- writes with the service role.
do $$ begin
  create policy "staff read website_fees" on website_fees for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff write website_fees" on website_fees for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff read website_fee_months" on website_fee_months for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff write website_fee_months" on website_fee_months for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

grant select, insert, update, delete on website_fees to authenticated;
grant all on website_fees to service_role;
grant select, insert, update, delete on website_fee_months to authenticated;
grant all on website_fee_months to service_role;

-- Committee read-only accounts (schema-v48) can look but not touch. Guarded
-- so this runs before v48 too — re-run after v48 in that case.
do $$
declare t text;
begin
  if to_regprocedure('is_staff_viewer()') is null then return; end if;
  foreach t in array array['website_fees', 'website_fee_months'] loop
    execute format('drop policy if exists "viewers cannot insert" on %I', t);
    execute format('create policy "viewers cannot insert" on %I as restrictive for insert to authenticated with check (not is_staff_viewer())', t);
    execute format('drop policy if exists "viewers cannot update" on %I', t);
    execute format('create policy "viewers cannot update" on %I as restrictive for update to authenticated using (not is_staff_viewer()) with check (not is_staff_viewer())', t);
    execute format('drop policy if exists "viewers cannot delete" on %I', t);
    execute format('create policy "viewers cannot delete" on %I as restrictive for delete to authenticated using (not is_staff_viewer())', t);
  end loop;
end $$;
