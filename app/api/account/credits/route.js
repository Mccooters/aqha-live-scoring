import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { getMemberAccount, notSignedIn } from "../../_lib/memberAuth";
import { creditStatus } from "../../_lib/credits";

// The signed-in member's club credit (schema-v68): balance, what an unpaid
// checkout is holding, what's available, and the history. Same
// email-as-identity rule as every other account route. The member portal's
// credit card and the entry form's "use my credit" offer both read this.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  try {
    const db = adminClient();
    const account = await getMemberAccount(db);
    if (!account) return NextResponse.json(notSignedIn(), { status: 401 });
    const s = await creditStatus(db, account.email);
    return NextResponse.json(
      {
        ok: true,
        ready: s.ready,
        balance_cents: s.balance_cents,
        held_cents: s.held_cents,
        available_cents: s.available_cents,
        rows: s.rows.map((r) => ({
          id: r.id, at: r.created_at, amount_cents: r.amount_cents, kind: r.kind, reason: r.reason,
          event_name: r.event?.name ?? null,
        })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("account/credits GET error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
