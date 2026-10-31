import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { creditStatus } from "../../_lib/credits";

// Public: does this email have club credit to spend? A yes/no only — the
// amount shows after signing in to the member portal, and only a signed-in
// member can spend it. Lets the entry form say "sign in to use your credit"
// to someone who typed their email without signing in.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req) {
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  const db = adminClient();
  const s = await creditStatus(db, email);
  return NextResponse.json({ has_credit: s.available_cents > 0 }, { headers: { "Cache-Control": "no-store" } });
}
