import { NextResponse } from "next/server";
import { approveRegistration } from "./registrations";
import { markMembershipPaid } from "./memberships";

// Settlement of a COMPLETED payment — the one place that turns "money
// arrived for order X" into entries / a paid membership / sold raffle tickets
// / a recorded clinic balance payment. Written for the Square webhook and
// moved here unchanged (Oct 2026) so PayPal (app/api/paypal/return and
// app/api/webhooks/paypal) settles through exactly the same rules.
//
// `payment` is Square's payment shape: { id, order_id, status, amount_money:
// { amount (cents), currency } } — PayPal captures are translated into it by
// paymentFromCapture() in paypal.js. `orderId` is the checkout order id
// stored on the row at checkout time (square_order_id / balance_square_order_id
// — the columns keep their Square names whichever provider issued the id).
// Returns a NextResponse: 2xx = handled (or nothing to do), 5xx = transient
// problem, the caller should let the provider retry.
export async function settleCompletedPayment(db, payment, orderId, { provider = "square" } = {}) {
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
    console.error("Payment settlement: registration lookup failed, asking the provider to retry:", regLookupErr.message);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  // Not the first payment of an entry — it may be a clinic BALANCE payment
  // (schema-v47, the second checkout on a deposit registration) or a
  // membership payment instead.
  if (!reg) {
    const balanceRes = await handleBalancePayment(db, payment, orderId, provider);
    if (balanceRes) return balanceRes;
    const raffleRes = await handleRafflePayment(db, payment, orderId);
    if (raffleRes) return raffleRes;
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
      `Payment ${payment.id} paid ${paidCents}c but registration ${reg.id} needed ${dueCents}c — not approving`
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

// A raffle ticket purchase (schema-v56): created by /api/raffle/[id]/order.
// Marks the order paid and its reserved numbers sold, then emails the buyer
// their numbers. null = not a raffle order (fall through to memberships).
async function handleRafflePayment(db, payment, orderId) {
  const { data: order, error } = await db
    .from("raffle_orders").select("*").eq("square_order_id", orderId).maybeSingle();
  if (error) {
    if (/raffle_orders|does not exist|schema cache/i.test(error.message ?? "")) return null;
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  if (!order) return null;
  const paidCents = payment?.amount_money?.amount;
  if (typeof paidCents !== "number" || paidCents < (order.total_cents ?? 0)) {
    console.error(`Payment ${payment.id} paid ${paidCents}c but raffle order ${order.id} needed ${order.total_cents}c`);
    return NextResponse.json({ ok: true });
  }
  const { settleRaffleOrder } = await import("./raffles");
  const wasPaid = order.status === "paid";
  // Reservation may have expired and been released before payment landed
  // (slow checkout) — re-reserve the numbers if they're still free.
  const { data: tickets } = await db.from("raffle_tickets").select("number").eq("order_id", order.id);
  if (!tickets?.length) {
    await db.from("raffle_tickets").insert(
      (order.numbers ?? []).map((n) => ({ raffle_id: order.raffle_id, number: n, order_id: order.id, status: "sold", buyer_name: order.buyer_name }))
    ).then(({ error: insErr }) => { if (insErr) console.error("Raffle re-reserve failed (number resold?):", insErr.message); });
  }
  await settleRaffleOrder(db, order.id, { paymentId: payment.id });
  if (!wasPaid) {
    try { await sendRaffleReceipt(db, order); } catch (e) { console.error("Raffle receipt email failed:", e?.message ?? e); }
  }
  return NextResponse.json({ ok: true });
}

async function sendRaffleReceipt(db, order) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.BOOKING_EMAIL_FROM;
  if (!apiKey || !from || !order.buyer_email) return;
  const { data: raffle } = await db.from("raffles").select("name, draw_date, prizes").eq("id", order.raffle_id).maybeSingle();
  const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const nums = (order.numbers ?? []).join(", ");
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#241A12">
      <h2 style="margin:0 0 8px">${esc(raffle?.name ?? "Raffle")} — your tickets</h2>
      <p>Thanks ${esc(order.buyer_name)}! Your ticket number${(order.numbers ?? []).length === 1 ? " is" : "s are"}:</p>
      <p style="font-size:26px;font-weight:bold;letter-spacing:.04em;color:#3A2A1C">${esc(nums)}</p>
      ${raffle?.draw_date ? `<p>Drawn: <strong>${esc(raffle.draw_date)}</strong>. Results are posted on the raffle page.</p>` : ""}
      ${Array.isArray(raffle?.prizes) && raffle.prizes.length ? `<p style="color:#555;font-size:13px">Prizes: ${raffle.prizes.map((p) => esc(p.title)).join(" · ")}</p>` : ""}
      <p style="font-size:12px;color:#888;margin-top:24px">Hunter Coast Quarter Horse Association · HCQHA Live Scoring</p>
    </div>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [order.buyer_email], ...(process.env.BOOKING_EMAIL_REPLY_TO ? { reply_to: process.env.BOOKING_EMAIL_REPLY_TO } : {}), subject: `Your ${raffle?.name ?? "raffle"} ticket numbers: ${nums}`, html }),
  });
}

// A clinic balance payment (schema-v47): a Square checkout created by
// /api/registrations/pay-balance. Since schema-v50 there can be SEVERAL —
// part payments are each logged in registrations.balance_payments and the
// balance is marked fully paid once they add up to the total. Old links that
// were superseded by a different amount are still matched (balance_order_ids)
// so money paid through them is recorded too. Returns null when this order
// isn't a balance payment, so the membership handler gets its turn.
async function handleBalancePayment(db, payment, orderId, provider = "square") {
  let { data: reg, error } = await db
    .from("registrations")
    .select("*")
    .eq("balance_square_order_id", orderId)
    .maybeSingle();
  if (error) {
    // Pre-v47 databases have no balance columns — this can't be a balance
    // payment there. Any other error is transient: ask Square to retry.
    if (/balance_square_order_id|does not exist|schema cache/i.test(error.message ?? "")) return null;
    console.error("Payment settlement: balance lookup failed, asking the provider to retry:", error.message);
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
      console.error("Payment settlement: balance history lookup failed, asking the provider to retry:", histErr.message);
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }
    reg = byHistory;
  }
  if (!reg) return null;

  const paidCents = payment?.amount_money?.amount;
  if (typeof paidCents !== "number" || paidCents <= 0) {
    console.error(`Payment ${payment.id} for registration ${reg.id} has no usable amount — not recording`);
    return NextResponse.json({ ok: true });
  }
  const owedFull = Math.max(0, (reg.total_cents ?? 0) - (reg.deposit_cents ?? 0));

  // Pre-v50 database (no payments log): the original all-or-nothing rule.
  if (!("balance_payments" in reg)) {
    if (reg.balance_paid_at) return NextResponse.json({ ok: true }); // retry — already recorded
    if (paidCents < owedFull) {
      console.error(
        `Payment ${payment.id} paid ${paidCents}c but balance for registration ${reg.id} is ${owedFull}c — not recording`
      );
      return NextResponse.json({ ok: true });
    }
    const { error: updErr } = await db
      .from("registrations")
      .update({ balance_paid_at: new Date().toISOString(), balance_payment_id: payment.id })
      .eq("id", reg.id);
    if (updErr) {
      console.error("Payment settlement: recording balance payment failed, asking the provider to retry:", updErr.message);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const list = Array.isArray(reg.balance_payments) ? reg.balance_payments : [];
  if (list.some((p) => p?.payment_id === payment.id)) return NextResponse.json({ ok: true }); // retry — already recorded
  if (reg.balance_paid_at) {
    // Fully settled already and this is a NEW payment (an old link paid
    // after the fact) — log it so staff can see the overpayment and refund.
    console.error(`Payment ${payment.id}: registration ${reg.id} balance was already settled — recording as overpayment`);
  }

  const now = new Date().toISOString();
  const newList = [...list, { amount_cents: paidCents, at: now, method: provider, payment_id: payment.id }];
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
    console.error("Payment settlement: recording balance payment failed, asking the provider to retry:", updErr.message);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// Membership payments come through the same settlement as event entries.
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
    console.error("Payment settlement: membership lookup failed, asking the provider to retry:", error.message);
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
      `Payment ${payment.id} paid ${paidCents}c but membership ${member.id} totals ${member.total_cents}c — not marking paid`
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
