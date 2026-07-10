import { NextResponse } from "next/server";
import crypto from "crypto";
import { adminClient, approveRegistration } from "../../_lib/registrations";
import { markMembershipPaid } from "../../_lib/memberships";

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

  // Find our registration by the Square order ID stored at checkout creation time
  const { data: reg, error: regLookupErr } = await db
    .from("registrations")
    .select("id, status, total_cents")
    .eq("square_order_id", orderId)
    .maybeSingle();

  // A transient DB error must NOT be treated as "no registration" — returning
  // 200 here would tell Square the payment is handled and it would never
  // retry, leaving a paid customer with no entries. Return 500 so Square
  // redelivers the webhook.
  if (regLookupErr) {
    console.error("Square webhook: registration lookup failed, asking Square to retry:", regLookupErr.message);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  // Not an event entry — it may be a membership payment instead.
  if (!reg) {
    return handleMembershipPayment(db, payment, orderId);
  }

  // Already handled — but a Square retry may arrive after the entries were
  // placed and before a same-order membership renewal was settled, so give
  // the renewal another chance (no-op when there isn't one).
  if (reg.status === "paid") return handleMembershipPayment(db, payment, orderId);

  // The completed payment must cover the registration total — a partial
  // payment should never place entries. Fail closed: if the amount is missing
  // or not a number, treat it as NOT covering the total rather than approving.
  const paidCents = payment?.amount_money?.amount;
  if (typeof paidCents !== "number" || paidCents < (reg.total_cents ?? 0)) {
    console.error(
      `Square payment ${payment.id} paid ${paidCents}c but registration ${reg.id} totals ${reg.total_cents}c — not approving`
    );
    return NextResponse.json({ ok: true });
  }

  await db
    .from("registrations")
    .update({ square_payment_id: payment.id })
    .eq("id", reg.id);

  await approveRegistration(db, reg.id);

  // A membership renewal bought in the same checkout shares this Square
  // order — settle it too (does nothing when no membership matches).
  return handleMembershipPayment(db, payment, orderId);
}

// Membership payments come through the same Square webhook as event entries.
// Marking one paid does NOT make the person a member yet — it moves the
// application to "awaiting committee approval" on the coordinator's
// Memberships page.
async function handleMembershipPayment(db, payment, orderId) {
  const { data: member, error } = await db
    .from("club_members")
    .select("id, status, total_cents")
    .eq("square_order_id", orderId)
    .maybeSingle();

  if (error) {
    // If the club_members table doesn't exist yet (schema-v23 not run), this
    // order simply can't be a membership — nothing to do, don't ask Square to
    // retry. Any OTHER error is transient, so return 500 so Square redelivers
    // rather than silently dropping a real membership payment.
    const missingTable = /does not exist|relation .* does not exist|schema cache/i.test(error.message ?? "");
    if (missingTable) return NextResponse.json({ ok: true });
    console.error("Square webhook: membership lookup failed, asking Square to retry:", error.message);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  // No matching membership, or already handled — nothing to do.
  if (!member || member.status !== "pending") {
    return NextResponse.json({ ok: true });
  }

  // The completed payment must cover the membership fee — a partial payment
  // should never advance the application. Fail closed on a missing amount.
  const paidCents = payment?.amount_money?.amount;
  if (typeof paidCents !== "number" || paidCents < (member.total_cents ?? 0)) {
    console.error(
      `Square payment ${payment.id} paid ${paidCents}c but membership ${member.id} totals ${member.total_cents}c — not marking paid`
    );
    return NextResponse.json({ ok: true });
  }

  await db
    .from("club_members")
    .update({ square_payment_id: payment.id })
    .eq("id", member.id);

  await markMembershipPaid(db, member.id);

  return NextResponse.json({ ok: true });
}
