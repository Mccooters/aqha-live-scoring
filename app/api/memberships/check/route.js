import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { hasCurrentMembership } from "../../_lib/memberships";

// Yes/no membership check used by the event entry form to warn non-members
// before they fill everything in. Returns only a boolean — never any member
// details — so it can't be used to look people up.
export async function GET(req) {
  const email = new URL(req.url).searchParams.get("email");
  if (!email?.trim() || !email.includes("@")) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  try {
    const member = await hasCurrentMembership(adminClient(), email);
    return NextResponse.json({ member });
  } catch (err) {
    // Membership tables not set up yet (migration not run) — treat as
    // "no answer" rather than an error so the entry form isn't disrupted.
    console.error("memberships/check failed:", err);
    return NextResponse.json({ member: null });
  }
}
