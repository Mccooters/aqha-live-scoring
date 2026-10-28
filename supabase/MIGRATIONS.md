# Database migrations — what to run and when

The database starts from `schema.sql`. Every time a new feature needs a new
column or table, it ships as a numbered `schema-vN-*.sql` file in this folder.

**How to run one:** Supabase dashboard → **SQL Editor** → **New query** →
open the `.sql` file, copy everything, paste, click **Run**. You should see
"Success". Each file is safe to run more than once (they all use
`if not exists` / `if not present` guards), so if you're ever unsure whether
one has been applied, just run it again — nothing breaks.

Run them **in order** (v2 before v3, etc.). You only ever need to run each one
once on a given database.

## ⚡ The easy way: the catch-up script

You don't have to hunt for each file. **`schema-catch-up.sql`** in this folder
is every update (`schema.sql` and all the numbered files, in order) in ONE
script that **skips whatever the database already has**:

1. Open the staff **Health** page and press **"Copy SQL for the n missing
   updates"** (just the ones you're missing) or **"Copy the full catch-up
   script"** — or copy `supabase/schema-catch-up.sql` from GitHub.
2. Supabase dashboard → **SQL Editor** → **New query** → paste → **Run**.
3. Supabase shows a table of every update with what happened this run:
   `applied`, `skipped — already in place` (it checked the database and the
   table/column was already there) or `skipped — recorded earlier`.

Safe to run as often as you like. If any step fails, **nothing** is kept and
the error names the file, so you can't end up half-updated. On a brand-new
database it sets everything up from scratch (including `schema.sql`'s sample
show, which you can delete from the dashboard).

How it remembers: a small `schema_versions` table (created by the script,
staff-invisible) records each file as it is applied. The first time it runs on
an existing database that table is empty, so it also looks at the database
itself — "is the `judge_cards` table there?" — and records those as already in
place rather than re-running them.

The file is generated from the numbered files by
`node scripts/build-catch-up-sql.mjs` (it also runs on every website build),
so it is always in step with them. Don't edit `schema-catch-up.sql` by hand.

---

## ⚠️ Still to run on the live database

These are the most recent and may not be applied yet. If a feature below
"does nothing" when you click it, it's almost always because its migration
hasn't been run.

- [ ] **v13** — `schema-v13-cancellation-reason.sql`
      → makes the **Cancel event** button work (stores the reason for cancelling)
- [ ] **v14** — `schema-v14-hp-category.sql`
      → lets each class be tagged with a **High Points category** so results
        push to the right leaderboard
- [ ] **v15** — `schema-v15-hp-show-date.sql`
      → makes High Points month columns label correctly (e.g. "Nov '25")
        from the event's real date instead of guessing from the show name
- [ ] **v16** — `schema-v16-security-lockdown.sql`
      → **security fix**: stops exhibitor names/emails and push-notification
        keys being readable by the public. ⚠️ Run this only AFTER the matching
        code update is live on Vercel (the code update ships in the same pull
        request as this file) — running it against older code breaks the
        registration success page and the "Notify me" button.
- [ ] **v17** — `schema-v17-live-activity-tokens.sql`
      → only needed for the companion iPhone app (Live Activities). Adds the
        table that tracks which phones are showing the Lock Screen live card.
        Safe to skip until that app is being built.
- [ ] **v18** — `schema-v18-clubs-foundation.sql`
      → first step toward supporting **other clubs**. Creates the "club" idea,
        tags all current data as HCQHA's, and adds per-club staff logins.
        **Non-breaking** — nothing changes for HCQHA, safe to run anytime. The
        actual per-club isolation is a later, deliberate migration.
- [ ] **v19** — `schema-v19-class-categories.sql`
      → adds the **Program category** field on classes so schedules and entry
        forms can group classes like the printed show program.
- [ ] **v20** — `schema-v20-program-breaks.sql`
      → adds **Program break** headings before/after classes, e.g. "SET UP TRAIL",
        "BREAK FOR GEAR CHANGE", or "FINISH", so schedules can match the printed program.
- [ ] **v21** — `schema-v21-event-patterns-pdf.sql`
      → lets staff choose one custom rider-facing **Patterns PDF** for the public
        Patterns PDF link, while keeping the generated class pattern book as fallback.
- [ ] **v22** — `schema-v22-site-settings.sql`
      → adds site-wide settings, currently used to toggle the **High Points
        results are not up to date / TBC** notice.
- [ ] **v23** — `schema-v23-club-memberships.sql`
      → adds **club memberships**: the public "Become a member" page (join and
        pay online, with horse details), the coordinator Memberships page
        (approve/reject, set prices), and the "membership required to enter
        events" switch (starts OFF). Run v22 first — this uses site settings.
- [ ] **v24** — `schema-v24-highpoints-breeds.sql`
      → adds **breed-specific High Points**: separate leaderboards for Paint,
        Appaloosa (and any other breed you add) alongside the existing AQHA
        ones, which are not changed. Run v22 first — this uses site settings.
- [ ] **v25** — `schema-v25-member-accounts.sql`
      → adds **member accounts**: members sign in at `/account` with a 6-digit
        emailed code (or a password they set themselves — the emailed code
        doubles as "forgot password") to see and update their contact details,
        the people on their membership (families) and their horses. Also lets
        the join form collect family members' names, and adds a "people
        included" setting on each membership type. Run v23 first — this
        builds on club memberships.
- [ ] **v26** — `schema-v26-member-service-role-grants.sql`
      → grants the server-only `service_role` access to the private member
        account/session/code tables created by v25. Run this if account
        sign-in says Supabase rejected account-table access.
- [ ] **v27** — `schema-v27-member-portal-service-role-grants.sql`
      → grants the server-only `service_role` access to the membership rows
        the `/account` portal reads after sign-in. Run this if the emailed code
        works but the portal says it couldn't load your details.
- [ ] **v28** — `schema-v28-member-horse-numbering-grants.sql`
      → grants the server-only `service_role` read access to the official horse
        registry so member-added horses can use the existing back number, or the
        next available number when the horse is new.
- [ ] **v29** — `schema-v29-day-memberships.sql`
      → adds day-membership fields to online event registrations so non-annual
        members can pay a $20 one-event membership at checkout.
- [ ] **v30** — `schema-v30-replacement-numbers.sql`
      → adds replacement-number fields to online event registrations so entrants
        can buy replacement numbers for $5 during event checkout.
- [ ] **v31** — `schema-v31-square-oauth.sql`
      → stores the club's Square authorisation (OAuth) so online payments can
        run through the app's Square connection and carry the platform fee.
        Needed before the "Connect Square" button on the Registrations page works.
- [ ] **v32** — `schema-v32-registration-cancellation.sql`
      → lets staff cancel unpaid registrations (and lets them auto-expire after
        48 hours), including killing the Square checkout link so it can't be
        paid later. Cancelling works without this, but link-killing needs it.
- [ ] **v33** — `schema-v33-entry-horse-numbering.sql`
      → lets the entry form auto-assign the next available back number to a
        brand-new horse when payment is confirmed, registering the horse
        permanently. Without this the number is assigned but not saved to the
        registry (so it isn't reserved for the horse).
- [ ] **v34** — `schema-v34-event-fees.sql`
      → adds a per-event **ground fee** and **admin fee** on top of the
        per-class entry fee, charged once per person per event (coming back
        to add more entries doesn't charge them again).
- [ ] **v35** — `schema-v35-entry-registration-numbers.sql`
      → show entries now collect the **rider's and horse's association
        registration numbers** (AQHA / PHAA / AAA / …) for points checking.
        Without this, entries still work but the numbers aren't stored.
- [ ] **v36** — `schema-v36-registration-refunds.sql`
      → lets staff **issue Square refunds** (full or part of an online entry)
        from the Registrations page and records how much was refunded. Without
        this the refund button still works, but the running total isn't stored.
- [ ] **v37** — `schema-v37-registration-membership-basis.sql`
      → stamps each online entry with **how it met the membership rule**
        (member, joined at checkout, day membership, or "rule was off") so the
        Registrations page can show it with certainty. Without this the page
        still works — it just works out the status from the members list.
- [ ] **v38** — `schema-v38-hide-classes.sql`
      → lets you **hide empty classes instead of deleting them** when closing
        entries, and reactivate them in one click if someone enters on the day.
        Without this the "Hide" option shows a message asking you to run it.
- [ ] **v39** — `schema-v39-new-number-fees.sql`
      → powers the **New numbers** staff list and the **$5 additional-horse
        number** fee (a member's first number is covered by membership). Without
        it the list still shows members' horses, but the $5 fees aren't tracked
        and show-entry new-number requests aren't flagged.
- [ ] **v40** — `schema-v40-family-member-emails.sql`
      → lets each person on a **family membership** have their own email, so
        they can enter events under it and be recognised as a member. Without
        it the email boxes still show but the address isn't saved.
- [ ] **v41** — `schema-v41-family-member-details.sql`
      → adds each family member's own **AQHA member number**, phone and other
        associations. Without it those boxes still show but aren't saved.
- [ ] **v42** — `schema-v42-member-club-registrations.sql`
      → lets each member and family member list **multiple clubs** (AQHA, PHAA
        Paint, AAA, etc.) with their number, instead of a single AQHA field.
        Without it the club list shows but isn't saved.
- [ ] **v43** — `schema-v43-championship-classes.sql`
      → powers **Champ & Reserve / Grand Champion** classes: staff link the
        qualifying classes, and the championship draw fills itself with the
        1st & 2nd place-getters when the last one completes. Without it,
        saving a championship's qualifying classes shows a run-this message.
- [ ] **v44** — `schema-v44-gate-access.sql`
      → powers the **Gate access** link: the gate marshal gets gate controls
        only (advance the TBC draw, scratch/restore) with no staff login.
        Without it the Gate access button shows a run-this message.
- [ ] **v45** — `schema-v45-result-sheets.sql`
      → lets staff attach **photos of each judge's paper result sheets** to a
        class (shown on the public Results page). Without it uploading shows
        a run-this message.
- [ ] **v46** — `schema-v46-rider-registrations.sql`
      → gives the **Riders registry a list of association numbers** per rider
        (AQHA, PHAA, …), auto-filled on the entry form by name or number and
        copied back from paid entries — the same system horses already have.
        Existing single member numbers are carried over automatically.
        Without it the entry form simply doesn't auto-fill rider numbers.

- [ ] **v47** — `schema-v47-clinic-deposits.sql`
      → clinics: **non-refundable deposit + pay-the-balance-later** (balance
        due 2 weeks before), and a **price per spot type** (e.g. Fence
        sitting cheaper than a Rider spot). Without it clinics keep the old
        single-fee pay-in-full behaviour.

- [ ] **v48** — `schema-v48-committee-viewers.sql`
      → **committee read-only staff accounts**: create their login as usual
        (Authentication → Users), then add them to the viewers list with the
        SQL snippet at the bottom of the file. They see the whole back end;
        the database refuses every change from their login.

- [ ] **v49** — `schema-v49-program-presets.sql`
      → **shared program presets**: lets the Program builder save a show's
        program (classes, headings, breaks, championship links) as a named
        preset every staff login can apply to future events. Run it after
        v48 if possible (it also blocks read-only accounts from editing
        presets; if v48 comes later, just run this file again).

- [ ] **v50** — `schema-v50-partial-balance.sql`
      → **part payments on clinic balances**: participants can pay their
        remaining balance in chunks (min $10) and staff can record partial
        cash/bank-transfer amounts; the owing figure counts down and the
        balance marks itself paid when the payments add up. Without it,
        balances stay all-or-nothing.

- [ ] **v51** — `schema-v51-spot-type-closed.sql`
      → **close bookings for one spot type**: lets you shut a clinic's
        rider spots (from the spot type's ⋯ menu) while fence sitting stays
        open, then "Close entries" shuts everything. Without it the menu
        item shows a reminder to run this file.

- [ ] **v52** — `schema-v52-refund-log.sql`
      → **Square refund confirmation**: keeps Square's refund ID and status
        (PENDING → COMPLETED) for every refund issued from the Registrations
        page, with a "Check with Square" button. Without it, only the
        running refunded total is kept and there's no way to confirm a
        refund actually went through.

- [ ] **v53** — `schema-v53-break-timer.sql`
      → **break timer**: staff (dashboard) or the gate marshal can start a
        10/15/30-minute break; the public live page shows the break name,
        "back at about 10:15" and a countdown. Without it the break buttons
        show a reminder to run this file.

- [ ] **v54** — `schema-v54-hcqha-numbers.sql`
      → **HCQHA membership numbers**: every person on an approved membership
        (applicant + family members) gets a permanent club number, issued on
        approval/renewal and printable on the member list. Without it the
        "Assign numbers" button shows a reminder to run this file.

- [ ] **v55** — `schema-v55-balance-reminders.sql`
      → **balance reminder emails**: "Send reminder" buttons on the
        Registrations page, a log + "last reminder" date per registration,
        and per-clinic automatic reminders on chosen days before the clinic
        (needs the CRON_SECRET setting in Vercel for the daily run).
- [ ] **v56** — `schema-v56-raffles.sql`
      → **fundraising raffles**: the "🎟 Raffles" page on the dashboard and
        the public /raffle pages. Without it the Raffles page shows a
        "tables haven't been created" notice and nothing can be sold.
- [ ] **v57** — `schema-v57-raffle-live-updates.sql`
      → **raffle ticket board updates instantly**: every open raffle page
        (public and staff) hears about a sale the moment it happens instead
        of waiting for its next timer tick. Without it the pages still work
        but refresh on a timer only.
- [ ] **v58** — `schema-v58-paypal.sql`
      → **PayPal as a payment option**: records which provider (Square or
        PayPal) each checkout went through. Until it's run the PayPal
        choice stays hidden on every form, even with the PayPal keys set.
- [ ] **v59** — `schema-v59-spot-type-membership-exempt.sql`
      → **"No membership needed" per clinic spot type** (e.g. fence
        sitting). Without it the ⋯ menu option shows a reminder to run it.
- [ ] **v60** — `schema-v60-website-fees.sql`
      → **Website fees statement**: records the website fee earned on each
        online payment (Square and PayPal) so the "💵 Website fees" page can
        produce the monthly bill for the club. Until it's run no fee lines
        are recorded (the page says so).
- [ ] **v61** — `schema-v61-event-extras.sql`
      → **Camping & yards bookable online**: the dashboard's "🏕 Camping &
        yards" button and the entry form's booking section need it. Until
        it's run the button says so and the entry form simply shows nothing
        to book.
- [ ] **v62** — `schema-v62-extras-pool.sql`
      → **Yards/camping shared between two events on the same weekend**: the
        "Shared with another event" name on each item. Until it's run the
        manager saves the item without the shared name and says so.
- [ ] **v63** — `schema-v63-judge-cards.sql`
      → **Digital judge cards**: the "⚖ Judge access" button on the dashboard
        (one private link per judge), the judge page that works with no
        reception, and the "sent / waiting" line under each class. Until it's
        run the button says it needs this update.
- [ ] **v64** — `schema-v64-pattern-cards.sql`
      → **Pattern judge cards** (Trail, Western Riding, Ranch Riding,
        Showmanship / Horsemanship / Hunt Seat Eq): the "Judge's card"
        choice + obstacle names on the class form, and the judge page's
        obstacle boxes with penalties. Needs v63 first. Until it's run the
        class form saves with the card on Auto only, and the judge page
        still works for placings / scores cards.
- [ ] **v65** — `schema-v65-withdrawn-registrations.sql`
      → **Withdrawn clinic entries**: "Withdrawn — keep deposit, write off
        balance" on the Registrations page, so someone who pulled out stops
        showing as BALANCE OVERDUE. Until it's run the button says so.
- [ ] **v66** — `schema-v66-staff-viewers-service-role-grants.sql`
      → lets the **Staff access** page create read-only (committee view)
        logins — one permission line the v48 file missed. Until it's run the
        page shows a yellow "run schema-v66" banner.

Tick these off once you've run them — or just run the catch-up script above.

---

## Full history

| File | Adds |
|---|---|
| `schema.sql` | The starting point: events, classes, entries, security rules, live syncing, one sample event |
| `schema-v2-horses.sql` | Horse registry, club registrations, push-notification subscriptions, multi-day class field |
| `schema-v3-highpoints.sql` | High Points table — cumulative season points for horses and riders |
| `schema-v4-riders.sql` | Riders registry (exhibitors tracked separately from horses) |
| `schema-v5-registrations.sql` | Online registration + per-class entry fee |
| `schema-v6-scoring-modes.sql` | Per-class scoring mode (score / placing / class only) |
| `schema-v7-two-judges.sql` | Optional second judge + second score per entry |
| `schema-v8-entries-closed.sql` | Open/close online entries; draw randomisation |
| `schema-v9-event-lifecycle.sql` | Full event lifecycle: pre-open → open → closed → live → completed → archived |
| `schema-v10-cascade-fixes.sql` | Deleting a class cleanly removes its leftover registration rows |
| `schema-v11-tbc-draw.sql` | "TBC draw" mode — a `called` flag to advance the draw without entering scores live |
| `schema-v12-clinics.sql` | Clinic events (capacity-limited spot types instead of scored classes) |
| `schema-v13-cancellation-reason.sql` | A reason field for cancelled events |
| `schema-v14-hp-category.sql` | A High Points category tag on each class |
| `schema-v15-hp-show-date.sql` | Stores the event date with each High Points result |
| `schema-v16-security-lockdown.sql` | Security: registrations and push subscriptions are no longer publicly readable/writable |
| `schema-v17-live-activity-tokens.sql` | iPhone companion app: tracks phones showing the Lock Screen Live Activity |
| `schema-v18-clubs-foundation.sql` | Multi-club foundation: the "club" concept, per-club branding + staff logins (non-breaking) |
| `schema-v19-class-categories.sql` | Program category tag on classes for grouped schedules and entry forms |
| `schema-v20-program-breaks.sql` | Program break headings before/after classes for printed-program-style schedules |
| `schema-v21-event-patterns-pdf.sql` | Custom rider-facing Patterns PDF per event |
| `schema-v22-site-settings.sql` | Site-wide settings, including the High Points TBC notice toggle |
| `schema-v23-club-memberships.sql` | Club memberships: join + pay online, horse details, committee approval, members-only event entry switch |
| `schema-v24-highpoints-breeds.sql` | Breed-specific High Points leaderboards (Paint, Appaloosa, …) alongside the AQHA ones |
| `schema-v25-member-accounts.sql` | Member self-service portal: email-code or password sign-in, app-managed member sessions, people covered by a membership, "people included" on membership types |
| `schema-v26-member-service-role-grants.sql` | Grants service-role table access for private member account/session/code tables |
| `schema-v27-member-portal-service-role-grants.sql` | Grants service-role table access for membership rows used by the member portal |
| `schema-v28-member-horse-numbering-grants.sql` | Grants service-role registry reads for automatic member horse back numbers |
| `schema-v29-day-memberships.sql` | Records $20 day memberships purchased during online event entry |
| `schema-v30-replacement-numbers.sql` | Records $5 replacement numbers purchased during online event entry |
| `schema-v31-square-oauth.sql` | Stores the club's Square OAuth connection for payments + the platform fee split |
| `schema-v32-registration-cancellation.sql` | Staff cancel + 48h auto-expiry for unpaid registrations, incl. Square link deletion |
| `schema-v33-entry-horse-numbering.sql` | Auto-assign + permanently register back numbers for new horses entered online |
| `schema-v34-event-fees.sql` | Per-event ground fee + admin fee, charged once per person per event |
| `schema-v35-entry-registration-numbers.sql` | Rider + horse association registration numbers on show entries (points checking) |
| `schema-v36-registration-refunds.sql` | Records Square refunds issued from the Registrations page (refunded amount + reason) |
| `schema-v37-registration-membership-basis.sql` | Stamps each online entry with how it satisfied the membership rule (audit) |
| `schema-v38-hide-classes.sql` | Hide empty classes instead of deleting them when closing entries (reactivatable) |
| `schema-v39-new-number-fees.sql` | New-numbers staff list: $5 additional-horse fee on member horses + a flag on show-entry new-number requests |
| `schema-v40-family-member-emails.sql` | Each person on a family membership can have their own email (enter events under it) |
| `schema-v41-family-member-details.sql` | Each family member's own AQHA number, phone and other associations |
| `schema-v42-member-club-registrations.sql` | Members + family members list multiple club registrations (AQHA/PHAA/AAA/…), not just AQHA |
| `schema-v43-championship-classes.sql` | Champ & Reserve / Grand Champion classes auto-fill from their feeder classes' place-getters |
| `schema-v44-gate-access.sql` | Gate marshal link: gate controls only (advance TBC draw, scratch), no staff login |
| `schema-v45-result-sheets.sql` | Photos of each judge's paper result sheets attached per class (public Results page) |
| `schema-v46-rider-registrations.sql` | Rider association numbers in the registry (multi-club, auto-fill + copy-back like horses) |
| `schema-v47-clinic-deposits.sql` | Clinic deposits (non-refundable, balance due 2 weeks out) + per-spot-type pricing |
| `schema-v48-committee-viewers.sql` | Committee read-only staff accounts (staff_viewers + restrictive no-write policies) |
| `schema-v49-program-presets.sql` | Shared program presets: saved program layouts every staff login can apply from the Program builder |
| `schema-v50-partial-balance.sql` | Part payments on clinic balances: payments log, counts down what's owing, auto-marks paid in full |
| `schema-v51-spot-type-closed.sql` | Close online bookings for a single clinic spot type (`classes.entries_closed`) while others stay open |
| `schema-v52-refund-log.sql` | Per-refund log with Square's refund id + status (`registrations.refund_log`) so staff can confirm a refund COMPLETED |
| `schema-v53-break-timer.sql` | Break timer (`events.break_until` / `break_label`) — countdown + return time on the live page, started from the dashboard or gate |
| `schema-v54-hcqha-numbers.sql` | HCQHA membership numbers (`club_members.hcqha_number`, `club_member_people.hcqha_number`) — one permanent number per person |
| `schema-v55-balance-reminders.sql` | Balance reminder emails: `registrations.balance_reminder_log` / `_last_at`, `events.balance_reminder_days` |
| `schema-v56-raffles.sql` | Fundraising raffles: `raffles`, `raffle_orders`, `raffle_tickets`, `raffle_secrets` (fair-draw seed, service role only) |
| `schema-v57-raffle-live-updates.sql` | Raffle live updates: `raffles.tickets_changed_at` (bumped on every ticket change so public pages re-fetch) + raffle tables added to the realtime publication |
| `schema-v58-paypal.sql` | PayPal payment option: `payment_provider` on registrations / club_members / raffle_orders, `registrations.balance_payment_provider` |
| `schema-v59-spot-type-membership-exempt.sql` | `classes.membership_exempt` — a clinic spot type anyone can book without a club membership |
| `schema-v60-website-fees.sql` | Website fees ledger (`website_fees`, one line per online payment / refund) + `website_fee_months` (billed / paid status) for the monthly statement |
| `schema-v61-event-extras.sql` | Camping & yards: `event_extras` (what's bookable per event, per night or per event, with capacity) + `registration_extras` (what each registration booked, which nights) |
| `schema-v62-extras-pool.sql` | `event_extras.pool` — a shared name that makes the matching items on two events one pool of yards/sites (capacity counted across both; "already booked" shown on the second event's form) |
| `schema-v63-judge-cards.sql` | Digital judge cards: `judge_codes` (per-judge links), `judge_cards` (what each judge sent per class), `events.judge_entry_mode` (judge taps / scribe enters) |
| `schema-v64-pattern-cards.sql` | Pattern judge cards: `classes.judge_card_type` (which card — auto / placings / scores / trail / western_riding / ranch_riding / pattern3), `classes.judge_card_config` (obstacle names + tie-breaker order), `judge_cards.layout` (the boxes as that judge's card had them) |
| `schema-v65-withdrawn-registrations.sql` | Withdrawn clinic entries: `registrations.withdrawn_at` / `withdrawn_by` (deposit kept, balance written off) |
| `schema-v66-staff-viewers-service-role-grants.sql` | Grants the server (service role) write access to `staff_viewers` so read-only logins can be created from the Staff access page |
| `schema-catch-up.sql` | GENERATED — all of the above in one skip-what's-done script (see "The easy way" at the top); records what it applied in `schema_versions` |

## For whoever updates the code next

- Migrations are **forward-only and additive** — we never drop columns or
  delete data (permanent-records rule, see `CLAUDE.md`). A new feature that
  needs a schema change gets the next `schema-vN-*.sql` number.
- After writing a migration file, add a row to the table above **and** the
  checklist at the top, because the owner is not a developer and relies on
  this file to know what still needs running. Then run
  `npm run catch-up` (or just `npm run build`) and commit the regenerated
  `schema-catch-up.sql` + `lib/schemaCatchUp.generated.mjs`. The new file is
  picked up automatically; if the database can tell on its own that it has
  been applied (a table or column it creates), add that test to `PROBES` in
  `scripts/build-catch-up-sql.mjs` so the first catch-up run on an existing
  database records it as "already in place" instead of re-running it.
- **Never edit an already-shipped numbered file** — the catch-up script
  records each FILE as applied and will not run it again. A fix goes in a
  new numbered file (that's also why v66 exists instead of a change to v48).
- The app reads schema changes lazily: most pages just `select *`, so a new
  nullable column appears automatically once the migration is run — no code
  redeploy is needed to "see" it.
