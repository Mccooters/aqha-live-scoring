import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { hasCurrentMembership } from "../../_lib/memberships";

// Yes/no membership check used by the event entry form to warn non-members
// before they fill everything in. Returns only a boolean — never any member
// details — so it can't be used to look people up.
export async function GET(req) {
  const url = new URL(req.url);
  const email = url.searchParams.get("email");
  const eventId = url.searchParams.get("event_id");
  if (!email?.trim() || !email.includes("@")) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  try {
    const db = adminClient();
    let membershipDate = new Date();
    if (eventId) {
      const { data: event } = await db
        .from("events")
        .select("starts_on")
        .eq("id", eventId)
        .maybeSingle();
      if (event?.starts_on) membershipDate = new Date(event.starts_on);
    }
    const member = await hasCurrentMembership(db, email, membershipDate);
    return NextResponse.json({ member });
  } catch (err) {
    // Membership tables not set up yet (migration not run) — treat as
    // "no answer" rather than an error so the entry form isn't disrupted.
    console.error("memberships/check failed:", err);
    return NextResponse.json({ member: null });
  }
}
