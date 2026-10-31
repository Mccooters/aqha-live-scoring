-- schema-v69: sponsors — logos and thank-yous on the website, configured by staff
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Owner's request, Oct 2026: the club sells sponsorship packages (Platinum,
-- Gold, Silver, Bronze, Class/Ribbon, In-Kind — see the sponsorship
-- invitation letter) and the website needs places for the logos. Staff add
-- sponsors from /coordinator/sponsors; the public pages size each sponsor's
-- logo by tier and say "Proudly sponsored by …" on sponsored classes.
--
-- Logos are uploaded into the existing public "patterns" storage bucket
-- (schema-v2) under sponsors/… — same policies, no new bucket needed.

create table if not exists sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tier text not null default 'bronze',   -- platinum | gold | silver | bronze | class | in_kind
  logo_url text,                         -- public URL of the uploaded logo (or any image URL)
  website_url text,                      -- where the logo links to, optional
  blurb text,                            -- one line about the business, optional
  sponsored_for text,                    -- what they sponsor ("Ribbons for the trail classes", "Major award")
  event_id uuid references events(id) on delete set null,  -- null = the whole club (home page + every event)
  class_ids jsonb not null default '[]'::jsonb,            -- sponsored classes (uuid strings) for "Proudly sponsored by"
  active boolean not null default true,  -- switched off = kept but not shown
  sort_order integer not null default 0, -- order within a tier
  created_at timestamptz not null default now()
);
create index if not exists sponsors_event_idx on sponsors (event_id);

alter table sponsors enable row level security;

-- Spectators see sponsors (that is the point); only staff change them.
do $$ begin
  create policy "public read sponsors" on sponsors for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff write sponsors" on sponsors for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

grant select on sponsors to anon;
grant select, insert, update, delete on sponsors to authenticated;
grant all on sponsors to service_role;

-- Committee read-only accounts (schema-v48) can look but not touch. Guarded
-- so this runs before v48 too — re-run after v48 in that case.
do $$
declare t text;
begin
  if to_regprocedure('is_staff_viewer()') is null then return; end if;
  foreach t in array array['sponsors'] loop
    execute format('drop policy if exists "viewers cannot insert" on %I', t);
    execute format('create policy "viewers cannot insert" on %I as restrictive for insert to authenticated with check (not is_staff_viewer())', t);
    execute format('drop policy if exists "viewers cannot update" on %I', t);
    execute format('create policy "viewers cannot update" on %I as restrictive for update to authenticated using (not is_staff_viewer()) with check (not is_staff_viewer())', t);
    execute format('drop policy if exists "viewers cannot delete" on %I', t);
    execute format('create policy "viewers cannot delete" on %I as restrictive for delete to authenticated using (not is_staff_viewer())', t);
  end loop;
end $$;
