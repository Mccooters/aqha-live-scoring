import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { adminClient } from "../../_lib/registrations";
import { squareBase, OAUTH_SCOPES } from "../../_lib/squarePayments";

// Starts the "Connect Square" flow from the coordinator Registrations page.
// Staff-only: the button sends the coordinator's login token, we hand back
// the Square authorisation URL for the browser to visit, and note a random
// `state` in a cookie so the callback can prove the flow started here.

async function verifyStaff(req) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const authCheck = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const { data, error } = await authCheck.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function POST(req) {
  try {
    const staff = await verifyStaff(req);
    if (!staff) {
      return NextResponse.json({ error: "Staff sign-in required" }, { status: 401 });
    }
    if (!process.env.SQUARE_APP_ID || !process.env.SQUARE_APP_SECRET) {
      return NextResponse.json(
        { error: "Square app credentials aren't configured yet (SQUARE_APP_ID / SQUARE_APP_SECRET)." },
        { status: 503 }
      );
    }

    const state = randomBytes(16).toString("base64url");
    const params = new URLSearchParams({
      client_id: process.env.SQUARE_APP_ID,
      scope: OAUTH_SCOPES.join(" "),
      session: "false", // always ask which Square account to use — it must be the club's
      state,
    });

    const res = NextResponse.json({
      url: `${squareBase()}/oauth2/authorize?${params.toString()}`,
    });
    res.cookies.set("square_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60, // the flow should finish within 10 minutes
    });
    return res;
  } catch (err) {
    console.error("square/connect error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}

// Disconnect: forget the stored OAuth connection so payments fall back to
// the club's own SQUARE_ACCESS_TOKEN. Recovery path for a connection made
// with the wrong Square account; reconnecting any time re-creates it.
export async function DELETE(req) {
  try {
    const staff = await verifyStaff(req);
    if (!staff) {
      return NextResponse.json({ error: "Staff sign-in required" }, { status: 401 });
    }
    const db = adminClient();
    const { error } = await db
      .from("square_connection")
      .delete()
      .neq("merchant_id", ""); // i.e. every row — there's at most a handful
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("square/disconnect error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
