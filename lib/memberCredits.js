// Member credits (schema-v68): the shared maths for the server, the staff
// pages and the member portal. A credit belongs to an EMAIL ADDRESS — the
// same email-as-identity rule memberships use everywhere else — so it
// follows the person from season to season.
//
//   balance   = every ledger row added up (+ given, − used or taken back)
//   held      = credit applied by checkouts that are still unpaid; they may
//               yet be paid, so it can't be spent twice meanwhile (unpaid
//               checkouts lapse after 48 hours and release it)
//   available = balance − held, never below zero

export const normalizeCreditEmail = (email) => String(email ?? "").trim().toLowerCase();

export function sumCredits(rows) {
  return (rows ?? []).reduce((s, r) => s + (Number(r?.amount_cents) || 0), 0);
}

export function creditSummary(rows, pendingRegistrations) {
  const balance_cents = sumCredits(rows);
  const held_cents = (pendingRegistrations ?? []).reduce((s, r) => s + Math.max(0, Number(r?.credit_cents) || 0), 0);
  return { balance_cents, held_cents, available_cents: Math.max(0, balance_cents - held_cents) };
}

// { [email]: summary } for every email with a ledger row or a hold.
export function creditBalanceMap(rows, pendingRegistrations) {
  const byEmail = {};
  for (const r of rows ?? []) {
    const e = normalizeCreditEmail(r?.email);
    if (!e) continue;
    (byEmail[e] ??= { rows: [], pending: [] }).rows.push(r);
  }
  for (const p of pendingRegistrations ?? []) {
    const e = normalizeCreditEmail(p?.contact_email);
    if (!e || !((Number(p?.credit_cents) || 0) > 0)) continue;
    (byEmail[e] ??= { rows: [], pending: [] }).pending.push(p);
  }
  return Object.fromEntries(Object.entries(byEmail).map(([e, v]) => [e, creditSummary(v.rows, v.pending)]));
}

export const CREDIT_KIND_LABEL = { credit: "Credit given", use: "Used on an event", adjust: "Taken back / adjusted" };
