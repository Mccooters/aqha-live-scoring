import { normalizeCreditEmail, creditSummary } from "../../../lib/memberCredits";
import { escapeIlike } from "./memberAuth";

// Member credits (schema-v68) — server-side helpers. See lib/memberCredits.js
// for the balance / held / available rule.

const missingTable = (err) => /member_credits|credit_cents|does not exist|schema cache/i.test(err?.message ?? "");

// { ready, balance_cents, held_cents, available_cents, rows }. `ready` is
// false on a database without schema-v68 (then nothing is available).
export async function creditStatus(db, email) {
  const e = normalizeCreditEmail(email);
  const empty = { ready: true, balance_cents: 0, held_cents: 0, available_cents: 0, rows: [] };
  if (!e.includes("@")) return empty;
  const { data: rows, error } = await db
    .from("member_credits")
    .select("*, event:events(name)")
    .ilike("email", escapeIlike(e))
    .order("created_at", { ascending: false });
  if (error) {
    if (!missingTable(error)) console.error("Credit lookup failed:", error.message);
    return { ...empty, ready: false };
  }
  const { data: pending } = await db
    .from("registrations")
    .select("id, credit_cents")
    .eq("status", "pending")
    .gt("credit_cents", 0)
    .ilike("contact_email", escapeIlike(e));
  return { ready: true, ...creditSummary(rows, pending ?? []), rows: rows ?? [] };
}

// A staff-given credit (or a take-back: negative amount, kind "adjust").
export async function grantCredit(db, { email, amount_cents, kind = "credit", reason, event_id, registration_id, created_by }) {
  const { data, error } = await db
    .from("member_credits")
    .insert({
      email: normalizeCreditEmail(email),
      amount_cents: Math.round(Number(amount_cents) || 0),
      kind,
      reason: reason ? String(reason).slice(0, 300) : null,
      event_id: event_id ?? null,
      registration_id: registration_id ?? null,
      created_by: created_by ?? null,
    })
    .select()
    .single();
  if (error) {
    return {
      error: missingTable(error)
        ? "Member credits need the database update — run schema-v68-member-credits.sql in the Supabase SQL Editor first."
        : error.message,
    };
  }
  return { row: data };
}

// Spend a registration's credit once it is approved. Safe to call again:
// the unique index refuses a second "use" row for the same registration.
export async function recordCreditUse(db, reg, eventName) {
  const cents = Math.max(0, Number(reg?.credit_cents) || 0);
  if (!cents) return;
  const { error } = await db.from("member_credits").insert({
    email: normalizeCreditEmail(reg.contact_email),
    amount_cents: -cents,
    kind: "use",
    reason: `Used on ${eventName ?? "an event"}`,
    event_id: reg.event_id ?? null,
    registration_id: reg.id,
    created_by: "system",
  });
  if (error && !/duplicate key|unique/i.test(error.message ?? "")) {
    console.error(`Could not record the credit used on registration ${reg.id}:`, error.message);
  }
}
