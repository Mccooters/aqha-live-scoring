import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminClient } from "../../_lib/registrations";
import {
  normalizeEmail, createMemberSession, sessionCookieOptions,
  SESSION_COOKIE, MAX_PASSWORD_ATTEMPTS, PASSWORD_LOCK_MS,
  memberSignInConfigError, memberSignInReadError,
} from "../../_lib/memberAuth";
import { verifyPassword } from "../../_lib/passwords";

// Password sign-in. One deliberately vague error for "no such account",
// "no password set" and "wrong password", so the response never reveals
// which emails have accounts. After too many wrong guesses the password is
// locked for a while — the emailed code always keeps working.
const GENERIC_MSG = "That email or password isn't right — or sign in with an emailed code instead.";
const LOCKED_MSG = "Too many password attempts — sign in with an emailed code, or try again in 15 minutes.";

export async function POST(req) {
  try {
    const body = await req.json();
    const email = normalizeEmail(body?.email);
    const password = String(body?.password ?? "");
    if (!email || !email.includes("@") || !password) {
      return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
    }

    const configError = memberSignInConfigError();
    if (configError) {
      console.error("member sign-in config missing: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return NextResponse.json({ error: configError }, { status: 503 });
    }

    const db = adminClient();

    const { data: account, error: readErr } = await db
      .from("member_accounts")
      .select("*")
      .eq("email", email)
      .maybeSingle();
    if (readErr) {
      console.error("member_accounts read failed:", readErr.message);
      return NextResponse.json(
        { error: memberSignInReadError(readErr, "member_accounts") },
        { status: 503 }
      );
    }
    if (!account?.password_hash) {
      return NextResponse.json({ error: GENERIC_MSG }, { status: 401 });
    }

    if (account.password_locked_until && new Date(account.password_locked_until) > new Date()) {
      return NextResponse.json({ error: LOCKED_MSG }, { status: 401 });
    }

    const ok = await verifyPassword(password, account.password_hash);
    if (!ok) {
      const attempts = (account.password_failed_attempts ?? 0) + 1;
      const locked = attempts >= MAX_PASSWORD_ATTEMPTS;
      await db
        .from("member_accounts")
        .update(
          locked
            ? { password_failed_attempts: 0, password_locked_until: new Date(Date.now() + PASSWORD_LOCK_MS).toISOString() }
            : { password_failed_attempts: attempts }
        )
        .eq("id", account.id);
      return NextResponse.json({ error: locked ? LOCKED_MSG : GENERIC_MSG }, { status: 401 });
    }

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
    console.error("account/password-login error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
