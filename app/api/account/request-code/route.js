import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { sendLoginCodeEmail } from "../../_lib/memberships";
import {
  normalizeEmail, sha256Hex, generateCode,
  CODE_TTL_MS, RESEND_COOLDOWN_MS,
  memberSignInConfigError, memberSignInReadError,
} from "../../_lib/memberAuth";

// Step 1 of member sign-in: email us -> we email back a 6-digit code.
// Always answers { ok: true } for a well-formed email, whether or not a
// membership (or even an account) exists — so the response never reveals
// which email addresses are known to the club.
export async function POST(req) {
  try {
    const body = await req.json();
    const email = normalizeEmail(body?.email);
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    // Unlike booking/welcome emails (nice-to-have), the code email IS the
    // sign-in — if it can't be sent, say so instead of pretending it was.
    // In development the code is printed to the server console instead.
    const emailConfigured = !!(process.env.RESEND_API_KEY && process.env.BOOKING_EMAIL_FROM);
    if (!emailConfigured && process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Sign-in emails aren't set up yet — please contact the club." },
        { status: 503 }
      );
    }

    const configError = memberSignInConfigError();
    if (configError) {
      console.error("member sign-in config missing:", configError);
      return NextResponse.json({ error: configError }, { status: 503 });
    }

    const db = adminClient();

    // 60-second cooldown per address: quietly absorb repeat requests so a
    // double-click (or someone hammering the button) doesn't spam Resend.
    const { data: existing, error: readErr } = await db
      .from("member_login_codes")
      .select("created_at")
      .eq("email", email)
      .maybeSingle();
    if (readErr) {
      console.error("member_login_codes read failed:", readErr.message);
      return NextResponse.json(
        { error: memberSignInReadError(readErr, "member_login_codes") },
        { status: 503 }
      );
    }
    if (existing && Date.now() - new Date(existing.created_at).getTime() < RESEND_COOLDOWN_MS) {
      return NextResponse.json({ ok: true });
    }

    const code = generateCode();
    // Upsert keyed on the email: replaces any older code in one call, and two
    // near-simultaneous requests can't collide on the unique constraint.
    const { error: upsertErr } = await db.from("member_login_codes").upsert({
      email,
      code_hash: sha256Hex(code),
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      attempts: 0,
      created_at: new Date().toISOString(),
    }, { onConflict: "email" });
    if (upsertErr) {
      console.error("member_login_codes upsert failed:", upsertErr.message);
      return NextResponse.json({ error: "Something went wrong — try again." }, { status: 500 });
    }

    if (process.env.NODE_ENV !== "production") {
      console.log(`[dev] member sign-in code for ${email} is ${code}`);
    }

    try {
      await sendLoginCodeEmail(email, code);
    } catch (err) {
      console.error("Sign-in code email failed:", err);
      return NextResponse.json(
        { error: "We couldn't send the email just now — please try again in a minute." },
        { status: 503 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("account/request-code error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
