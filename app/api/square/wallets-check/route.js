import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { adminClient, isCommitteeViewer } from "../../_lib/registrations";
import { createSquarePaymentLink, deleteSquarePaymentLink } from "../../_lib/squarePayments";

// Staff: ask Square which digital wallets it will put on this account's
// payment links. Creates a $1 "do not pay" link exactly the way the site
// creates real ones (so it carries the Apple Pay / Google Pay request), reads
// back the accepted_payment_methods Square echoes, then deletes the link
// again. Nothing is charged and the link is never shown to anyone — this is
// a diagnostic for "Apple Pay isn't appearing" (owner's report, Oct 2026).
// Since the website fee moved to the monthly ledger (schema-v60) no link
// carries an app fee, so Apple Pay should always be offered; the response
// still echoes app_fee_cents as a canary (expected 0).
async function verifyStaff(req) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const authCheck = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await authCheck.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}

export async function POST(req) {
  try {
    const staff = await verifyStaff(req);
    if (!staff) return NextResponse.json({ error: "Staff sign-in required" }, { status: 401 });
    const db = adminClient();
    if (await isCommitteeViewer(db, staff.id)) {
      return NextResponse.json({ error: "This account has read-only committee access." }, { status: 403 });
    }
    const payload = {
      idempotency_key: randomUUID(),
      order: {
        location_id: process.env.SQUARE_LOCATION_ID,
        reference_id: "wallet-check",
        line_items: [{ name: "Wallet check — do not pay", quantity: "1", base_price_money: { amount: 100, currency: "AUD" } }],
      },
      checkout_options: { ask_for_shipping_address: false },
    };

    const { link, error, status } = await createSquarePaymentLink(db, payload);
    if (error) return NextResponse.json({ error }, { status: status ?? 502 });
    let deleted = false;
    try { deleted = await deleteSquarePaymentLink(db, link?.id); } catch (e) { console.error("Wallet check: could not delete the test link:", e.message); }
    return NextResponse.json({
      ok: true,
      requested: { apple_pay: true, google_pay: true },
      accepted_payment_methods: link?.checkout_options?.accepted_payment_methods ?? null,
      app_fee_cents: link?.checkout_options?.app_fee_money?.amount ?? 0,
      deleted,
    });
  } catch (err) {
    console.error("square/wallets-check error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
