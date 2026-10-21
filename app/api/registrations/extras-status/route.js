import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { bookedExtraCounts, poolSharing } from "../../_lib/extras";

// Public: how many of each camping/yard item are already booked for an
// event (numbers only — never who), counted across every event sharing the
// same yards (schema-v62), plus which other events share them — so the
// entry form can show what's left and say "shared with Winter Show".
// Who-booked-what stays staff-only.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req) {
  const eventId = new URL(req.url).searchParams.get("event");
  if (!eventId) return NextResponse.json({ error: "event required" }, { status: 400 });
  const db = adminClient();
  const [extras, shared] = await Promise.all([bookedExtraCounts(db, eventId), poolSharing(db, eventId)]);
  return NextResponse.json({ extras, shared }, { headers: { "Cache-Control": "no-store" } });
}
