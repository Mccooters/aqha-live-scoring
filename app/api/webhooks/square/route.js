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
    .select("*")
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

  // Not the first payment of an entry — it may be a clinic BALANCE payment
  // (schema-v47, the second checkout on a deposit registration) or a
  // membership payment instead.
  if (!reg) {
    const balanceRes = await handleBalancePayment(db, payment, orderId);
    if (balanceRes) return balanceRes;
    return handleMembershipPayment(db, payment, orderId);
  }

  // Already handled — but a Square retry may arrive after the entries were
  // placed and before a same-order membership renewal was settled, so give
  // the renewal another chance (no-op when there isn't one).
  if (reg.status === "paid") return handleMembershipPayment(db, payment, orderId);

  // The completed payment must cover what was due — the full total, or the
  // deposit when the payer chose the deposit plan (schema-v47; the balance
  // comes later through its own checkout). Fail closed: if the amount is
  // missing or not a number, treat it as NOT covering rather than approving.
  const dueCents = (reg.deposit_cents ?? 0) > 0 ? reg.deposit_cents : (reg.total_cents ?? 0);
  const paidCents = payment?.amount_money?.amount;
  if (typeof paidCents !== "number" || paidCents < dueCents) {
    console.error(
      `Square payment ${payment.id} paid ${paidCents}c but registration ${reg.id} needed ${dueCents}c — not approving`
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

// A clinic balance payment (schema-v47): a Square checkout created by
// /api/registrations/pay-balance. Since schema-v50 there can be SEVERAL —
// part payments are each logged in registrations.balance_payments and the
// balance is marked fully paid once they add up to the total. Old links that
// were superseded by a different amount are still matched (balance_order_ids)
// so money paid through them is recorded too. Returns null when this order
// isn't a balance payment, so the membership handler gets its turn.
async function handleBalancePayment(db, payment, orderId) {
  let { data: reg, error } = await db
    .from("registrations")
    .select("*")
    .eq("balance_square_order_id", orderId)
    .maybeSingle();
  if (error) {
    // Pre-v47 databases have no balance columns — this can't be a balance
    // payment there. Any other error is transient: ask Square to retry.
    if (/balance_square_order_id|does not exist|schema cache/i.test(error.message ?? "")) return null;
    console.error("Square webhook: balance lookup failed, asking Square to retry:", error.message);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  if (!reg) {
    // Not the outstanding link — maybe an older balance link for this
    // registration that a new amount replaced (schema-v50).
    const { data: byHistory, error: histErr } = await db
      .from("registrations")
      .select("*")
      .contains("balance_order_ids", JSON.stringify([orderId]))
      .maybeSingle();
    if (histErr) {
      if (/balance_order_ids|does not exist|schema cache/i.test(histErr.message ?? "")) return null;
      console.error("Square webhook: balance history lookup failed, asking Square to retry:", histErr.message);
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }
    reg = byHistory;
  }
  if (!reg) return null;

  const paidCents = payment?.amount_money?.amount;
  if (typeof paidCents !== "number" || paidCents <= 0) {
    console.error(`Square payment ${payment.id} for registration ${reg.id} has no usable amount — not recording`);
    return NextResponse.json({ ok: true });
  }
  const owedFull = Math.max(0, (reg.total_cents ?? 0) - (reg.deposit_cents ?? 0));

  // Pre-v50 database (no payments log): the original all-or-nothing rule.
  if (!("balance_payments" in reg)) {
    if (reg.balance_paid_at) return NextResponse.json({ ok: true }); // retry — already recorded
    if (paidCents < owedFull) {
      console.error(
        `Square payment ${payment.id} paid ${paidCents}c but balance for registration ${reg.id} is ${owedFull}c — not recording`
      );
      return NextResponse.json({ ok: true });
    }
    const { error: updErr } = await db
      .from("registrations")
      .update({ balance_paid_at: new Date().toISOString(), balance_payment_id: payment.id })
      .eq("id", reg.id);
    if (updErr) {
      console.error("Square webhook: recording balance payment failed, asking Square to retry:", updErr.message);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const list = Array.isArray(reg.balance_payments) ? reg.balance_payments : [];
  if (list.some((p) => p?.payment_id === payment.id)) return NextResponse.json({ ok: true }); // retry — already recorded
  if (reg.balance_paid_at) {
    // Fully settled already and this is a NEW payment (an old link paid
    // after the fact) — log it so staff can see the overpayment and refund.
    console.error(`Square payment ${payment.id}: registration ${reg.id} balance was already settled — recording as overpayment`);
  }

  const now = new Date().toISOString();
  const newList = [...list, { amount_cents: paidCents, at: now, method: "square", payment_id: payment.id }];
  const totalPaid = newList.reduce((s, p) => s + (Number(p?.amount_cents) || 0), 0);
  const patch = { balance_payments: newList, balance_payment_id: payment.id };
  if (reg.balance_square_order_id === orderId) {
    // This link is now used up — the next payment needs a fresh checkout.
    patch.balance_square_order_id = null;
    patch.balance_checkout_url = null;
    patch.balance_checkout_cents = null;
  }
  if (!reg.balance_paid_at && totalPaid >= owedFull) patch.balance_paid_at = now;
  const { error: updErr } = await db.from("registrations").update(patch).eq("id", reg.id);
  if (updErr) {
    console.error("Square webhook: recording balance payment failed, asking Square to retry:", updErr.message);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
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
