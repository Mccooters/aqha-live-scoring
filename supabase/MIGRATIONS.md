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

Tick these off once you've run them.

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

## For whoever updates the code next

- Migrations are **forward-only and additive** — we never drop columns or
  delete data (permanent-records rule, see `CLAUDE.md`). A new feature that
  needs a schema change gets the next `schema-vN-*.sql` number.
- After writing a migration file, add a row to the table above **and** the
  checklist at the top, because the owner is not a developer and relies on
  this file to know what still needs running.
- The app reads schema changes lazily: most pages just `select *`, so a new
  nullable column appears automatically once the migration is run — no code
  redeploy is needed to "see" it.
