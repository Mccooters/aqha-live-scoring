import { NextResponse } from "next/server";
import { adminClient } from "../../../_lib/registrations";
import { takenNumbers, shortName } from "../../../_lib/raffles";

// Public: which numbers are taken (sold, or reserved by someone mid-payment)
// with a short display name — never emails or full names.
export const dynamic = "force-dynamic";

export async function GET(_req, { params }) {
  try {
    const db = adminClient();
    const tickets = await takenNumbers(db, params.id);
    return NextResponse.json({
      ok: true,
      taken: tickets.map((t) => ({ number: t.number, status: t.status, label: t.status === "sold" ? shortName(t.buyer_name) : "" })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
