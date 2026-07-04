import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";

// Mirrors /api/push/send: the coordinator dashboard posts here, we verify the
// caller is signed-in staff, then forward to the send-live-activity edge
// function server-side (so the browser never calls the function directly).
export async function POST(req) {
  try {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return NextResponse.json({ error: "Staff sign-in required" }, { status: 401 });
    }

    const db = adminClient();
    const { data: userData, error: userError } = await db.auth.getUser(token);
    if (userError || !userData?.user) {
      return NextResponse.json({ error: "Staff sign-in required" }, { status: 401 });
    }

    const { event_id, content_state, event, alert, dismiss } = await req.json();
    if (!event_id || !content_state) {
      return NextResponse.json({ error: "event_id and content_state required" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: "Supabase environment variables are missing" }, { status: 500 });
    }

    const res = await fetch(`${supabaseUrl}/functions/v1/send-live-activity`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event_id, content_state, event, alert, dismiss }),
    });

    const text = await res.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text };
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: payload.error ?? "Live Activity Edge Function failed" },
        { status: res.status }
      );
    }

    return NextResponse.json(payload);
  } catch (err) {
    console.error("live-activity/push error:", err);
    return NextResponse.json(
      { error: err.message ?? "Could not contact the Live Activity service" },
      { status: 502 }
    );
  }
}
