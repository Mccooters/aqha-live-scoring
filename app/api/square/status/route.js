import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminClient } from "../../_lib/registrations";
import { appFeeBps, squareDiagnostics, getSquareConnection } from "../../_lib/squarePayments";

// What the coordinator Registrations page shows in its "Square connection"
// card. Staff-only, and never returns the tokens themselves.

// Reads request headers, so it can never be pre-rendered at build time.
export const dynamic = "force-dynamic";

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

export async function GET(req) {
  try {
    const staff = await verifyStaff(req);
    if (!staff) {
      return NextResponse.json({ error: "Staff sign-in required" }, { status: 401 });
    }

    const db = adminClient();
    // One lookup feeds both the "Connected" headline and the health check,
    // so the card can't contradict itself.
    const connection = await getSquareConnection(db);

    // Live check against Square: which locations can the active credentials
    // actually see? Never fatal — the card still renders if Square is down.
    let diagnostics = null;
    try {
      diagnostics = await squareDiagnostics(db, connection);
    } catch (err) {
      console.error("square diagnostics failed:", err);
    }

    return NextResponse.json({
      connected: Boolean(connection),
      merchant_id: connection?.merchant_id ?? null,
      connected_at: connection?.connected_at ?? null,
      app_configured: Boolean(process.env.SQUARE_APP_ID && process.env.SQUARE_APP_SECRET),
      fallback_token: Boolean(process.env.SQUARE_ACCESS_TOKEN),
      fee_bps: appFeeBps(),
      diagnostics,
    });
  } catch (err) {
    console.error("square/status error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
