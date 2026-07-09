import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";

// Tells the entry form whether the one-off ground/admin fees are still due
// for this person at this event, so the total on screen matches what Square
// will charge. Returns only a boolean — no registration details. The create
// route re-checks this server-side at submission; this is display-only.
export async function GET(req) {
  const url = new URL(req.url);
  const eventId = url.searchParams.get("event_id");
  const email = url.searchParams.get("email");
  if (!eventId || !email?.trim() || !email.includes("@")) {
    return NextResponse.json({ error: "event_id and email required" }, { status: 400 });
  }

  try {
    const db = adminClient();

    const { data: event } = await db
      .from("events")
      .select("*")
      .eq("id", eventId)
      .maybeSingle();
    const oneOffFees = (event?.ground_fee_cents ?? 0) + (event?.admin_fee_cents ?? 0);
    if (oneOffFees === 0) return NextResponse.json({ fees_due: false });

    const escapedEmail = email.trim().replace(/([\\%_])/g, "\\$1");
    const { data: priorPaid, error } = await db
      .from("registrations")
      .select("id")
      .eq("event_id", eventId)
      .eq("status", "paid")
      .gt("fees_cents", 0)
      .ilike("contact_email", escapedEmail)
      .limit(1);
    if (error) throw new Error(error.message);

    return NextResponse.json({ fees_due: !priorPaid?.length });
  } catch (err) {
    console.error("registrations/fees-status failed:", err);
    // Unknown — the form will keep showing the fees, which is the safe answer.
    return NextResponse.json({ fees_due: null });
  }
}
