# Coordinator guide

Plain-English how-to for running a show. No code or technical knowledge needed.
For the one-time setup (GitHub / Supabase / Vercel) see `README.md`; for the
database update files see `supabase/MIGRATIONS.md`.

You run everything from **/coordinator** after signing in with your staff
email and password.

---

## The life of an event

An event moves through these stages. The buttons to move it forward (and the
revert buttons for accidental clicks) are on the dashboard.

1. **Pre-open** — you're setting up. Not visible to the public for entry yet.
2. **Entries open** — the online registration form is live; exhibitors can
   submit and pay.
3. **Entries closed** — entry is shut while you finalise the draw.
4. **Live** — the show is happening; live scoring is on.
5. **Completed** — the show is over; results stay visible.
6. **Archived** — hidden from the home page, but results still open via the
   direct link.

**Cancel event** is separate from all of this: it marks the event cancelled,
hides it from the main list (it moves to a "Cancelled events" section with the
reason you typed), and can be reopened later. Use it when a show won't run at
all — not for ending a show that happened.

> If **Cancel event** seems to do nothing, the v13 database update hasn't been
> run yet — see `supabase/MIGRATIONS.md`. The same is true for any feature that
> "does nothing": it usually means its database update is still pending.

---

## Scoring on the day

- The dashboard always shows the **current horse** for the live class and
  auto-advances as you score. When the last horse is scored the class
  auto-completes and the next one becomes live.
- **Scratch** strikes an entry through and removes it from the draw counts;
  you can restore it.
- You can **reorder** the pending draw and the upcoming classes.
- Score inputs accept **half points** (e.g. 71.5). A score of **0** means
  incomplete work.

Scoring mode per class (set when you create the class):
- **Score** — 70-point scale, one horse at a time.
- **Placing** — 1st/2nd/3rd, one at a time.
- **Class only** — everyone in the ring together; you enter placings after.
- **TBC (draw)** — horses go one at a time and the draw shows live, but
  results come from the judge's paperwork afterwards.
- **TBC (whole class)** — everyone in the ring; results from paperwork later.

### Judges scoring on their own phone (digital judge cards)

Instead of paper cards, each judge can score on their own phone or tablet.

1. Name the judges on the classes first (**Edit event** sets the judges for
   every class at once).
2. Open **Show day → ⚖ Judge access** and tap **Create link** beside each
   judge, then **Share link** (by text message is easiest). Each link is
   private to that judge — don't post it anywhere public.
3. The judge opens the link once while they have reception. The whole show
   downloads to their device, and from then on it works with **no signal**:
   every tap is saved on the device, and each finished card sends itself the
   moment the phone finds a signal again. A "cards to send" counter on their
   page shows what's still waiting.
4. On each class the judge places the horses (or scores them on 70-point
   classes — placings follow the scores) and taps **Finish class**. That
   writes their column on the class exactly as if you'd typed it, and closes
   the class once every judge on it has finished. With two judges, each has
   their own card and only sees the other's after finishing.
5. Under each class on the dashboard you'll see **sent ✓** or **waiting for
   the judge's card**. If a judge is on paper for a class, type the results
   in as usual — the gate marshal's "Class finished" still works too.

Like a paper card, a finished card can't be changed by the judge once the
class has closed. For a clerical error, open the class's **⋯** menu and tap
**Unlock … card**: the judge reopens it on their device, corrects it and
finishes the class again.

**Who taps the card** (in the same Judge access window): judges score on
their own device, or a **scribe** enters for the judge and types their own
name, which is recorded on every card they send.

If a judge's phone is lost, tap **New link** for that judge — the old link
stops working immediately.

---

## High Points — automatic from class results

You can now have class results feed the High Points leaderboard automatically,
instead of typing them in by hand.

**1. Tag the class with a High Points category.**
When you add or edit a class, set its **HP Category** (e.g. *Amateur*,
*Senior Horse*). You can also include an **HP Category** column in the
class-list spreadsheet import. A class with no category simply doesn't feed
High Points — nothing else changes.

**2. Results push when the class completes.**
As soon as a tagged class is completed, its placings are added to High Points:

> **1st = 3 points · 2nd = 2 points · 3rd = 1 point — per judge.**
> A two-judge class adds both judges' points together.

**3. The "Push all HP" button.**
Sends every completed, tagged class to High Points at once. It's safe to press
as often as you like — it recalculates from scratch each time, so if you
press it again after a late scratch or a corrected score, the totals simply
update to match. It only appears when there's something to push.

**4. The leaderboard.**
On the **High Pts** page, each show becomes a month column (e.g. "Nov '25").
The **season runs August to July**, columns sort in that order, and the page
defaults to the current season. Past seasons stay available in the dropdown.

> Needs the v14 and v15 database updates (see `supabase/MIGRATIONS.md`). If HP
> categories don't appear on classes, run v14; if month columns show the wrong
> name, run v15.

---

## Importing in bulk

- **Import classes** — a spreadsheet of just the class list (so exhibitors
  have something to pick when registering online). Columns: Class #, Class
  Name, Judge (optional), Type (optional), HP Category (optional).
- **Import entries** — a full entry spreadsheet (back numbers, horses,
  exhibitors, classes). Forgiving about column names; previews before
  committing and skips bad rows with a note.

---

## Exporting results

**Export results** produces an Excel workbook: an Event sheet, a Results sheet
(every class), and a **Club Points** sheet with calculated points per placing
per club registration — this is the sheet you submit to each association.
Dual-registered horses get a row per club.

---

## Things that are deliberate

- **Nothing is ever deleted.** "End event" only marks it completed; "Archive"
  only hides it. Records are permanent.
- **Anyone can watch; only staff can change anything.** Spectators never need
  an account.
- **Phone-first.** The whole dashboard is built to score from a phone at the
  arena gate.
