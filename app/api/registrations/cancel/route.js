import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminClient, cancelRegistration, expireStaleRegistrations } from "../../_lib/registrations";

// Staff-only. Two jobs:
//   { registration_id }            — cancel one pending registration
//   { expire: true, event_id? }    — sweep: cancel everything unpaid > 48h
// Both also delete the Square checkout link so it can't be paid afterwards.

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

    const { registration_id, expire, event_id } = await req.json();
    const db = adminClient();

    if (expire) {
      const expired = await expireStaleRegistrations(db, { eventId: event_id || undefined });
      return NextResponse.json({ ok: true, expired });
    }

    if (!registration_id) {
      return NextResponse.json({ error: "registration_id required" }, { status: 400 });
    }
    const cancelled = await cancelRegistration(db, registration_id, "staff");
    if (!cancelled) {
      return NextResponse.json(
        { error: "This registration isn't pending any more — refresh the page." },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("registrations/cancel error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
