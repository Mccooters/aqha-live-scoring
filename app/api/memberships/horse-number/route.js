import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { assignHorseNumber } from "../../_lib/horseNumbers";

export const dynamic = "force-dynamic";

// Public, low-detail preview for the membership sign-up form. Horse registry
// names/numbers are already public; this only returns the matched/next number.
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const horseName = String(searchParams.get("name") ?? "").trim();
    if (!horseName) return NextResponse.json({ ok: true, suggestion: null });

    const { suggestion } = await assignHorseNumber(adminClient(), { horse_name: horseName });
    return NextResponse.json({ ok: true, suggestion });
  } catch (err) {
    console.error("memberships/horse-number GET error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
