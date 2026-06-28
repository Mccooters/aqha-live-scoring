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

These three are the most recent and may not be applied yet. If a feature below
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
