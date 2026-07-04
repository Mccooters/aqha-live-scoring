import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";

// The companion iPhone app calls this when it starts a Live Activity, handing
// over the per-activity push token so the server can send live updates to that
// phone's Lock Screen. Stored server-side (service role) — the table isn't
// publicly accessible. One token per call; no way to touch another device's.
export async function POST(req) {
  try {
    const { event_id, push_token, kind } = await req.json();

    if (
      !event_id ||
      typeof push_token !== "string" ||
      push_token.length < 20 ||
      push_token.length > 500
    ) {
      return NextResponse.json({ error: "Invalid registration" }, { status: 400 });
    }

    const db = adminClient();
    const { error } = await db.from("live_activity_tokens").upsert(
      {
        event_id,
        push_token,
        activity_kind: kind === "start" ? "start" : "update",
      },
      { onConflict: "push_token" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
