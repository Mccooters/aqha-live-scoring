import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminClient } from "../../_lib/registrations";
import {
  normalizeEmail, sha256Hex, codesMatch, generateSessionToken,
  sessionCookieOptions, SESSION_COOKIE, SESSION_TTL_MS, MAX_CODE_ATTEMPTS,
} from "../../_lib/memberAuth";

// Step 2 of member sign-in: check the emailed code; if it's right, create
// the account (first sign-in) and a 90-day session, and set the cookie.
const EXPIRED_MSG = "That code has expired or had too many tries — request a new one.";
const WRONG_MSG = "That code isn't right — check the email and try again.";

export async function POST(req) {
  try {
    const body = await req.json();
    const email = normalizeEmail(body?.email);
    const code = String(body?.code ?? "").trim();
    if (!email || !email.includes("@") || !code) {
      return NextResponse.json({ error: "Enter the email and the 6-digit code." }, { status: 400 });
    }

    const db = adminClient();

    const { data: row } = await db
      .from("member_login_codes")
      .select("*")
      .eq("email", email)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: EXPIRED_MSG }, { status: 401 });

    if (new Date(row.expires_at) <= new Date() || row.attempts >= MAX_CODE_ATTEMPTS) {
      await db.from("member_login_codes").delete().eq("id", row.id);
      return NextResponse.json({ error: EXPIRED_MSG }, { status: 401 });
    }

    if (!codesMatch(code, row.code_hash)) {
      await db.from("member_login_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      return NextResponse.json({ error: WRONG_MSG }, { status: 401 });
    }

    // Right code: single-use, so remove it before anything else.
    await db.from("member_login_codes").delete().eq("id", row.id);

    let { data: account } = await db
      .from("member_accounts")
      .select("id, email")
      .eq("email", email)
      .maybeSingle();
    if (!account) {
      const { data: created, error: createErr } = await db
        .from("member_accounts")
        .insert({ email })
        .select("id, email")
        .maybeSingle();
      if (createErr) {
        // Two sign-ins racing on a brand-new email: the unique constraint
        // means exactly one insert wins — just read the winner back.
        const { data: again } = await db
          .from("member_accounts")
          .select("id, email")
          .eq("email", email)
          .maybeSingle();
        account = again;
      } else {
        account = created;
      }
    }
    if (!account) {
      return NextResponse.json({ error: "Something went wrong — try again." }, { status: 500 });
    }

    await db
      .from("member_accounts")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", account.id);

    const token = generateSessionToken();
    const { error: sessionErr } = await db.from("member_sessions").insert({
      account_id: account.id,
      token_hash: sha256Hex(token),
      expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    });
    if (sessionErr) {
      return NextResponse.json({ error: sessionErr.message }, { status: 500 });
    }

    // Tidy up any of this account's sessions that have already expired —
    // cheap housekeeping so the table never needs a scheduled job.
    await db
      .from("member_sessions")
      .delete()
      .eq("account_id", account.id)
      .lt("expires_at", new Date().toISOString());

    cookies().set(SESSION_COOKIE, token, sessionCookieOptions());
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("account/verify-code error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
