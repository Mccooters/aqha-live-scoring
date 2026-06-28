# Changelog

A plain-English record of what's been built, newest first. This is for
information and to make future updates easier — it is not a marketing page.
Dates are approximate (when the work landed on the live site).

## High Points ↔ class scoring linking (June 2026)

The biggest recent piece. Previously High Points were maintained by hand (CSV
import / manual add). Now class results can flow into the leaderboard
automatically.

- **Tag a class with a High Points category** (Add/Edit class, or the
  `HP Category` column in the class-list CSV import). The tag says which
  leaderboard the class feeds — e.g. *Amateur*, *Senior Horse*.
- **Automatic push on completion.** When a class is marked completed, its top
  three placings are pushed to High Points: **1st = 3 pts, 2nd = 2 pts,
  3rd = 1 pt, per judge** (two-judge classes add both judges together).
- **"Push all HP" button** (coordinator toolbar) re-pushes every completed,
  tagged class in one go. Appears only when there's something to push.
- **Idempotent / safe to repeat.** Each push recalculates the whole category
  from scratch and replaces the stored rows, so pushing twice — before and
  after a late scratch, say — always lands on the correct totals and never
  leaves stale points behind. Multiple classes sharing one category add up
  correctly instead of overwriting each other.
- **Real event date stored** with each result (`show_date`), so the
  leaderboard's month columns label correctly ("Nov '25", "Mar '26") and sort
  in season order (August → July) regardless of what the show was named.
- Requires migrations **v14** and **v15** (see `supabase/MIGRATIONS.md`).

## High Points leaderboard improvements (June 2026)

- Season is shown with the month ("Nov '25") and the **season runs August →
  July**, so March results correctly sort *after* the previous November.
- Leaderboard **auto-defaults to the current season** and lets you browse
  archived seasons from the dropdown. A new season starts automatically after
  July; old ones stay viewable.
- **All standard categories always show**, even ones nobody has points in yet,
  for reference.

## Event cancellation (June 2026)

- **Cancel event** button on the coordinator dashboard with an optional
  free-text **reason**. Cancelled events are hidden from the main public list
  (shown in a collapsed "Cancelled events" section with the reason) and can be
  **reopened** back to pre-open if needed.
- Requires migration **v13**.

## Earlier milestones

Everything on the original roadmap has shipped:

- **Online registration + Square payments** — exhibitors enter and pay online;
  free events auto-approve.
- **Push notifications** — opt-in "now showing" / scratch / score alerts.
- **Pattern uploads** — patterns posted to a class before it runs.
- **Spreadsheet import** — bulk entry import and bulk class-list import.
- **Event schedule page** — public class-by-class run sheet, multi-day aware.
- **Registry** — permanent horse + rider registry with bulk import.
- **Clinics** — capacity-limited spot types instead of scored classes.
- **Two-judge classes**, **multiple scoring modes** (score / placing /
  class-only / TBC draw / TBC whole-class), **multi-day shows**.
- **Results export** to Excel, including a Club Points sheet with AQHA rule-book
  point allocation.

See `CLAUDE.md` for how each of these works under the hood.
