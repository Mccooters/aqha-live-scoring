import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminClient } from "../../_lib/registrations";
import {
  normalizeEmail, codesMatch, createMemberSession,
  sessionCookieOptions, SESSION_COOKIE, MAX_CODE_ATTEMPTS,
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

    // A code sign-in proves they own the email, so it also clears any
    // password lockout (it doubles as the "forgot password" path).
    await db
      .from("member_accounts")
      .update({
        last_login_at: new Date().toISOString(),
        password_failed_attempts: 0,
        password_locked_until: null,
      })
      .eq("id", account.id);

    let token;
    try {
      token = await createMemberSession(db, account.id);
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }

    cookies().set(SESSION_COOKIE, token, sessionCookieOptions());
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("account/verify-code error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
