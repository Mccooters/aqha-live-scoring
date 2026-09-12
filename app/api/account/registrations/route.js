import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { getMemberAccount, escapeIlike, notSignedIn } from "../../_lib/memberAuth";
import {
  balanceDueDate,
  balanceDueLabel,
  balanceOwingCents,
  balancePaidCents,
  depositWindowOpen,
} from "../../../../lib/clinicPayments";

// Clinic balances owing for the signed-in member (schema-v47/v50): any paid
// deposit-plan registration made with this account's email that still has
// money owing. Shown as a "Balances owing" card in the member portal, with a
// link to the registration's own payment page (where full and part payments
// already live). Same email-as-identity rule as every other account route.
export async function GET() {
  try {
    const db = adminClient();
    const account = await getMemberAccount(db);
    if (!account) return NextResponse.json(notSignedIn(), { status: 401 });

    const { data, error } = await db
      .from("registrations")
      .select("*, event:events(id, name, starts_on, event_type)")
      .eq("status", "paid")
      .gt("deposit_cents", 0)
      .ilike("contact_email", escapeIlike(account.email));
    if (error) {
      // Pre-v47 database — no deposit plans exist, so nothing can be owing.
      if (/deposit_cents|does not exist|schema cache/i.test(error.message ?? "")) {
        return NextResponse.json({ ok: true, balances: [] });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const balances = (data ?? [])
      .map((reg) => {
        const owing = balanceOwingCents(reg);
        if (owing <= 0) return null;
        const due = balanceDueDate(reg.event?.starts_on);
        return {
          id: reg.id,
          event_id: reg.event?.id ?? reg.event_id,
          event_name: reg.event?.name ?? "Clinic",
          starts_on: reg.event?.starts_on ?? null,
          deposit_cents: reg.deposit_cents,
          part_paid_cents: balancePaidCents(reg),
          owing_cents: owing,
          total_cents: reg.total_cents ?? 0,
          due_label: balanceDueLabel(reg.event?.starts_on),
          overdue: due ? new Date() > due : false,
          window_open: depositWindowOpen(reg.event?.starts_on),
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(a.starts_on ?? "").localeCompare(String(b.starts_on ?? "")));

    return NextResponse.json({ ok: true, balances });
  } catch (err) {
    console.error("account/registrations GET error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
