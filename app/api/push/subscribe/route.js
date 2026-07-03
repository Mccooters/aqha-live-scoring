import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";

// Spectators opt in to push notifications without an account. The
// push_subscriptions table is no longer publicly writable (or readable),
// so the "Notify me" button posts here and the server stores the
// subscription with the service role. One subscription per call — there is
// no way to touch anyone else's subscription from the outside.
export async function POST(req) {
  try {
    const { endpoint, p256dh, auth_key } = await req.json();

    const isKey = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;
    if (
      !isKey(endpoint, 1000) ||
      !endpoint.startsWith("https://") ||
      !isKey(p256dh, 300) ||
      !isKey(auth_key, 300)
    ) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }

    const db = adminClient();
    const { error } = await db
      .from("push_subscriptions")
      .upsert({ endpoint, p256dh, auth_key }, { onConflict: "endpoint" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
