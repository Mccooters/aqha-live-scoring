# CLAUDE.md — AQHA Live Scoring

## What this project is

A live scoring web app for Australian Quarter Horse Association (AQHA) shows,
built for a show coordinator in NSW, Australia. Spectators watch live scoring,
the current draw, and scratches in real time on their phones; coordinators run
the whole show from a protected dashboard.

The owner of this project is the show coordinator and is NOT a developer —
explain changes in plain language, avoid jargon, and never assume knowledge of
git, terminals, or programming. Prefer making changes directly and opening a
PR with a clear plain-English description.

## Stack & architecture

- **Next.js 14 (App Router, JavaScript, no TypeScript)** — deployed on Vercel,
  auto-deploys from the main branch of this GitHub repo.
- **Supabase** — Postgres database, auth, and realtime. The app talks to it
  from the browser via `lib/supabaseClient.js` using two env vars set in
  Vercel: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **Security model**: Row Level Security — anyone can read (spectators need no
  account); only authenticated users (show staff, created manually in the
  Supabase dashboard under Authentication → Users) can write.
- **Realtime**: spectator and coordinator pages subscribe to postgres_changes
  on `entries`, `classes`, `events` and simply re-fetch on any change.
- **Styling**: plain CSS in `app/globals.css` with CSS variables. Western
  show-program aesthetic: paper #FBF8F2, leather #3A2A1C, brass #A8843C,
  clay #C24A2E. Fonts: Zilla Slab (display) + Archivo (body) via Google Fonts.
  Keep this look — do not switch to Tailwind or a component library.

## Pages

- `app/page.js` — public home: list of events (live + past = permanent record).
- `app/event/[id]/page.js` — public spectator view: live "now showing" banner
  (current horse, draw position X of Y excluding scratches, progress bar),
  per-class scoreboards (placed by score desc, pending in draw order, SCR rows
  struck through), pattern link if `classes.pattern_url` is set.
- `app/coordinator/page.js` — staff only (Supabase email/password auth):
  create events/classes/entries (prompt-based for now), score the current
  entry (auto-advances; auto-completes class and promotes the next one),
  scratch/restore entries, reorder pending draw (swap `draw_order`), reorder
  upcoming classes (swap `sort_order`), start/complete classes, Excel import
  and export, link to registry, "End event".
- `app/coordinator/ImportEntries.js` — bulk import from .xlsx/.csv via SheetJS.
  Forgiving header mapping (e.g. "Back No"/"back#" both work; "Rider"/"Shown
  By" map to exhibitor). Preview-before-commit; creates missing classes when
  a Class Name is provided; skips bad rows with warnings. Template for
  secretaries: `entry-import-template.xlsx` in repo root.
- `app/registry/page.js` — permanent horse registry. Public read, staff edit.

## Database (supabase/schema.sql; v2 migration in schema-v2-horses.sql)

- `events` (name, location, starts_on, ends_on, status: upcoming|live|completed)
- `classes` (event_id, num, name, judge, status, sort_order, pattern_url)
- `entries` (class_id, back_number, horse, exhibitor, draw_order, score numeric,
  scratched bool). "Current" entry of a live class = first entry by draw_order
  with score null and not scratched (no stored pointer — derived).
- `horses` (back_number UNIQUE — back numbers are permanent for life, name,
  owner) + `horse_registrations` (horse_id, club, registration_number).
  A horse can be registered with multiple clubs (e.g. AQHA + PHAA Paint) and
  earns points with EACH club from the same class/placing.

## Domain rules (from the AQHA Australia rule book, 2024 edition)

- Scored classes commonly use a 60–80 scale with 70 = average (e.g. boxing /
  working cow horse) or reining-style scoring from a base of 70 ("0 to
  infinity"), manoeuvres scored +3 to -3 in HALF-POINT increments. Score
  inputs must accept halves (step 0.5). A score of 0 = incomplete work.
- Many classes are placings-based; points are allocated per the rule book's
  point scale based on placing AND number of entries in the class — this is
  why the export includes an "Entries in Class" column.
- Points go to approved bodies as "A" or "B" type points; dual-registered
  horses submit to each association separately.
- Pattern classes (trail, showmanship, horsemanship, western riding, reining)
  need patterns posted BEFORE the class — patterns should be visible on
  upcoming classes as soon as uploaded.
- Rail classes (western pleasure) have no pattern.
- Vocabulary: exhibitor (not "rider" in halter/showmanship), back number,
  draw order, scratch (SCR), go-rounds, ROM, high point.

## Results export ("⇩ Export results", SheetJS, client-side)

Workbook sheets: **Event** (meta + export timestamp), **Results** (every class:
placing, back, horse, exhibitor, score, SCR rows, registrations string),
**Club Points** (one row per placing PER club registration — the sheet used to
submit points to each association).

## Conventions

- Permanent records: never delete events/classes/entries/scores. "End event"
  only flips status to completed.
- Keep everything client-side ("use client") talking straight to Supabase;
  there is no custom server/API layer yet.
- Mobile-first: coordinators score from a phone at the arena gate.
- pip-style draw counters exclude scratched entries everywhere.

## Roadmap (agreed with the owner, not yet built)

1. Automatic point allocation in the Club Points export (placing × entry
   count per the rule book point scale).
2. Web push notifications to spectators ("now showing", scratches, results) —
   requires a service worker + a small server piece (e.g. Supabase Edge
   Function) for web-push; iPhone requires the site added to Home Screen.
3. Pattern uploads via Supabase Storage (DB field `pattern_url` already
   exists; needs the upload UI).
4. Replace prompt()-based add-event/class/entry forms with proper forms.
5. Registry bulk import from spreadsheet (same pattern as ImportEntries).
6. Event schedule page (two-day run sheet) and richer past-event pages —
   designed in an earlier prototype, not yet in the deployed app.
