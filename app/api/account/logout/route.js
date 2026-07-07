import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminClient } from "../../_lib/registrations";
import { sha256Hex, sessionCookieOptions, SESSION_COOKIE } from "../../_lib/memberAuth";

// Sign out of the member portal: forget the session server-side and clear
// the cookie. Always succeeds — signing out twice is fine.
export async function POST() {
  try {
    const raw = cookies().get(SESSION_COOKIE)?.value;
    if (raw) {
      const db = adminClient();
      await db.from("member_sessions").delete().eq("token_hash", sha256Hex(raw));
    }
  } catch (err) {
    console.error("account/logout error:", err);
  }
  cookies().set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return NextResponse.json({ ok: true });
}
