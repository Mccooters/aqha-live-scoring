import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { bookedExtraCounts } from "../../_lib/extras";

// Public: how many of each camping/yard item are already booked for an
// event (numbers only — never who), so the entry form can show what's left.
// Who-booked-what stays staff-only.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req) {
  const eventId = new URL(req.url).searchParams.get("event");
  if (!eventId) return NextResponse.json({ error: "event required" }, { status: 400 });
  const db = adminClient();
  const extras = await bookedExtraCounts(db, eventId);
  return NextResponse.json({ extras }, { headers: { "Cache-Control": "no-store" } });
}
