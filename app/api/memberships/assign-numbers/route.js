import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminClient, isCommitteeViewer } from "../../_lib/registrations";
import { assignAllHcqhaNumbers } from "../../_lib/memberNumbers";

// Staff: give every person on every approved membership an HCQHA membership
// number (schema-v54). Numbers already issued are never changed.
async function verifyStaff(req) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const authCheck = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await authCheck.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}

export async function POST(req) {
  try {
    const staff = await verifyStaff(req);
    if (!staff) return NextResponse.json({ error: "Staff sign-in required" }, { status: 401 });
    const db = adminClient();
    if (await isCommitteeViewer(db, staff.id)) {
      return NextResponse.json({ error: "This account has read-only committee access — changes are not permitted." }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const start = Math.max(1, Math.round(Number(body?.start)) || 1);
    const result = await assignAllHcqhaNumbers(db, { start });
    if (result.skipped === "migration") {
      return NextResponse.json({ error: 'Membership numbers need a database update — run "schema-v54-hcqha-numbers.sql" in Supabase first.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, assigned: result.assigned });
  } catch (err) {
    console.error("memberships/assign-numbers error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
