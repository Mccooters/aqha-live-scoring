import { NextResponse } from "next/server";
import { adminClient } from "../../../_lib/registrations";
import { takenNumbers } from "../../../_lib/raffles";

// Public: which numbers are taken (sold, or reserved by someone mid-payment).
// Numbers and status only — buyer names are staff-only (owner's rule).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store"; // never serve a stale ticket board / payment status

export async function GET(_req, { params }) {
  try {
    const db = adminClient();
    const tickets = await takenNumbers(db, params.id);
    return NextResponse.json({
      ok: true,
      taken: tickets.map((t) => ({ number: t.number, status: t.status })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
