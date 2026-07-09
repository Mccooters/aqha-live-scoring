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
  payment webhook, a manual "force-approve" route (staff JWT required — the
  route verifies the caller's Supabase token via `auth.getUser()`), a
  registration status lookup for the success page, and a push-subscribe
  route. These use a service-role admin client
  (`app/api/_lib/registrations.js`, `SUPABASE_SERVICE_ROLE_KEY`) that
  bypasses RLS. Everything else stays client-side with the anon key.
- **Security model**: Row Level Security — anyone can read the *show* tables
  (spectators need no account); only authenticated users (show staff, created
  manually in the Supabase dashboard under Authentication → Users) can write.
  Exceptions (schema-v16): `registrations`/`registration_entries` are
  staff-read-only (they hold names + emails; the public success page goes
  through `app/api/registrations/status`), and `push_subscriptions` is not
  publicly accessible at all (subscribe goes through `app/api/push/subscribe`).
  API routes use the service-role key intentionally to act on behalf of
  unauthenticated exhibitors. Public sign-ups should stay disabled in the
  Supabase dashboard — any authenticated user can write.
- **Member accounts (schema-v25)** — the `/account` member portal. CRITICAL
  INVARIANT: members are never Supabase auth users (see the security model
  above — any authenticated user has staff-wide write). Member sessions are
  app-managed instead: a 6-digit code emailed via Resend
  (`sendLoginCodeEmail`) proves email ownership → a `member_sessions` row +
  httpOnly `member_session` cookie (90 days; the cookie holds a random token,
  the DB only its sha256 hash; codes are also stored hashed, single-use,
  10-min expiry, 5 attempts, 60s resend cooldown). An optional **password**
  (set from the portal once signed in) is a second way to earn the same
  session: scrypt-hashed via `app/api/_lib/passwords.js` (Node built-in, no
  dependency), locked for 15 min after 10 wrong guesses. The emailed code
  always works and clears the lock — it IS the forgot-password flow, so
  there is no separate reset path. All `app/api/account/*`
  routes (`app/api/_lib/memberAuth.js`) verify the cookie, then use the
  service-role client, scoping every query to `club_members` rows whose
  email matches the account (ilike, wildcards escaped — the same email-as-
  identity rule as `hasCurrentMembership`). Known looseness, accepted: a
  staff member manually adding a member with someone's email hands those
  rows to that email's login. Ownership failures return 404, request-code
  always returns ok (no email enumeration).
- **Realtime**: pages subscribe to postgres_changes on the tables they care
  about (`entries`, `classes`, `events`, `registrations`, `horses`,
  `horse_registrations`, `high_points`) and simply re-fetch on any change.
- **Payments (Square)** — all payment links are created through
  `app/api/_lib/squarePayments.js` (`createSquarePaymentLink()`), which picks
  its credentials in this order: (1) the club's OAuth connection
  (schema-v31 `square_connection` table, service-role only — created via the
  "Connect Square" button on the coordinator Registrations page, routes under
  `app/api/square/`: connect [staff JWT] → Square authorize → callback
  [state-cookie CSRF check] stores access/refresh tokens; access tokens are
  auto-refreshed when <3 days from expiry), else (2) the club's own
  `SQUARE_ACCESS_TOKEN` env var — the original setup and permanent fallback,
  so payments never break if the connection is absent. When the OAuth
  connection is in use AND `SQUARE_APP_FEE_BPS` is set (e.g. 50 = 0.5%), each
  checkout carries `checkout_options.app_fee_money` — Square automatically
  pays that slice to the Square account that OWNS the OAuth application (the
  developer's), per Square's app-fee model (requires the
  PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS scope, granted during connect). The
  fee is buyer-invisible (not a line item) and comes out of the seller's net.
  Env vars for the connection: `SQUARE_APP_ID`, `SQUARE_APP_SECRET`,
  `SQUARE_APP_FEE_BPS` (unset/0 = no fee). NOTE: once OAuth is live, the
  webhook subscription (and `SQUARE_WEBHOOK_SIGNATURE_KEY`) must belong to
  that same Square application.
  `app/api/registrations/create/route.js` creates a
  Square Payment Link (online-checkout) for paid class entry fees; the
  webhook (`app/api/webhooks/square/route.js`) verifies the HMAC signature
  (fail-closed: rejects everything if `SQUARE_WEBHOOK_SIGNATURE_KEY` is
  unset or the signature is missing/invalid; timing-safe compare; checks the
  paid amount covers the registration total) and approves the registration
  when `payment.updated` reports COMPLETED. `approveRegistration()` claims
  the registration (pending → paid) atomically first, so webhook retries
  can't double-create entries. Free events (entry fee $0) skip Square
  entirely and auto-approve. Env vars: `SQUARE_ACCESS_TOKEN`,
  `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT` (sandbox|production),
  `SQUARE_WEBHOOK_SIGNATURE_KEY` (required — webhook refuses without it),
  `NEXT_PUBLIC_BASE_URL`. Membership payments (schema-v23) flow through the
  same webhook: an order that doesn't match a registration is looked up in
  `club_members` and marked paid (→ awaiting committee approval) via
  `markMembershipPaid()` in `app/api/_lib/memberships.js`.
- **Booking confirmation email** — after `approveRegistration()` creates the
  real `entries` rows and marks the registration paid, it sends an app-owned
  booking confirmation through Resend. This is separate from Square's payment
  receipt/invoice email. Email failures are logged but do not block entry
  placement. Env vars: `RESEND_API_KEY`, `BOOKING_EMAIL_FROM`, optional
  `BOOKING_EMAIL_REPLY_TO`.
- **Push notifications** — full web-push stack: `public/sw.js` (service
  worker), Supabase Edge Function `supabase/functions/send-push` (Deno +
  `web-push`, VAPID keys as function secrets; requires a signed-in staff JWT
  — rejects the bare anon key), `push_subscriptions` table (not publicly
  accessible; the opt-in "Notify me" button posts to `app/api/push/subscribe`),
  spectator opt-in via `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. The coordinator
  dashboard's `triggerPush()` helper calls the edge function on score saves,
  scratches, and "now showing" changes. iPhone requires the site added to
  Home Screen.
- **Styling**: plain CSS in `app/globals.css` with CSS variables. Western
  show-program aesthetic: paper #FBF8F2, leather #3A2A1C, brass #A8843C,
  clay #C24A2E. Fonts: Zilla Slab (display) + Archivo (body) via Google Fonts.
  Keep this look — do not switch to Tailwind or a component library.
- **Global nav**: `app/components/BottomNav.js` — sticky bar on every page
  (Events / High Pts / Registry / Members / Staff), rendered from
  `app/layout.js`. The Members tab opens the `/account` sign-in portal
  first; joining (`/membership`) is linked from beneath the sign-in card.

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
  the `high_points` table/migration hasn't been run yet. Since schema-v24
  there is a separate set of leaderboards per breed/colour association —
  AQHA (all pre-existing data), Paint, Appaloosa, plus any the staff add
  (tab list in `site_settings` key `high_points_breeds`). Writes carry a
  `breed`; the AQHA tab falls back to legacy no-breed queries if v24 hasn't
  been run, other breeds show a run-the-migration message.
- `app/membership/page.js` — public "Become a member" form (schema-v23):
  pick a membership type, contact details, optional horse details for the
  committee to review, then Square checkout (skipped when the fee is $0).
  When the chosen type covers more than one person
  (`membership_types.included_people` > 1, schema-v25 — e.g. Family = 4),
  the form also collects the extra people's names (optional; blanks can be
  added later in the member portal) into `club_member_people`.
  `app/membership/success/page.js` polls `app/api/memberships/status`.
  Membership seasons run 1 Aug – 31 Jul (`lib/membershipSeason.js`; July
  sign-ups count for the coming season and are valid immediately).
  Application flow: pending (unpaid) → paid (awaiting approval) → approved
  (staff) or rejected. Emails via Resend on payment and on approval.
- `app/account/page.js` — member portal (schema-v25): sign in with email +
  password, or with an emailed 6-digit code (the default for first-time and
  forgotten-password sign-ins; see Member accounts above), then see
  membership status per season (with a "Finish payment" link for abandoned
  checkouts), edit contact details (not name/email — name is what the
  committee approved, email is the login identity), manage the people on
  the membership (capped at `included_people`) and their horses. Rejected
  applications are read-only. Lives under the "Members" nav tab.
- `app/coordinator/memberships/page.js` — staff: review/approve/reject
  applications (approve goes through `app/api/memberships/approve` so the
  welcome email sends), add members manually (cash/paper), edit membership
  types & pricing (incl. "people included" per type since v25; expanded
  rows list the people on each membership), and toggle "membership
  required to enter events"
  (`site_settings` key `membership_required`; separate include-clinics flag).
  Enforcement is server-side in `app/api/registrations/create` (matches the
  contact email against an approved `club_members` row for the active
  season; fails open if the v23 migration hasn't been run). The entry form
  warns non-members early via `app/api/memberships/check` (boolean only).

## Database (supabase/schema.sql + migrations schema-v2 … schema-v25)

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
- `high_points` — season, category, breed (default 'AQHA', schema-v24),
  entity_type (horse|rider), entity_name, show_name, points. Unique on
  (season, category, entity_name, show_name, breed).
- `membership_types` — name, description, fee_cents, active, sort_order
  (schema-v23; public read so the join form can list them, staff write).
- `club_members` — season ('2026-2027', 1 Aug–31 Jul), membership_type_id +
  membership_type_name snapshot, member_name, email, phone, address,
  aqha_member_number, other_memberships, emergency_contact_name/phone,
  interests, applicant_notes (fields mirror the club's paper/Google
  application form; the liability waiver text shown on the join page lives
  in `lib/membershipWaiver.js`), status (pending|paid|approved|rejected),
  total_cents,
  square ids, approved_at. Staff-only read (personal details) — public
  access goes through `app/api/memberships/*` routes. NOTE: the table is
  named `club_members` because schema-v18 already uses `memberships` for
  staff↔club login roles.
- `club_member_horses` — member_id (cascade delete), horse_name,
  back_number, breed, registrations, notes. Staff-only read like its parent.
  Members manage their own via `app/api/account/horses` (schema-v25); these
  stay separate from the official `horses` registry.
- `club_member_people` — member_id (cascade delete), name, person_type
  (adult|child), sort_order (schema-v25). The extra people covered by a
  membership (the applicant is `club_members.member_name`, not a row here).
  How many fit is `club_members.included_people`, snapshotted at application
  time from `membership_types.included_people` (both v25).
- `member_accounts` / `member_login_codes` / `member_sessions` — the member
  portal's login tables (schema-v25): account per lowercase email (plus
  optional scrypt `password_hash` + failed-attempt lockout fields), hashed
  single-use sign-in codes, hashed 90-day session tokens. Locked down like
  `push_subscriptions` — no anon OR authenticated access, service role only
  via `app/api/account/*`.
- `registrations` — event_id, contact_name, contact_email, status
  (pending|paid|cancelled), square_order_id/checkout_url/payment_id,
  total_cents. Staff-read-only since schema-v16 (contains personal contact
  details); the public success page reads via `app/api/registrations/status`.
  Since schema-v32 also square_payment_link_id + cancelled_at + cancel_reason
  ('staff'|'expired'): staff can cancel a pending registration from the
  Registrations page, and pending ones auto-expire after 48h
  (`expireStaleRegistrations` — lazy sweep on new registrations and when
  staff open the page, no cron). Cancelling deletes the Square payment link
  (`deleteSquarePaymentLink`) so it can't be paid afterwards; if an
  undeletable old link IS paid, the webhook still creates the entries
  (approveRegistration claims anything `neq paid`, cancelled included —
  money and entries stay consistent).
- `registration_entries` — registration_id (cascade delete), class_id
  (cascade delete — schema-v10), back_number (nullable — clinics auto-assign
  sequentially on approval), horse_name, exhibitor.
- `push_subscriptions` — endpoint (unique), p256dh, auth_key. Not publicly
  accessible since schema-v16; subscribing goes through
  `app/api/push/subscribe` (service role), and the send-push edge function
  reads/prunes with the service role.
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
came in with `back_number = null`. It also sends the app booking confirmation
email via Resend after approval; Square remains responsible for the payment
receipt/invoice email.

Members signed in to the `/account` portal are recognised on the entry form
(it calls `/api/account/me`): name/email are filled in and collapsed to a
"Signed in" card (with a "Use different details" escape hatch), membership is
confirmed without typing, and current members never see the day-membership
offer or warning banner. During July the checkout also offers a **membership
renewal** for the season starting 1 August (`renewalOffer()` in
`app/api/_lib/memberships.js`, surfaced via `/api/account/me`): the member
picks a type (previous type pre-selected), the fee joins the same Square
checkout, and the server creates a normal `club_members` application (status
pending; details + people + horses copied from their latest membership)
sharing the registration's `square_order_id`. The webhook — and the
coordinator's force-approve button — mark that row paid alongside the
entries; committee approval then happens as usual. A renewal covering the
event's season satisfies the membership requirement (server-checked, like
day membership). Renewal money is NOT in `registrations.total_cents` — it
lives on the `club_members` row. `hasCurrentMembership` accepts any season
in `activeSeasons(event date)`, so during July both outgoing-season members
and early new-season sign-ups can enter.

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

- Records are treated as permanent by default: "End event" only flips status
  to completed; "Archive" only hides from the home page. Delete buttons DO
  exist (owner-requested: events, classes, entries) but always sit behind a
  confirm dialog that spells out what goes with them — never add a delete
  path without one, and never delete data as a side effect of another action.
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
