import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { runAutoReminders } from "../../_lib/balanceReminders";

// Daily automatic balance reminders — called by the Vercel cron in
// vercel.json (which sends "Authorization: Bearer <CRON_SECRET>"). Nothing
// runs unless CRON_SECRET is set and matches.
export const dynamic = "force-dynamic";

export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set — automatic reminders are off." }, { status: 503 });
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await runAutoReminders(adminClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("reminders/run error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
