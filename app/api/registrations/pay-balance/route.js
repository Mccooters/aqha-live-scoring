import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { adminClient } from "../../_lib/registrations";
import { createSquarePaymentLink } from "../../_lib/squarePayments";
import { balanceDueLabel, depositWindowOpen } from "../../../../lib/clinicPayments";

// Clinic balance payment (schema-v47): a deposit registration's remaining
// amount, payable any time up to 2 weeks before the clinic. The registration
// ID is a long random code known only from the payer's own confirmation
// email / success page (the same access rule as the status route); staff use
// it from the Registrations page too.
export async function POST(req) {
  try {
    const { registration_id } = await req.json();
    if (!registration_id) {
      return NextResponse.json({ error: "registration_id required" }, { status: 400 });
    }
    const db = adminClient();

    const { data: reg, error } = await db
      .from("registrations")
      .select("*, event:events(id, name, starts_on, event_type)")
      .eq("id", registration_id)
      .maybeSingle();
    if (error || !reg) {
      return NextResponse.json({ error: "Registration not found" }, { status: 404 });
    }
    if (reg.status !== "paid" || !(reg.deposit_cents > 0)) {
      return NextResponse.json({ error: "This registration has no balance owing." }, { status: 400 });
    }
    if (reg.balance_paid_at) {
      return NextResponse.json({ error: "The balance has already been paid — nothing owing. See you at the clinic!" }, { status: 400 });
    }
    const owed = Math.max(0, (reg.total_cents ?? 0) - (reg.deposit_cents ?? 0));
    if (owed <= 0) {
      return NextResponse.json({ error: "This registration has no balance owing." }, { status: 400 });
    }
    if (!depositWindowOpen(reg.event?.starts_on)) {
      return NextResponse.json(
        { error: "Online balance payments have closed (balances are due 2 weeks before the clinic). Please contact the organiser to arrange payment." },
        { status: 400 }
      );
    }

    // Reuse the checkout we already made — the link stays valid until paid.
    if (reg.balance_checkout_url) {
      return NextResponse.json({ checkout_url: reg.balance_checkout_url });
    }

    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
    const dueLabel = balanceDueLabel(reg.event?.starts_on);
    const { link, error: squareError, status: squareStatus } = await createSquarePaymentLink(db, {
      idempotency_key: randomUUID(),
      order: {
        location_id: process.env.SQUARE_LOCATION_ID,
        reference_id: `balance-${reg.id}`,
        line_items: [{
          name: `Balance — ${reg.event?.name ?? "clinic"}`,
          quantity: "1",
          base_price_money: { amount: owed, currency: "AUD" },
          note: `${reg.contact_name}${dueLabel ? ` · due by ${dueLabel}` : ""}`,
        }],
      },
      checkout_options: {
        redirect_url: `${baseUrl}/event/${reg.event?.id ?? reg.event_id}/register/success?reg=${reg.id}`,
        ask_for_shipping_address: false,
      },
      pre_populated_data: { buyer_email: reg.contact_email },
    });
    if (squareError) {
      return NextResponse.json({ error: squareError }, { status: squareStatus ?? 500 });
    }

    // The webhook matches the balance payment by this order id. If the write
    // fails the payment could never be recorded — refuse rather than let
    // someone pay into the void.
    const { error: saveErr } = await db
      .from("registrations")
      .update({ balance_square_order_id: link?.order_id, balance_checkout_url: link?.url })
      .eq("id", reg.id);
    if (saveErr) {
      console.error("Could not store balance order id:", saveErr.message);
      return NextResponse.json(
        { error: "Something went wrong setting up the payment — please try again. You have not been charged." },
        { status: 500 }
      );
    }
    return NextResponse.json({ checkout_url: link?.url });
  } catch (err) {
    console.error("pay-balance error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
