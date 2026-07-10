import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { hasCurrentMembership, hasMembershipForEvent } from "../../_lib/memberships";

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
    // For a specific event, judge membership against the event's own season
    // (a next-season membership doesn't cover the last event of the outgoing
    // season). With no event, fall back to the lenient "are you a member now".
    let member;
    if (eventId) {
      const { data: event } = await db
        .from("events")
        .select("starts_on")
        .eq("id", eventId)
        .maybeSingle();
      member = await hasMembershipForEvent(db, email, event?.starts_on ?? new Date());
    } else {
      member = await hasCurrentMembership(db, email);
    }
    return NextResponse.json({ member });
  } catch (err) {
    // Membership tables not set up yet (migration not run) — treat as
    // "no answer" rather than an error so the entry form isn't disrupted.
    console.error("memberships/check failed:", err);
    return NextResponse.json({ member: null });
  }
}
