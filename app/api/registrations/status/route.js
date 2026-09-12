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
  let { data: reg, error } = await db
    .from("registrations")
    .select(
      "id, status, contact_name, contact_email, total_cents, day_membership, day_membership_cents, replacement_numbers, replacement_numbers_cents, registration_entries(id, back_number, horse_name, exhibitor)"
    )
    .eq("id", regId)
    .maybeSingle();
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
      .select("deposit_cents, balance_paid_at, balance_payments, event:events(starts_on, event_type)")
      .eq("id", regId)
      .maybeSingle();
    let partials = true;
    if (extraErr && /balance_payments|does not exist|schema cache/i.test(extraErr.message ?? "")) {
      partials = false; // v50 not run — full-balance behaviour only
      ({ data: extra } = await db
        .from("registrations")
        .select("deposit_cents, balance_paid_at, event:events(starts_on, event_type)")
        .eq("id", regId)
        .maybeSingle());
    }
    if (extra?.deposit_cents > 0) {
      const { balanceDueLabel, balancePaidCents, MIN_PART_PAYMENT_CENTS } = await import("../../../../lib/clinicPayments");
      const partPaid = partials ? balancePaidCents(extra) : 0;
      const paid = Boolean(extra.balance_paid_at);
      const owing = paid ? 0 : Math.max(0, (reg.total_cents ?? 0) - extra.deposit_cents - partPaid);
      balance = {
        deposit_cents: extra.deposit_cents,
        owing_cents: owing,
        paid,
        paid_part_cents: partPaid,
        // Choosing an amount only makes sense when part payments can be
        // recorded and there's more owing than the minimum chunk.
        partial_allowed: partials && !paid && owing > MIN_PART_PAYMENT_CENTS,
        min_part_cents: MIN_PART_PAYMENT_CENTS,
        due_label: balanceDueLabel(extra.event?.starts_on),
      };
    }
  } catch {}

  return NextResponse.json({ ...reg, balance });
}
