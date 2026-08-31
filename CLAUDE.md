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
  **Committee read-only accounts (schema-v48)**: logins listed in
  `staff_viewers` see everything but can change nothing — RESTRICTIVE
  policies block their INSERT/UPDATE/DELETE on every staff-writable table
  (and storage uploads), staff-JWT write routes check
  `isCommitteeViewer()` (`app/api/_lib/registrations.js`), the send-push
  edge function refuses them (redeploy needed when that file changes), and
  `app/components/ReadOnlyBanner.js` shows the read-only notice on staff
  pages. Staff manage logins from `/coordinator/staff` ("Staff access"
  toolbar button) via `app/api/staff/users` (staff JWT; GET open to
  viewers, writes full-access only; uses the service-role auth admin API
  to list/create/delete logins and toggles `staff_viewers`; you can never
  remove or downgrade YOUR OWN login, so one full-access admin always
  remains). The SQL snippets at the bottom of the migration file still
  work as a fallback.
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
  Staff can issue **refunds** (full or partial) from the coordinator
  Registrations page via `app/api/registrations/refund` (staff JWT) →
  `refundSquarePayment()` in `squarePayments.js` (Square Refunds API, uses the
  already-granted PAYMENTS_WRITE scope on the registration's
  `square_payment_id`); schema-v36 records `registrations.refunded_cents` so
  the page can show the running total and cap further refunds. Staff can also
  "Record refund given outside Square" (a `manual` flag on the same route) to
  log a cash/bank-transfer refund without calling Square. Removing the entry
  from a class stays a separate manual step (Delete/Scratch on the dashboard).
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
- `app/coordinator/program/page.js` — staff **Program builder** ("📋 Program
  builder" toolbar link, shows only): the whole running order on one screen
  with ＋ strips between classes to add/rename/remove section headings
  (`classes.program_category`, applied to the contiguous group — adding one
  mid-section splits it) and breaks (`program_break_before`/`_after`), plus
  ▲▼ reorder that renumbers `sort_order` event-wide and swaps the moved
  classes' layout fields so headings/breaks stay at their time slot instead
  of travelling with the class. Links to the printable `/event/[id]/program`.
  **Program presets (schema-v49)**: the page also saves/applies shared
  presets (`program_presets` table — name + jsonb items snapshot of the
  program: num/name/day/scoring_mode/capacity/hp_category/headings/breaks +
  championship links stored by class NUMBER, remapped to fresh ids on
  apply; judges and hidden classes excluded). Applying to an EMPTY event
  creates all the classes; applying to an event that already has classes
  only copies headings/breaks onto matching class numbers (never creates
  or deletes classes). Public read / staff write, with the v48 viewer
  write-block re-declared inside the v49 file (guarded — re-run v49 after
  v48 if run out of order).
- `app/registry/page.js` — permanent registry, two tabs: **Horses** (public
  read, staff edit, back number permanent for life, multi-club registrations,
  bulk import) and **Riders** (public read, staff edit — name, member number,
  category, notes).
- `app/highpoints/page.js` — season high-points leaderboard, separate for
  horses and riders, category tabs, CSV import matching the club's existing
  spreadsheet format (season detected from the title row), manual add/edit/
  delete for staff. Self-service "create this table" instructions shown if
  the `high_points` table/migration hasn't been run yet. There is ONE
  leaderboard (owner's rule, July 2026 — the per-breed tabs from schema-v24
  were removed): a horse registered with more than one association earns
  points separately under each breed BY NAME — e.g. "Harry High Pants (QH)"
  and "Harry High Pants (Paint)" are two leaderboard entries.
  `pushToHighPoints` looks up `horse_registrations` by back number and
  splits automatically (club → suffix map `BREED_SUFFIX` in
  `app/coordinator/page.js`: AQHA→QH, PHAA/APHA→Paint, AAA/APHCA→Appaloosa,
  unknown clubs keep their code; no registrations = plain name). Rows still
  store `breed = 'AQHA'` (the v24 column stays as the storage default, with
  the legacy no-breed fallback for pre-v24 databases); rows under other
  breed values are no longer displayed.
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
  **Returning members skip the committee** (owner's rule, Aug 2026):
  `markMembershipPaid` auto-approves when the email's most recent DECIDED
  application (approved/rejected, any season) was approved — covering July
  renewals and re-joins; first-timers and last-rejected still get reviewed.
  Lookup failures leave it for the committee.
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
  welcome email sends), add members manually (cash/paper), **renew** an
  approved member into the next season in one click via
  `app/api/memberships/renew` (staff JWT — copies details, people and horses
  into a fresh approved `club_members` row for `signupSeason()`, no Square /
  no email, like a manual add; the "↻ Renew" button shows on approved rows
  whose season ≠ signupSeason()), edit membership
  types & pricing (incl. "people included" per type since v25; expanded
  rows list the people on each membership), and toggle "membership
  required to enter events"
  (`site_settings` key `membership_required`; separate include-clinics flag).
  Enforcement is server-side in `app/api/registrations/create` (matches the
  contact email against an approved `club_members` row for the active
  season; fails open if the v23 migration hasn't been run). The entry form
  warns non-members early via `app/api/memberships/check` (boolean only).

## Database (supabase/schema.sql + migrations schema-v2 … schema-v45)

- `events` — name, location, starts_on, ends_on, **status**: see Event
  lifecycle below, entry_fee_cents (per-class fee for online registration),
  ground_fee_cents + admin_fee_cents (schema-v34 — one-off fees charged on a
  person's FIRST paid registration for the event, matched by email and only
  waived when an earlier paid registration's `registrations.fees_cents` > 0;
  the entry form checks via `app/api/registrations/fees-status`),
  event_type: `show` | `clinic`, entries_open (legacy boolean, superseded by
  status, kept for backwards compatibility but unused).
- `gate_codes` — event_id (pk, cascade delete), code (schema-v44). Per-event
  gate-marshal access: the dashboard's "🚪 Gate access" button generates a
  long crypto-random token (NEVER stored on the publicly readable `events`
  table — this table has no anon access at all; staff + service role only)
  and shares `/event/[id]/gate?code=…`. The gate page verifies via
  `app/api/gate` action "check", then offers gate controls ONLY — mark the
  current TBC-draw horse called, scratch/restore, reorder the pending draw,
  finish the live class & start the next — via `app/api/gate`
  (service role; entry must belong to the event; completed classes are
  refused). Not a staff login.
- `classes` — event_id, num, name, judge, judge2 (optional second judge),
  status: upcoming|live|completed, sort_order, pattern_url, day (multi-day
  shows, default 1), scoring_mode (see Scoring modes below), capacity
  (spot limit for online registration — null = unlimited), hidden (schema-v38 —
  when true the class is kept but removed from the public event page, schedule,
  program, results and online entry; the "Close entries" flow offers to hide
  empty classes instead of deleting them, and staff reactivate them from a
  collapsed "Hidden classes" section on the dashboard), champ_feeder_ids +
  champ_take (schema-v43 — championship classes; see Championship classes
  below), result_sheets (schema-v45 — jsonb [{url, label}] photos of each
  judge's paper result sheet, uploaded from the class ⋯ menu into the
  patterns bucket under results/…, linked on the public Results page).
- `entries` — class_id, back_number, horse, exhibitor, draw_order, score,
  score2 (second judge's independent score), scratched bool, called bool
  (TBC draw mode — see below). "Current" entry of a live class = first entry
  by draw_order that's still pending for the class's scoring mode (no stored
  pointer — derived by `firstPending()`).
- `horses` (back_number UNIQUE — permanent for life, name, owner) +
  `horse_registrations` (horse_id, club, registration_number). A horse can be
  registered with multiple clubs (e.g. AQHA + PHAA Paint) and earns points
  with EACH club from the same class/placing.
- `riders` — name, member_number (legacy single number, kept in sync with the
  AQHA row), category (Amateur/Novice Amateur/Select/
  Beginner/Youth/EWD/Leadline/Non Pro/Open), notes. Independent of horses.
  `rider_registrations` (schema-v46 — rider_id cascade, club,
  registration_number, unique per club) mirrors `horse_registrations`: the
  entry form auto-fills a rider's numbers when the exhibitor name (or a
  typed number, if the name is blank) matches the registry, and
  `approveRegistration` copies declared rider numbers back in insert-only
  (creating the rider row if needed). The official scoring export reads
  these for the Rider/Owner number columns.
- `high_points` — season, category, breed (default 'AQHA', schema-v24),
  entity_type (horse|rider), entity_name, show_name, points. Unique on
  (season, category, entity_name, show_name, breed).
- `membership_types` — name, description, fee_cents, active, sort_order
  (schema-v23; public read so the join form can list them, staff write).
- `club_members` — season ('2026-2027', 1 Aug–31 Jul), membership_type_id +
  membership_type_name snapshot, member_name, email, phone, address,
  aqha_member_number, other_memberships, association_registrations
  (schema-v42 — jsonb list of {club, number}; members aren't all AQHA, so this
  replaces the single AQHA field with a horse-registry-style multi-club list,
  edited via the shared `app/components/ClubRegistrations.js`; the legacy
  aqha_member_number/other_memberships stay for old data and seed the list),
  emergency_contact_name/phone,
  interests, applicant_notes (fields mirror the club's paper/Google
  application form; the liability waiver text shown on the join page lives
  in `lib/membershipWaiver.js`), status (pending|paid|approved|rejected),
  total_cents,
  square ids, approved_at. Staff-only read (personal details) — public
  access goes through `app/api/memberships/*` routes. NOTE: the table is
  named `club_members` because schema-v18 already uses `memberships` for
  staff↔club login roles.
- `club_member_horses` — member_id (cascade delete), horse_name,
  back_number, breed, registrations, notes, number_fee_cents + number_fee_paid
  (schema-v39 — the $5 additional-horse-number fee; a member's first NEW number
  is free/covered by membership, each additional new number is $5, paid at
  signup checkout or marked owing when added later in the portal). Staff-only
  read like its parent. Members manage their own via `app/api/account/horses`
  (schema-v25); these stay separate from the official `horses` registry. The
  coordinator **New numbers** page (`app/coordinator/numbers/page.js`) lists
  these plus show-entry new-number requests so staff can see who needs a tag
  made and who owes the $5.
- `club_member_people` — member_id (cascade delete), name, person_type
  (adult|child), sort_order (schema-v25), email (schema-v40 — each person's
  own email; `hasMembershipForEvent`/`hasCurrentMembership` match it too, so a
  family member can enter events under their own address), aqha_member_number
  + phone + other_memberships (schema-v41 — each family member is their own
  exhibitor), association_registrations (schema-v42 — jsonb {club, number}
  list, same multi-club editor as the applicant). The extra people
  covered by a membership (the applicant is `club_members.member_name`, not a
  row here). How many fit is `club_members.included_people`, snapshotted at
  application time from `membership_types.included_people` (both v25). Staff
  edit members + these people (incl. emails) via `app/api/memberships/update`
  (staff JWT); members edit their own via `app/api/account/people`. NOTE:
  family emails are recognised at event entry but do NOT yet grant portal
  login (that stays keyed to `club_members.email`).
- `member_accounts` / `member_login_codes` / `member_sessions` — the member
  portal's login tables (schema-v25): account per lowercase email (plus
  optional scrypt `password_hash` + failed-attempt lockout fields), hashed
  single-use sign-in codes, hashed 90-day session tokens. Locked down like
  `push_subscriptions` — no anon OR authenticated access, service role only
  via `app/api/account/*`.
- `registrations` — event_id, contact_name, contact_email, status
  (pending|paid|cancelled), square_order_id/checkout_url/payment_id,
  total_cents, fees_cents (schema-v34 — the one-off ground/admin fee portion
  of the total), membership_basis (schema-v37 — how the entry satisfied the
  membership rule at creation: `member`|`annual_join`|`renewal`|
  `day_membership`|`not_required`; null on pre-v37 rows, which the coordinator
  Registrations page falls back to deriving from the members list). The badge
  answers "how did a non-member get in?" — `not_required` means the switch was
  off when they entered. Staff-read-only since schema-v16 (contains personal
  contact details); the public success page reads via
  `app/api/registrations/status`.
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
  sequentially on approval), horse_name, exhibitor, rider_registrations +
  horse_registrations (schema-v35 — jsonb lists of {club, number} pairs for
  points checking; [] = declared not registered, null = not collected;
  required on show entries, auto-filled from the registry by back number,
  and copied back into `horse_registrations` on approval), new_number
  (schema-v39 — true when the exhibitor asked for a brand-new number; surfaced
  on the coordinator New numbers page).
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

## Championship classes (schema-v43)

Champ & Reserve / Grand Champion classes (`classes.champ_feeder_ids` — a
jsonb list of feeder class ids; non-empty = championship. `champ_take`:
`top2` default | `top1`). Logic lives in `lib/championship.js`; the
coordinator page auto-fills. Rules:

- **Setup**: the class form shows a feeder picker whenever the class name
  matches /champ|supreme/i, pre-ticked from `suggestFeederIds()` (walks back
  through the same day's program to the previous championship; a /grand/i
  class collects the championship classes instead; a /supreme/i class
  collects the GRAND CHAMPION classes and defaults champ_take to `top1` —
  the grand champions compete for Supreme, winners only, and its 1st is
  labelled "Supreme" publicly). Staff confirm/adjust.
- **Auto-fill**: `fillChampionshipsFedBy(classId)` runs at every class
  completion site (start-next-class, Complete button, End event). Once ALL
  feeders are completed, qualifiers (1st & 2nd per feeder — both judges'
  placings count on two-judge classes, union; `top1` = winners only) are
  inserted into the championship's draw, deduped by back number. Manual
  adds are never touched; the "↻ Qualifiers" button re-syncs (also removing
  unscored no-longer-qualified horses) after result corrections.
- **Qualification-only**: championship classes are excluded from the online
  entry form and rejected server-side in `registrations/create`.
- Public event + results pages label a championship's 1st/2nd as
  **Champion / Reserve**.
- Grand Champion eligibility (Champion+Reserve vs Champions only) is the
  per-class `champ_take` toggle — the committee hadn't confirmed which at
  build time; default `top2`.
- **Championship titles are PER JUDGE** (owner's rule, July 2026 — like all
  judging, the judges are never combined): each judge's 1st is a Champion
  and their 2nd a Reserve, so a two-judge class can have two Champions.
  `championshipTitles()` in `lib/championship.js` computes the sets (a
  horse that is one judge's Champion and the other's Reserve reads as
  Champion); used by the public event page, results page and dashboard.
  **Club high points**: Champion = 1 pt, Reserve = 0.5 pt per judge (a
  horse can collect 1 + 0.5 across the two judges); Supreme earns nothing.
  Implemented in `pushToHighPoints` — ordinary classes keep the
  `calcPoints` per-judge scale.

## Clinics (`events.event_type = "clinic"`)

Added so the same app can run clinics with a capacity-limited spot count
(e.g. "Rider spots" and "Fence sitting" as two separate classes/spot-types,
each with its own `capacity`) instead of a normal scored show.

- Coordinator UI hides Start/Complete/Pattern/scoring-mode/reorder controls
  for clinic classes; "+ Add class" becomes "+ Add spot type" (name/price/
  deposit/capacity only), "+ Participant" replaces "+ Entry". Back numbers:
  a horse already in the permanent registry keeps its REAL number (matched
  by name at approval and in the + Participant modal); unknown horses get a
  sequential placeholder.
- Public event page shows a registration-only view (no live scoring banner)
  with per-spot-type availability, "Sold out"/"Closed"/"Coming soon" states.
- Capacity is enforced server-side in `app/api/registrations/create/route.js`
  by counting non-scratched `entries` rows against `classes.capacity` —
  there's a small race window under simultaneous submissions right at the
  capacity limit, accepted as a reasonable tradeoff at clinic-sized capacities.
- **Pricing & deposits (schema-v47)**: each clinic spot type can carry its
  own price (`classes.fee_cents`, null = event `entry_fee_cents`) and an
  optional NON-REFUNDABLE deposit (`classes.deposit_cents`). When every
  selected spot type has a deposit and today is at least 2 weeks before the
  clinic (`lib/clinicPayments.js`), the entry form offers "pay deposit now,
  balance later": the first Square checkout charges deposits + any extras
  (`registrations.deposit_cents`; `total_cents` stays the full price), the
  webhook approves on the deposit amount, and the balance is a second
  checkout via `app/api/registrations/pay-balance` (link on the success
  page, in the booking email, and copyable from the staff Registrations
  page, which also shows owing/overdue badges, a "record paid outside
  Square" button, and a Balances-owing stat; revenue counts deposits only
  until balances are paid). Balance payments close 2 weeks before the
  clinic (`balance_*` columns on registrations; overdue = staff decide,
  no auto-cancel).

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
came in with `back_number = null`. For SHOW entries with `back_number = null`
("This horse doesn't have a back number yet" on the entry form, schema-v33),
approval instead assigns a registry-aware number via `lockInNewHorseNumber()`:
`assignHorseNumber` (shared with the member portal) reuses the registry
number when the horse name matches an existing registry horse, else takes
the next available number AND inserts the horse into the `horses` registry
(permanent, per back-numbers-for-life; the unique index arbitrates races).
The assigned number is written back to `registration_entries` so the success
page and booking email show it. It also sends the app booking confirmation
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
lives on the `club_members` row.

**Event eligibility** uses `hasMembershipForEvent(db, email, eventDate)`,
which matches an approved `club_members` row whose season is in
`activeSeasons(eventDate)` — the event's own season, PLUS (only at the July
boundary) the coming season. So a member who joined in July (recorded for
next season via `signupSeason()`) still counts at the last shows of the
outgoing season, an August event is covered only by a next-season
membership, and a mid-season event matches its own season only. (Uses the
event date, unlike `hasCurrentMembership`, which uses "now" for the no-event
"are you a member?" check on the membership page and `/api/memberships/check`
without an event id.)

Non-members (no portal sign-in) get **join at checkout**: alongside the day
membership, the entry form offers every active `membership_types` row ("Join
the club — annual membership", `annual_membership_type_id` in the create
route). It creates a normal pending `club_members` application (for
`signupSeason()`) sharing the Square order like a renewal; the member
completes their details in the portal after committee approval. **Joining
always covers entry to the event** and is mutually exclusive with the day
membership (`satisfiedByAnnual = Boolean(annualJoin)` server-side). At the
**last event of the season** the membership is for NEXT season and carries
over, but joining still covers that final event as a perk — the day
membership is waived, and the entry form's banner/labels switch to the "next
season, covers today too" wording via `annualIsNextSeason` (event season ≠
`signupSeason()`). The `club_members` row's season stays `signupSeason()`
regardless.

Show entries also collect **association registration numbers** for points
checking (schema-v35): per entry, structured {club, number} rows for the
horse and for the rider (AQHA/PHAA/AAA suggestions, free text allowed), each
with a "not registered with any association" opt-out. Required server-side
for shows (never clinics); horse rows auto-fill from `horse_registrations`
via the back-number lookup, staff see them on the coordinator Registrations
page, and `approveRegistration` copies new horse numbers into the registry
(insert-only — never overwrites staff data).

## Domain rules (from the AQHA Australia rule book, 2024 edition)

- Scored classes commonly use a 60–80 scale with 70 = average (e.g. boxing /
  working cow horse) or reining-style scoring from a base of 70 ("0 to
  infinity"), manoeuvres scored +3 to -3 in HALF-POINT increments. Score
  inputs must accept halves (step 0.5). A score of 0 = incomplete work.
  A judge's **DQ** is stored as `score`/`score2 = -1` (staff type "DQ" in any
  score box; `lib/showPrint.js` `isDq`/`scoreRank`/`scoreText`): it displays
  as DQ everywhere, always sorts below every real result, earns no points
  (excluded from the Club Points export and High Points push), and never
  qualifies for a championship.
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

## Official scoring export ("⇩ Official scoring")

`app/coordinator/exportGateSheets.js` replicates the secretary's manual
workbook (one colour-coded "gate sheet" per judge; modelled on
"HCQHA Spring Classic Nov 025.xlsx"): every class in program order with a
bold heading row, then placed rows (1/2/3, or CHAMP/RESERVE/SUPREME with
per-judge titles referencing the class the horse won through), columns for
horse no./name, association numbers, owner + owner member no., rider +
rider member no. (owner/rider numbers looked up from the `riders` registry
by name). Rows are fill-coloured by the horse's registrations: QH plain,
Appaloosa orange, Paint pink, dual Paint/QH blue, none recorded light blue —
legend in the title rows. Colour fills need `lib/vendor/xlsx-js-style.min.js`
(a vendored copy of the xlsx-js-style dist build + its `cpexcel.js`; the
standard SheetJS community build cannot write styles — do not "upgrade" it
away). `next.config.mjs` stubs Node built-ins (fs etc.) for that file.

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
