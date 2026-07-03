import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";

const clip = (value, max) => String(value ?? "").slice(0, max);

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

    const { title, body, tag } = await req.json();
    if (!title && !body) {
      return NextResponse.json({ error: "Notification title or body required" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: "Supabase environment variables are missing" }, { status: 500 });
    }

    const res = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: clip(title, 120),
        body: clip(body, 300),
        tag: clip(tag, 40),
      }),
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
        { error: payload.error ?? "Push Edge Function failed" },
        { status: res.status }
      );
    }

    return NextResponse.json(payload);
  } catch (err) {
    console.error("push/send error:", err);
    return NextResponse.json(
      { error: err.message ?? "Could not contact the push notification service" },
      { status: 502 }
    );
  }
}
