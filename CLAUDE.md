# CLAUDE.md — AQHA Live Scoring

## What this project is

A live scoring web app for Australian Quarter Horse Association (AQHA) shows,
built for a show coordinator in NSW, Australia. Spectators watch live scoring,
the current draw, and scratches in real time on their phones; coordinators run
the whole show from a protected dashboard. The deployed app is branded
"HCQHA Live Scoring" (Hunter Coast Quarter Horse Association, an AQHA-affiliated
club) — `app/layout.js` metadata and the home page header both say HCQHA.

The owner of this project is the show coordinator and is NOT a developer —
explain changes in plain language, avoid jargon, and never assume knowledge of
git, terminals, or programming. Prefer making changes directly and opening a
PR with a clear plain-English description.

## Stack & architecture

- **Next.js 14 (App Router, JavaScript, no TypeScript)** — deployed on Vercel,
  auto-deploys from the main branch of this GitHub repo.
- **Supabase** — Postgres database, auth, realtime, and storage. Most pages
  are `"use client"` and talk to Supabase directly from the browser via
  `lib/supabaseClient.js` using `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **Thin server layer (`app/api/`)** — exists only for the few things that
  must run server-side: creating/validating online registrations, the Square
  payment webhook, and a manual "force-approve" route. These use a
  service-role admin client (`app/api/_lib/registrations.js`,
  `SUPABASE_SERVICE_ROLE_KEY`) that bypasses RLS. Everything else stays
  client-side with the anon key.
- **Security model**: Row Level Security — anyone can read (spectators need no
  account); only authenticated users (show staff, created manually in the
  Supabase dashboard under Authentication → Users) can write. API routes use
  the service-role key intentionally to write on behalf of unauthenticated
  exhibitors (online registration).
- **Realtime**: pages subscribe to postgres_changes on the tables they care
  about (`entries`, `classes`, `events`, `registrations`, `horses`,
  `horse_registrations`, `high_points`) and simply re-fetch on any change.
- **Payments (Square)** — `app/api/registrations/create/route.js` creates a
  Square Payment Link (online-checkout) for paid class entry fees; the
  webhook (`app/api/webhooks/square/route.js`) verifies the HMAC signature
  and approves the registration when `payment.updated` reports COMPLETED.
  Free events (entry fee $0) skip Square entirely and auto-approve. Env vars:
  `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT`
  (sandbox|production), `SQUARE_WEBHOOK_SIGNATURE_KEY`, `NEXT_PUBLIC_BASE_URL`.
- **Push notifications** — full web-push stack: `public/sw.js` (service
  worker), Supabase Edge Function `supabase/functions/send-push` (Deno +
  `web-push`, VAPID keys as function secrets), `push_subscriptions` table,
  and an opt-in "Notify me" button on the spectator page
  (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`). The coordinator dashboard's
  `triggerPush()` helper calls the edge function on score saves, scratches,
  and "now showing" changes. iPhone requires the site added to Home Screen.
- **Styling**: plain CSS in `app/globals.css` with CSS variables. Western
  show-program aesthetic: paper #FBF8F2, leather #3A2A1C, brass #A8843C,
  clay #C24A2E. Fonts: Zilla Slab (display) + Archivo (body) via Google Fonts.
  Keep this look — do not switch to Tailwind or a component library.
- **Global nav**: `app/components/BottomNav.js` — sticky bar on every page
  (Events / High Pts / Registry / Staff), rendered from `app/layout.js`.

## Pages

- `app/page.js` — public home: list of events (status badge per the
  lifecycle below) + archived events collapsed in a `<details>`. Links to
  Schedule (closed/live/completed events) and Register (open events).
- `app/event/[id]/page.js` — public spectator view: live "now showing" banner
  (current horse, draw position X of Y excluding scratches, progress bar),
  per-class scoreboards (placed by score desc, pending in draw order, SCR rows
  struck through), pattern link if `classes.pattern_url` is set, push
  notification opt-in. For `event_type = "clinic"` events this renders a
  completely different registration-focused view instead (see Clinics below).
- `app/event/[id]/schedule/page.js` — public class-by-class run sheet,
  grouped by `classes.day` for multi-day shows, with live progress bars.
- `app/event/[id]/register/page.js` — public online entry form. Lets
  exhibitors pick classes, fills back number/horse/exhibitor (or just a name
  for clinics), shows remaining spots per class, calculates the total entry
  fee, and submits to `app/api/registrations/create`. Disables/hides classes
  that are full; shows "Sold out" if every class is full.
- `app/event/[id]/register/success/page.js` — post-checkout confirmation;
  polls the registration every 2s (up to 15 times) until the Square webhook
  marks it paid, then shows the confirmed entries.
- `app/coordinator/page.js` — staff only (Supabase email/password auth): the
  main run-the-show dashboard. Create events/classes/entries, score the
  current entry (auto-advances; auto-completes class and promotes the next
  one), scratch/restore entries, reorder pending draw, reorder upcoming
  classes, start/complete classes, revert event status, Excel import/export,
  pattern upload, link to registry/registrations, "End event"/"Archive".
- `app/coordinator/registrations/page.js` — list of online registrations for
  an event (paid vs pending, revenue total, entry count), expandable per
  registration, with a "force-create entries" button for when a Square
  payment was confirmed manually but the webhook didn't fire.
- `app/coordinator/ImportEntries.js` — bulk import from .xlsx/.csv via SheetJS.
  Forgiving header mapping (e.g. "Back No"/"back#" both work; "Rider"/"Shown
  By" map to exhibitor). Preview-before-commit; creates missing classes when
  a Class Name is provided; skips bad rows with warnings. Template for
  secretaries: `entry-import-template.xlsx` in repo root.
- `app/coordinator/ImportClasses.js` — bulk class-list import (no entries,
  just classes) so exhibitors have something to pick from when registering
  online before the secretary has full draw data. Maps a "Type" column to
  scoring mode, including the two TBC variants.
- `app/registry/page.js` — permanent registry, two tabs: **Horses** (public
  read, staff edit, back number permanent for life, multi-club registrations,
  bulk import) and **Riders** (public read, staff edit — name, member number,
  category, notes).
- `app/highpoints/page.js` — season high-points leaderboard, separate for
  horses and riders, category tabs, CSV import matching the club's existing
  spreadsheet format (season detected from the title row), manual add/edit/
  delete for staff. Self-service "create this table" instructions shown if
  the `high_points` table/migration hasn't been run yet.

## Database (supabase/schema.sql + migrations schema-v2 … schema-v12)

- `events` — name, location, starts_on, ends_on, **status**: see Event
  lifecycle below, entry_fee_cents (per-class fee for online registration),
  event_type: `show` | `clinic`, entries_open (legacy boolean, superseded by
  status, kept for backwards compatibility but unused).
- `classes` — event_id, num, name, judge, judge2 (optional second judge),
  status: upcoming|live|completed, sort_order, pattern_url, day (multi-day
  shows, default 1), scoring_mode (see Scoring modes below), capacity
  (spot limit for online registration — null = unlimited).
- `entries` — class_id, back_number, horse, exhibitor, draw_order, score,
  score2 (second judge's independent score), scratched bool, called bool
  (TBC draw mode — see below). "Current" entry of a live class = first entry
  by draw_order that's still pending for the class's scoring mode (no stored
  pointer — derived by `firstPending()`).
- `horses` (back_number UNIQUE — permanent for life, name, owner) +
  `horse_registrations` (horse_id, club, registration_number). A horse can be
  registered with multiple clubs (e.g. AQHA + PHAA Paint) and earns points
  with EACH club from the same class/placing.
- `riders` — name, member_number, category (Amateur/Novice Amateur/Select/
  Beginner/Youth/EWD/Leadline/Non Pro/Open), notes. Independent of horses.
- `high_points` — season, category, entity_type (horse|rider), entity_name,
  show_name, points. Unique on (season, category, entity_name, show_name).
- `registrations` — event_id, contact_name, contact_email, status
  (pending|paid|cancelled), square_order_id/checkout_url/payment_id,
  total_cents.
- `registration_entries` — registration_id (cascade delete), class_id
  (cascade delete — schema-v10), back_number (nullable — clinics auto-assign
  sequentially on approval), horse_name, exhibitor.
- `push_subscriptions` — endpoint (unique), p256dh, auth_key. Anyone can
  insert/delete/read their own (no auth required to subscribe).
- Storage bucket `patterns` (public read, staff write) for uploaded pattern
  files; `classes.pattern_url` holds the resulting public URL.

## Event lifecycle (schema-v9)

`events.status`: `pre_open` → `open` → `closed` → `live` → `completed` →
`archived`.

- **pre_open** — coordinator is setting up; not visible for entry.
- **open** — online registration form is live; exhibitors can submit entries.
- **closed** — entries closed, draw being finalised before the show.
- **live** — show is happening now; live scoring active.
- **completed** — show finished, results viewable.
- **archived** — hidden from the public home page; results still reachable
  via direct URL.

Revert buttons exist for accidental clicks: "← Back to pre-open" (from open)
and "← Back to closed" (from live, with a confirm dialog noting scoring in
progress isn't affected). `closed` can also move forward to `open` (reopen
entries) or `live` (start the show) without reverting.

## Scoring modes (`classes.scoring_mode`)

- **score** — 70-point scale, one horse at a time, live draw.
- **placing** — 1st/2nd/3rd etc, one horse at a time, live draw.
- **class_only** — everyone in the ring together, no live draw; placings
  entered after the class.
- **tbc** ("TBC draw") — horses go one at a time and the draw is visible live
  (uses `entries.called` to track who's been through the ring), but no score
  is entered live — results come from the judge's paperwork afterwards.
- **tbc_class** ("TBC whole class") — everyone in the ring together, no live
  draw, AND results come from paperwork later (the original single `tbc`
  mode before it was split).

`firstPending(entries, mode)` is mode-aware: `tbc` checks `!called`, every
other mode checks `score == null`. This logic is duplicated (intentionally,
no shared package) across `app/coordinator/page.js` and
`app/event/[id]/page.js` — keep both in sync when changing it.

## Clinics (`events.event_type = "clinic"`)

Added so the same app can run clinics with a capacity-limited spot count
(e.g. "Rider spots" and "Fence sitting" as two separate classes/spot-types,
each with its own `capacity`) instead of a normal scored show.

- Coordinator UI hides Start/Complete/Pattern/scoring-mode/reorder controls
  for clinic classes; "+ Add class" becomes "+ Add spot type", "+ Participant"
  replaces "+ Entry". Back numbers are auto-assigned sequentially and hidden
  from the UI entirely (participants don't need one).
- Public event page shows a registration-only view (no live scoring banner)
  with per-spot-type availability, "Sold out"/"Closed"/"Coming soon" states.
- Capacity is enforced server-side in `app/api/registrations/create/route.js`
  by counting non-scratched `entries` rows against `classes.capacity` —
  there's a small race window under simultaneous submissions right at the
  capacity limit, accepted as a reasonable tradeoff at clinic-sized capacities.

## Online registration & payments

Exhibitors register via `/event/[id]/register` while an event is `open`.
Submission goes to `app/api/registrations/create`, which: validates the
event is open, capacity-checks every requested class, writes a `pending`
`registrations` row + `registration_entries`, and then either auto-approves
immediately (free entry) or creates a Square Payment Link and redirects to
checkout. `approveRegistration()` (`app/api/_lib/registrations.js`) is the
single place that turns `registration_entries` into real `entries` rows —
called from the webhook, the free-entry path, and the coordinator's manual
force-approve button. It assigns `draw_order` after the current max per
class, and auto-assigns sequential `back_number` for clinic entries that
came in with `back_number = null`.

## Domain rules (from the AQHA Australia rule book, 2024 edition)

- Scored classes commonly use a 60–80 scale with 70 = average (e.g. boxing /
  working cow horse) or reining-style scoring from a base of 70 ("0 to
  infinity"), manoeuvres scored +3 to -3 in HALF-POINT increments. Score
  inputs must accept halves (step 0.5). A score of 0 = incomplete work.
- Many classes are placings-based; points are allocated per the rule book's
  point scale based on placing AND number of entries in the class — this is
  why the export includes an "Entries in Class" column. Current formula in
  `calcPoints()` (`app/coordinator/page.js`): `max(0, entries - placing)` —
  flagged in-code to verify against the current rule book before relying on it.
- Points go to approved bodies as "A" or "B" type points; dual-registered
  horses submit to each association separately.
- Pattern classes (trail, showmanship, horsemanship, western riding, reining)
  need patterns posted BEFORE the class — patterns should be visible on
  upcoming classes as soon as uploaded.
- Rail classes (western pleasure) have no pattern.
- Vocabulary: exhibitor (not "rider" in halter/showmanship), back number,
  draw order, scratch (SCR), go-rounds, ROM, high point.
- Full rule book text is at docs/aqha-rule-book-2024.txt — search it when implementing any scoring or points logic.

## Results export ("⇩ Export results", SheetJS, client-side)

Workbook sheets: **Event** (meta + export timestamp), **Results** (every class:
placing, back, horse, exhibitor, score(s), SCR rows, registrations string),
**Club Points** (one row per placing PER club registration, with calculated
points via `calcPoints()` — for two-judge classes, each judge's placings are
exported as independent rows since they are never combined). This is the
sheet used to submit points to each association.

## Conventions

- Permanent records: never delete events/classes/entries/scores. "End event"
  only flips status to completed; "Archive" only hides from the home page.
- Client-side Supabase calls are the default for everything; only reach for
  an `app/api/` route when the action must run with elevated privileges
  (service-role key) or call a third-party API (Square).
- Mobile-first: coordinators score from a phone at the arena gate.
- pip-style draw counters exclude scratched entries everywhere, and are
  mode-aware for TBC draw classes (counting `called` rather than `score`).

## Roadmap

The original roadmap (point allocation, push notifications, pattern uploads,
proper forms instead of `prompt()`, registry bulk import, event schedule
page) has all shipped — see the relevant sections above. No open backlog
items are currently agreed with the owner; check with them for what's next
before starting speculative work.
