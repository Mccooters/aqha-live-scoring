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
      "id, status, contact_name, contact_email, total_cents, day_membership, day_membership_cents, registration_entries(id, back_number, horse_name, exhibitor)"
    )
    .eq("id", regId)
    .maybeSingle();
  if (error) {
    const msg = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
    if (msg.includes("day_membership")) {
      const retry = await db
        .from("registrations")
        .select(
          "id, status, contact_name, contact_email, total_cents, registration_entries(id, back_number, horse_name, exhibitor)"
        )
        .eq("id", regId)
        .maybeSingle();
      reg = retry.data ? { ...retry.data, day_membership: false, day_membership_cents: 0 } : null;
      error = retry.error;
    }
  }

  if (error || !reg) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(reg);
}
