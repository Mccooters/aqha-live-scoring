import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminClient, isCommitteeViewer } from "../../_lib/registrations";
import { owingRegistrations, sendBalanceReminder } from "../../_lib/balanceReminders";
import { balanceOwingCents } from "../../../../lib/clinicPayments";

// Staff: email a balance reminder to one registration, or to everyone still
// owing on an event. Sends only to paid registrations with money owing.
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
    const { registration_id, event_id } = await req.json();

    let regs = [];
    let eventId = event_id;
    if (registration_id) {
      const { data: reg } = await db.from("registrations").select("*").eq("id", registration_id).maybeSingle();
      if (!reg) return NextResponse.json({ error: "Registration not found" }, { status: 404 });
      if (reg.status !== "paid" || balanceOwingCents(reg) <= 0) {
        return NextResponse.json({ error: "Nothing is owing on this registration." }, { status: 400 });
      }
      regs = [reg];
      eventId = reg.event_id;
    } else if (event_id) {
      regs = await owingRegistrations(db, event_id);
    } else {
      return NextResponse.json({ error: "registration_id or event_id required" }, { status: 400 });
    }
    const { data: event } = await db.from("events").select("id, name, starts_on, location").eq("id", eventId).maybeSingle();
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    let sent = 0; const failed = [];
    for (const reg of regs) {
      const r = await sendBalanceReminder(db, reg, event, { method: "manual", by: staff.email ?? null });
      if (r.sent) sent += 1; else failed.push(`${reg.contact_name}: ${r.reason}`);
    }
    return NextResponse.json({ ok: true, sent, failed, total: regs.length });
  } catch (err) {
    console.error("registrations/remind error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
