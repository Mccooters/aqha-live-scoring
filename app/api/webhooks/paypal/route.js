import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { verifyPayPalWebhook, capturePayPalOrder, paymentFromCapture, valueToCents } from "../../_lib/paypal";
import { settleCompletedPayment } from "../../_lib/settlement";

// PayPal webhook — the safety net behind /api/paypal/return. Subscribe it
// (developer.paypal.com → your app → Webhooks) to CHECKOUT.ORDER.APPROVED and
// PAYMENT.CAPTURE.COMPLETED, and put its id in PAYPAL_WEBHOOK_ID. Every
// delivery is verified with PayPal first; settlement is idempotent, so a
// payment already handled by the return route is simply a no-op here.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req) {
  const raw = await req.text();
  const verified = await verifyPayPalWebhook(req.headers, raw);
  if (!verified.ok) {
    if (verified.status === 503) console.error("PayPal webhook rejected: PAYPAL_WEBHOOK_ID is not set");
    return NextResponse.json({ error: verified.reason }, { status: verified.status ?? 401 });
  }
  const event = verified.event;
  const db = adminClient();

  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    const r = event.resource ?? {};
    const orderId = r.supplementary_data?.related_ids?.order_id;
    if (!orderId || r.status !== "COMPLETED") return NextResponse.json({ ok: true });
    const payment = { id: r.id, order_id: orderId, status: "COMPLETED", amount_money: { amount: valueToCents(r.amount?.value), currency: r.amount?.currency_code ?? "AUD" } };
    return settleCompletedPayment(db, payment, orderId, { provider: "paypal" });
  }

  if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
    // Approved but (maybe) never captured — the buyer closed the tab before
    // coming back. Capture it now; an already-captured order just returns
    // its existing capture.
    const orderId = event.resource?.id;
    if (!orderId) return NextResponse.json({ ok: true });
    const cap = await capturePayPalOrder(orderId);
    if (cap.error) {
      if (cap.not_approved) return NextResponse.json({ ok: true });
      console.error(`PayPal webhook: capture of ${orderId} failed:`, cap.error);
      return NextResponse.json({ error: cap.error }, { status: 502 }); // PayPal retries
    }
    return settleCompletedPayment(db, paymentFromCapture(cap.capture, orderId), orderId, { provider: "paypal" });
  }

  return NextResponse.json({ ok: true });
}
