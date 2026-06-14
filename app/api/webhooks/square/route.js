import { NextResponse } from "next/server";
import crypto from "crypto";
import { adminClient, approveRegistration } from "../../_lib/registrations";

export async function POST(req) {
  const body = await req.text();
  const signature = req.headers.get("x-square-hmacsha256-signature");
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;

  // Verify Square webhook signature (skip in sandbox/dev if key not set)
  if (signatureKey && signature) {
    const webhookUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/api/webhooks/square`;
    const hmac = crypto.createHmac("sha256", signatureKey);
    hmac.update(webhookUrl + body);
    const expected = hmac.digest("base64");
    if (expected !== signature) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
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

  // Find our registration by the Square order ID stored at checkout creation time
  const { data: reg } = await db
    .from("registrations")
    .select("id, status")
    .eq("square_order_id", orderId)
    .maybeSingle();

  if (!reg || reg.status === "paid") return NextResponse.json({ ok: true });

  await db
    .from("registrations")
    .update({ square_payment_id: payment.id })
    .eq("id", reg.id);

  await approveRegistration(db, reg.id);

  return NextResponse.json({ ok: true });
}
