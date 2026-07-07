import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";

// Read-only lookup for the membership success page. Memberships hold names,
// emails and phone numbers so the table isn't publicly readable — the page
// asks the server instead. The membership ID is a long random code that only
// appears in the applicant's own redirect URL, so knowing it is proof enough
// to see this one application. Only non-sensitive display fields go back.
export async function GET(req) {
  const memberId = new URL(req.url).searchParams.get("id");
  if (!memberId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const db = adminClient();
  const { data: member, error } = await db
    .from("club_members")
    .select("id, status, season, membership_type_name, member_name, email, total_cents")
    .eq("id", memberId)
    .maybeSingle();

  if (error || !member) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(member);
}
