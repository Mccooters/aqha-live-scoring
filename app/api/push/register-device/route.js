import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";

// The companion iPhone app calls this after the user allows notifications,
// handing over its APNs device token so ordinary announcements (entries open,
// show live, results ready) reach the app as well as web-push subscribers.
// Stored server-side (service role) — the table isn't publicly accessible.
export async function POST(req) {
  try {
    const { device_token } = await req.json();

    if (
      typeof device_token !== "string" ||
      !/^[0-9a-f]{20,200}$/i.test(device_token)
    ) {
      return NextResponse.json({ error: "Invalid registration" }, { status: 400 });
    }

    const db = adminClient();
    const { error } = await db.from("device_push_tokens").upsert(
      { device_token: device_token.toLowerCase(), platform: "ios" },
      { onConflict: "device_token" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
