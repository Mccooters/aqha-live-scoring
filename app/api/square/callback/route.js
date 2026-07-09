import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminClient } from "../../_lib/registrations";
import { exchangeOAuthCode } from "../../_lib/squarePayments";

// Where Square sends the club back after they approve the connection.
// Verifies the state cookie set by /api/square/connect, swaps the one-time
// code for tokens, and stores them (service role — browsers can't read
// square_connection at all). Ends with a redirect back to the coordinator
// Registrations page either way, carrying a status in the query string.

export const dynamic = "force-dynamic";

function redirectBack(req, params) {
  const url = new URL("/coordinator/registrations", req.url);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = NextResponse.redirect(url);
  res.cookies.set("square_oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}

export async function GET(req) {
  try {
    const search = new URL(req.url).searchParams;
    const error = search.get("error");
    if (error) {
      // e.g. the club clicked Deny
      return redirectBack(req, { square: "denied" });
    }

    const code = search.get("code");
    const state = search.get("state");
    const expectedState = cookies().get("square_oauth_state")?.value;
    if (!code || !state || !expectedState || state !== expectedState) {
      return redirectBack(req, { square: "state_mismatch" });
    }

    const tokens = await exchangeOAuthCode(code);
    if (!tokens.access_token || !tokens.merchant_id) {
      return redirectBack(req, { square: "failed" });
    }

    const db = adminClient();
    const row = {
      merchant_id: tokens.merchant_id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expires_at: tokens.expires_at ?? null,
      updated_at: new Date().toISOString(),
    };
    const { error: dbErr } = await db
      .from("square_connection")
      .upsert(row, { onConflict: "merchant_id" });
    if (dbErr) {
      console.error("square_connection save failed:", dbErr.message);
      return redirectBack(req, { square: "migration_needed" });
    }

    return redirectBack(req, { square: "connected" });
  } catch (err) {
    console.error("square/callback error:", err);
    return redirectBack(req, { square: "failed" });
  }
}
