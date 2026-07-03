import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminClient, approveRegistration } from "../../_lib/registrations";

// Force-approve creates entries as if payment happened, so only signed-in
// show staff may call it. The dashboard sends the coordinator's login token;
// we verify it with Supabase before doing anything.
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

    const { registration_id } = await req.json();
    if (!registration_id) {
      return NextResponse.json({ error: "registration_id required" }, { status: 400 });
    }

    const db = adminClient();

    const { data: reg } = await db
      .from("registrations")
      .select("id, status")
      .eq("id", registration_id)
      .single();

    if (!reg) return NextResponse.json({ error: "Registration not found" }, { status: 404 });
    if (reg.status === "paid") return NextResponse.json({ error: "Already paid" }, { status: 400 });

    await approveRegistration(db, registration_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
