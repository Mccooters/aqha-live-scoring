import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminClient, isCommitteeViewer } from "../../_lib/registrations";
import { approveMembership } from "../../_lib/memberships";

// Approving / rejecting a membership is a committee decision, so only
// signed-in staff may call this. The dashboard sends the coordinator's
// login token; we verify it with Supabase before doing anything. (Staff
// could update the row directly via their session, but going through this
// route is what sends the welcome email.)
async function verifyStaff(req) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const authCheck = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const { data, error } = await authCheck.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function POST(req) {
  try {
    const staff = await verifyStaff(req);
    if (!staff) {
      return NextResponse.json({ error: "Staff sign-in required" }, { status: 401 });
    }

    const { member_id, action } = await req.json();
    if (!member_id || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "member_id and action (approve|reject) required" }, { status: 400 });
    }

    const db = adminClient();
    if (await isCommitteeViewer(db, staff.id)) {
      return NextResponse.json({ error: "This account has read-only committee access — changes are not permitted." }, { status: 403 });
    }


    const { data: member } = await db
      .from("club_members")
      .select("id, status")
      .eq("id", member_id)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: "Membership not found" }, { status: 404 });

    if (action === "approve") {
      await approveMembership(db, member_id);
    } else {
      const { error } = await db
        .from("club_members")
        .update({ status: "rejected" })
        .eq("id", member_id);
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
