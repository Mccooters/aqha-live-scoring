import { NextResponse } from "next/server";
import { adminClient } from "../../../_lib/registrations";
import { takenNumbers, createRaffleCheckout, settleRaffleOrder, deleteSquarePaymentLink } from "../../../_lib/raffles";

// Public: buy raffle tickets. Reserves the chosen numbers (the unique index
// on raffle_tickets is the referee if two people pick the same number at the
// same moment), creates the Square checkout, and returns its URL. The
// reservation lasts RESERVATION_MINUTES; the webhook marks the tickets sold.
export async function POST(req, { params }) {
  try {
    const body = await req.json();
    const numbers = [...new Set((body?.numbers ?? []).map((n) => parseInt(n, 10)).filter(Number.isInteger))].sort((a, b) => a - b);
    const name = String(body?.name ?? "").trim().replace(/\s+/g, " ");
    const email = String(body?.email ?? "").trim().toLowerCase();
    const phone = String(body?.phone ?? "").trim();
    if (!numbers.length) return NextResponse.json({ error: "Pick at least one number." }, { status: 400 });
    if (numbers.length > 20) return NextResponse.json({ error: "You can buy up to 20 tickets in one go." }, { status: 400 });
    if (!name) return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
    if (!email || !email.includes("@")) return NextResponse.json({ error: "Please enter a valid email address — your ticket numbers are sent there." }, { status: 400 });

    const db = adminClient();
    const { data: raffle } = await db.from("raffles").select("*").eq("id", params.id).maybeSingle();
    if (!raffle) return NextResponse.json({ error: "Raffle not found" }, { status: 404 });
    if (raffle.status !== "open") return NextResponse.json({ error: "This raffle isn't open for ticket sales." }, { status: 400 });
    if (numbers.some((n) => n < 1 || n > raffle.ticket_count)) {
      return NextResponse.json({ error: `Numbers must be between 1 and ${raffle.ticket_count}.` }, { status: 400 });
    }
    const taken = new Set((await takenNumbers(db, raffle.id)).map((t) => t.number));
    const clash = numbers.filter((n) => taken.has(n));
    if (clash.length) {
      return NextResponse.json({ error: `Sorry — number${clash.length === 1 ? "" : "s"} ${clash.join(", ")} ${clash.length === 1 ? "has" : "have"} just been taken. Please pick again.`, taken: clash }, { status: 409 });
    }

    const totalCents = numbers.length * (raffle.ticket_price_cents ?? 0);
    const { data: order, error: oErr } = await db
      .from("raffle_orders")
      .insert({ raffle_id: raffle.id, buyer_name: name, buyer_email: email, buyer_phone: phone || null, numbers, total_cents: totalCents, status: "pending", method: "square" })
      .select().single();
    if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });

    // Reserve the numbers — a duplicate means someone beat us to one.
    const { error: tErr } = await db.from("raffle_tickets").insert(
      numbers.map((n) => ({ raffle_id: raffle.id, number: n, order_id: order.id, status: "reserved", buyer_name: name }))
    );
    if (tErr) {
      await db.from("raffle_orders").delete().eq("id", order.id);
      if (/23505|duplicate/i.test(`${tErr.code ?? ""} ${tErr.message ?? ""}`)) {
        return NextResponse.json({ error: "Sorry — one of those numbers was just taken by someone else. Please pick again." }, { status: 409 });
      }
      return NextResponse.json({ error: tErr.message }, { status: 500 });
    }

    // Free raffle (price 0): nothing to pay — sold immediately.
    if (totalCents <= 0) {
      await settleRaffleOrder(db, order.id);
      return NextResponse.json({ ok: true, order_id: order.id, paid: true });
    }

    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
    const { link, error: sqErr, status } = await createRaffleCheckout(db, { raffle, order, baseUrl });
    if (sqErr || !link?.url) {
      await db.from("raffle_tickets").delete().eq("order_id", order.id);
      await db.from("raffle_orders").update({ status: "cancelled" }).eq("id", order.id);
      return NextResponse.json({ error: sqErr ?? "Could not start the payment." }, { status: status ?? 500 });
    }
    await db.from("raffle_orders")
      .update({ square_order_id: link.order_id, square_checkout_url: link.url })
      .eq("id", order.id);
    return NextResponse.json({ ok: true, order_id: order.id, checkout_url: link.url });
  } catch (err) {
    console.error("raffle/order error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
