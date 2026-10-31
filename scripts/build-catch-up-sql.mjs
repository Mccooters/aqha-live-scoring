#!/usr/bin/env node
// Builds the database "catch-up" script from the numbered migration files.
//
//   node scripts/build-catch-up-sql.mjs        (also runs before every `next build`)
//
// Writes two things:
//   supabase/schema-catch-up.sql     one file that applies schema.sql and every
//                                    schema-vNN-*.sql in order, skipping what the
//                                    database already has. Safe to run as often
//                                    as you like.
//   lib/schemaCatchUp.generated.mjs   the same steps as data, so the staff Health
//                                    page can offer "copy the SQL for the
//                                    updates you're missing".
//
// The numbered files stay exactly as they are (history + the Health page ticks).
// A new schema-vNN-*.sql file is picked up automatically — add it to PROBES
// below if the database can tell on its own that the file has been applied
// (a table or column it creates). Files without a probe are simply run; every
// file since v22 is written to be safe to run twice, so that's fine.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatchUpSql, TAG } from "../lib/schemaCatchUp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sqlDir = join(root, "supabase");

// "This file is already applied when…" — a SQL expression that is true on a
// database that has it. Two helpers exist while the script runs:
//   catch_up_has_table('name')            catch_up_has_column('table', 'column')
// Files that only grant privileges or tidy data (v9, v26–v28, v33) have no
// visible footprint; they are re-run, which is harmless.
const PROBES = {
  "schema.sql": "catch_up_has_table('events')",
  "schema-v2-horses.sql": "catch_up_has_table('horses')",
  "schema-v3-highpoints.sql": "catch_up_has_table('high_points')",
  "schema-v4-riders.sql": "catch_up_has_table('riders')",
  "schema-v5-registrations.sql": "catch_up_has_table('registrations')",
  "schema-v6-scoring-modes.sql": "catch_up_has_column('classes', 'scoring_mode')",
  "schema-v7-two-judges.sql": "catch_up_has_column('entries', 'score2')",
  "schema-v8-entries-closed.sql": "catch_up_has_column('events', 'entries_open')",
  "schema-v10-cascade-fixes.sql":
    "exists (select 1 from pg_constraint where conname = 'registration_entries_class_id_fkey' and confdeltype = 'c')",
  "schema-v11-tbc-draw.sql": "catch_up_has_column('entries', 'called')",
  "schema-v12-clinics.sql": "catch_up_has_column('events', 'event_type')",
  "schema-v13-cancellation-reason.sql": "catch_up_has_column('events', 'cancellation_reason')",
  "schema-v14-hp-category.sql": "catch_up_has_column('classes', 'hp_category')",
  "schema-v15-hp-show-date.sql": "catch_up_has_column('high_points', 'show_date')",
  // v16 removes the public-read policies v5 created; it's done once they're gone.
  "schema-v16-security-lockdown.sql":
    "catch_up_has_table('registrations') and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'registrations' and policyname = 'public read registrations')",
  "schema-v17-live-activity-tokens.sql": "catch_up_has_table('live_activity_tokens')",
  "schema-v18-clubs-foundation.sql": "catch_up_has_table('clubs')",
  "schema-v18-device-push-tokens.sql": "catch_up_has_table('device_push_tokens')",
  "schema-v19-class-categories.sql": "catch_up_has_column('classes', 'program_category')",
  "schema-v20-program-breaks.sql": "catch_up_has_column('classes', 'program_break_before')",
  "schema-v21-event-patterns-pdf.sql": "catch_up_has_column('events', 'patterns_pdf_url')",
  "schema-v22-site-settings.sql": "catch_up_has_table('site_settings')",
  "schema-v23-club-memberships.sql": "catch_up_has_table('club_members')",
  "schema-v24-highpoints-breeds.sql": "catch_up_has_column('high_points', 'breed')",
  "schema-v25-member-accounts.sql": "catch_up_has_table('club_member_people')",
  "schema-v29-day-memberships.sql": "catch_up_has_column('registrations', 'day_membership')",
  "schema-v30-replacement-numbers.sql": "catch_up_has_column('registrations', 'replacement_numbers')",
  "schema-v31-square-oauth.sql": "catch_up_has_table('square_connection')",
  "schema-v32-registration-cancellation.sql": "catch_up_has_column('registrations', 'cancelled_at')",
  "schema-v34-event-fees.sql": "catch_up_has_column('events', 'ground_fee_cents')",
  "schema-v35-entry-registration-numbers.sql": "catch_up_has_column('registration_entries', 'rider_registrations')",
  "schema-v36-registration-refunds.sql": "catch_up_has_column('registrations', 'refunded_cents')",
  "schema-v37-registration-membership-basis.sql": "catch_up_has_column('registrations', 'membership_basis')",
  "schema-v38-hide-classes.sql": "catch_up_has_column('classes', 'hidden')",
  "schema-v39-new-number-fees.sql": "catch_up_has_column('club_member_horses', 'number_fee_cents')",
  "schema-v40-family-member-emails.sql": "catch_up_has_column('club_member_people', 'email')",
  "schema-v41-family-member-details.sql": "catch_up_has_column('club_member_people', 'aqha_member_number')",
  "schema-v42-member-club-registrations.sql": "catch_up_has_column('club_members', 'association_registrations')",
  "schema-v43-championship-classes.sql": "catch_up_has_column('classes', 'champ_feeder_ids')",
  "schema-v44-gate-access.sql": "catch_up_has_table('gate_codes')",
  "schema-v45-result-sheets.sql": "catch_up_has_column('classes', 'result_sheets')",
  "schema-v46-rider-registrations.sql": "catch_up_has_table('rider_registrations')",
  "schema-v47-clinic-deposits.sql": "catch_up_has_column('classes', 'deposit_cents')",
  "schema-v48-committee-viewers.sql": "catch_up_has_table('staff_viewers')",
  "schema-v49-program-presets.sql": "catch_up_has_table('program_presets')",
  "schema-v50-partial-balance.sql": "catch_up_has_column('registrations', 'balance_payments')",
  "schema-v51-spot-type-closed.sql": "catch_up_has_column('classes', 'entries_closed')",
  "schema-v52-refund-log.sql": "catch_up_has_column('registrations', 'refund_log')",
  "schema-v53-break-timer.sql": "catch_up_has_column('events', 'break_until')",
  "schema-v54-hcqha-numbers.sql": "catch_up_has_column('club_member_people', 'hcqha_number')",
  "schema-v55-balance-reminders.sql": "catch_up_has_column('registrations', 'balance_reminder_log')",
  "schema-v56-raffles.sql": "catch_up_has_table('raffles')",
  "schema-v57-raffle-live-updates.sql": "catch_up_has_column('raffles', 'tickets_changed_at')",
  "schema-v58-paypal.sql": "catch_up_has_column('registrations', 'payment_provider')",
  "schema-v59-spot-type-membership-exempt.sql": "catch_up_has_column('classes', 'membership_exempt')",
  "schema-v60-website-fees.sql": "catch_up_has_table('website_fees')",
  "schema-v61-event-extras.sql": "catch_up_has_table('event_extras')",
  "schema-v62-extras-pool.sql": "catch_up_has_column('event_extras', 'pool')",
  "schema-v63-judge-cards.sql": "catch_up_has_table('judge_cards')",
  "schema-v64-pattern-cards.sql": "catch_up_has_column('classes', 'judge_card_type')",
  "schema-v65-withdrawn-registrations.sql": "catch_up_has_column('registrations', 'withdrawn_at')",
  "schema-v66-staff-viewers-service-role-grants.sql":
    "catch_up_has_table('staff_viewers') and has_table_privilege('service_role', 'public.staff_viewers', 'insert')",
  "schema-v67-paid-at.sql": "catch_up_has_column('registrations', 'paid_at')",
  "schema-v68-member-credits.sql": "catch_up_has_table('member_credits')",
  "schema-v69-sponsors.sql": "catch_up_has_table('sponsors')",
};

function versionOf(file) {
  if (file === "schema.sql") return 1;
  const m = /^schema-v(\d+)-/.exec(file);
  return m ? Number(m[1]) : null;
}

function describe(sql) {
  // The first comment line of the file, minus the "schema-vNN:" prefix and
  // the "run in Supabase…" instruction; the oldest files describe themselves
  // on their "Adds:" line instead.
  const lines = sql.split("\n").filter((l) => l.startsWith("--")).map((l) => l.replace(/^--\s*/, "").trim());
  let what = (lines[0] ?? "")
    .replace(/^(AQHA Live Scoring —\s*)?(schema-)?v\d+[^:]*:\s*/i, "")
    .replace(/\s*[—-]+\s*run (this once )?in Supabase.*$/i, "")
    .trim();
  if (/^(AQHA Live Scoring — )?v\d+ migration$/i.test(what)) {
    const adds = lines.find((l) => /^Adds:/i.test(l));
    what = adds ? adds.replace(/^Adds:\s*/i, "") : what;
  }
  return what;
}

const files = readdirSync(sqlDir)
  .filter((f) => f === "schema.sql" || /^schema-v\d+-.*\.sql$/.test(f))
  .sort((a, b) => versionOf(a) - versionOf(b) || a.localeCompare(b));

const steps = files.map((file) => {
  const sql = readFileSync(join(sqlDir, file), "utf8").replace(/\r\n/g, "\n").trimEnd();
  if (sql.includes(TAG)) throw new Error(`${file} contains ${TAG}, which the catch-up script uses as its quote marker`);
  const probe = PROBES[file] ?? null;
  return { file, version: versionOf(file), what: describe(sql), probe, sql };
});

for (const name of Object.keys(PROBES)) {
  if (!files.includes(name)) throw new Error(`PROBES lists ${name} but supabase/${name} does not exist`);
}

const full = buildCatchUpSql(steps);
writeFileSync(join(sqlDir, "schema-catch-up.sql"), full);

mkdirSync(join(root, "lib"), { recursive: true });
const generated = `// GENERATED by scripts/build-catch-up-sql.mjs — do not edit by hand.
// The numbered files in supabase/ are the source; this is what the Health
// page uses to build a catch-up script for the updates a database is missing.
/* eslint-disable */
export const STEPS = ${JSON.stringify(steps.map(({ file, version, what, probe, sql }) => ({ file, version, what, probe, sql })), null, 1)};
`;
writeFileSync(join(root, "lib", "schemaCatchUp.generated.mjs"), generated);

console.log(`catch-up: ${steps.length} steps (${steps.filter((s) => s.probe).length} with probes) → supabase/schema-catch-up.sql, lib/schemaCatchUp.generated.mjs`);
