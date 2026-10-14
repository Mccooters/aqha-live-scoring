import { NextResponse } from "next/server";
import crypto from "crypto";
import { adminClient } from "../../_lib/registrations";
import { settleCompletedPayment } from "../../_lib/settlement";

export async function POST(req) {
  const body = await req.text();
  const signature = req.headers.get("x-square-hmacsha256-signature");
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;

  // Fail closed: without the signature key we cannot prove a call came from
  // Square, so we refuse it rather than trust it. Set
  // SQUARE_WEBHOOK_SIGNATURE_KEY (from the Square webhook subscription page)
  // in every environment that takes payments, including sandbox.
  if (!signatureKey) {
    console.error("Square webhook rejected: SQUARE_WEBHOOK_SIGNATURE_KEY is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  const webhookUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/api/webhooks/square`;
  const hmac = crypto.createHmac("sha256", signatureKey);
  hmac.update(webhookUrl + body);
  const expected = hmac.digest();
  const provided = Buffer.from(signature, "base64");
  const valid =
    provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  // Act on payment.updated where status is COMPLETED
  // (Square uses payment.updated, not payment.completed)
  if (event.type !== "payment.updated") {
    return NextResponse.json({ ok: true });
  }

  const payment = event.data?.object?.payment;
  if (payment?.status !== "COMPLETED") return NextResponse.json({ ok: true });

  const orderId = payment?.order_id;
  if (!orderId) return NextResponse.json({ ok: true });

  const db = adminClient();

  // Everything from here is shared with PayPal — see settlement.js.
  return settleCompletedPayment(db, payment, orderId, { provider: "square" });
}
