import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { getMemberAccount, notSignedIn } from "../../_lib/memberAuth";
import { hashPassword, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "../../_lib/passwords";

// Set or change the account password. Requires being signed in — which
// itself required either an emailed code or the current password, so no
// separate "current password" step is needed. Losing the password is never
// a lockout: the emailed code always works and clears any password lock.
export async function POST(req) {
  try {
    const body = await req.json();
    const db = adminClient();
    const account = await getMemberAccount(db);
    if (!account) return NextResponse.json(notSignedIn(), { status: 401 });

    const password = String(body?.password ?? "");
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` },
        { status: 400 }
      );
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      return NextResponse.json({ error: "That password is too long." }, { status: 400 });
    }

    const { error } = await db
      .from("member_accounts")
      .update({
        password_hash: await hashPassword(password),
        password_failed_attempts: 0,
        password_locked_until: null,
      })
      .eq("id", account.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("account/password error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
