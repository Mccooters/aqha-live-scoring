import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";

// Read-only lookup for the post-checkout success page. The registrations
// table is no longer publicly readable (it holds names and email addresses),
// so the success page asks the server instead. The registration ID is a long
// random code that only appears in the payer's own redirect URL, so knowing
// it is proof enough to see this one registration.
export async function GET(req) {
  const regId = new URL(req.url).searchParams.get("id");
  if (!regId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const db = adminClient();
  const baseSelect = "id, status, contact_name, contact_email, total_cents, day_membership, day_membership_cents, replacement_numbers, replacement_numbers_cents, registration_entries(id, back_number, horse_name, exhibitor)";
  // Camping & yards (schema-v61) ride along when the tables exist.
  // Names per site / yard (schema-v68) when that column exists too.
  const extrasSelect = (withNames) =>
    `${baseSelect}, registration_extras(id, quantity, nights, amount_cents, notes${withNames ? ", names" : ""}, event_extras(name, kind, unit))`;
  let { data: reg, error } = await db
    .from("registrations")
    .select(extrasSelect(true))
    .eq("id", regId)
    .maybeSingle();
  if (error && /names/i.test(`${error.message ?? ""} ${error.details ?? ""}`)) {
    ({ data: reg, error } = await db.from("registrations").select(extrasSelect(false)).eq("id", regId).maybeSingle());
  }
  if (error && /registration_extras|event_extras/i.test(`${error.message ?? ""} ${error.details ?? ""}`)) {
    ({ data: reg, error } = await db.from("registrations").select(baseSelect).eq("id", regId).maybeSingle());
  }
  if (error) {
    const msg = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
    if (msg.includes("day_membership") || msg.includes("replacement_numbers")) {
      const retry = await db
        .from("registrations")
        .select(
          "id, status, contact_name, contact_email, total_cents, registration_entries(id, back_number, horse_name, exhibitor)"
        )
        .eq("id", regId)
        .maybeSingle();
      reg = retry.data
        ? {
            ...retry.data,
            day_membership: false,
            day_membership_cents: 0,
            replacement_numbers: false,
            replacement_numbers_cents: 0,
          }
        : null;
      error = retry.error;
    }
  }

  if (error || !reg) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Clinic deposit info (schema-v47, part payments schema-v50) —
  // best-effort so pre-migration databases still serve the success page.
  let balance = null;
  try {
    let { data: extra, error: extraErr } = await db
      .from("registrations")
      .select("deposit_cents, balance_paid_at, balance_payments, withdrawn_at, event:events(starts_on, event_type)")
      .eq("id", regId)
      .maybeSingle();
    let partials = true;
    if (extraErr && /withdrawn_at|does not exist|schema cache/i.test(extraErr.message ?? "")) {
      // v65 not run — no withdrawals can exist yet.
      ({ data: extra, error: extraErr } = await db
        .from("registrations")
        .select("deposit_cents, balance_paid_at, balance_payments, event:events(starts_on, event_type)")
        .eq("id", regId)
        .maybeSingle());
    }
    if (extraErr && /balance_payments|does not exist|schema cache/i.test(extraErr.message ?? "")) {
      partials = false; // v50 not run — full-balance behaviour only
      ({ data: extra } = await db
        .from("registrations")
        .select("deposit_cents, balance_paid_at, event:events(starts_on, event_type)")
        .eq("id", regId)
        .maybeSingle());
    }
    if (extra?.deposit_cents > 0) {
      const { balanceDueDate, balanceDueLabel, balancePaidCents, MIN_PART_PAYMENT_CENTS } = await import("../../../../lib/clinicPayments");
      const partPaid = partials ? balancePaidCents(extra) : 0;
      const paid = Boolean(extra.balance_paid_at);
      // Withdrawn (schema-v65): deposit kept, balance written off — nothing
      // owing and no pay button.
      const withdrawn = Boolean(extra.withdrawn_at);
      const owing = paid || withdrawn ? 0 : Math.max(0, (reg.total_cents ?? 0) - extra.deposit_cents - partPaid);
      balance = {
        deposit_cents: extra.deposit_cents,
        owing_cents: owing,
        paid,
        withdrawn,
        paid_part_cents: partPaid,
        // Choosing an amount only makes sense when part payments can be
        // recorded and there's more owing than the minimum chunk.
        partial_allowed: partials && !paid && !withdrawn && owing > MIN_PART_PAYMENT_CENTS,
        min_part_cents: MIN_PART_PAYMENT_CENTS,
        due_label: balanceDueLabel(extra.event?.starts_on),
        overdue: (() => { const d = balanceDueDate(extra.event?.starts_on); return d ? new Date() > d : false; })(),
      };
    }
  } catch {}

  const extras = (reg.registration_extras ?? []).map((x) => ({
    id: x.id, quantity: x.quantity, nights: x.nights ?? [], amount_cents: x.amount_cents, notes: x.notes, names: x.names ?? null,
    name: x.event_extras?.name ?? "Extra", kind: x.event_extras?.kind ?? "other", unit: x.event_extras?.unit ?? "night",
  }));
  const { registration_extras: _omit, ...rest } = reg;
  return NextResponse.json({ ...rest, extras, balance });
}
