import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { bookingsForEmail } from "../../_lib/extras";

// Public: what this email address has already booked (paid) among an
// event's camping/yard items and the pools they share with other events —
// so someone entering the second event of a weekend sees "you already have
// a yard on Friday" instead of booking it twice. Returns only that email's
// own bookings (items, quantities, nights, which event); never names.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req) {
  const url = new URL(req.url);
  const eventId = url.searchParams.get("event");
  const email = url.searchParams.get("email");
  if (!eventId || !email) return NextResponse.json({ error: "event and email required" }, { status: 400 });
  const db = adminClient();
  const mine = await bookingsForEmail(db, eventId, email);
  return NextResponse.json({ mine }, { headers: { "Cache-Control": "no-store" } });
}
