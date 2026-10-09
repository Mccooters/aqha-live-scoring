import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminClient, isCommitteeViewer } from "../../../_lib/registrations";
import { takenNumbers, settleRaffleOrder, touchRaffle } from "../../../_lib/raffles";

// Staff: sell tickets for cash / bank transfer (no Square), or release a
// pending/unpaid order's numbers.
async function verifyStaff(req) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const authCheck = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await authCheck.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}

export async function POST(req, { params }) {
  try {
    const staff = await verifyStaff(req);
    if (!staff) return NextResponse.json({ error: "Staff sign-in required" }, { status: 401 });
    const db = adminClient();
    if (await isCommitteeViewer(db, staff.id)) {
      return NextResponse.json({ error: "This account has read-only committee access — changes are not permitted." }, { status: 403 });
    }
    const body = await req.json();
    const { data: raffle } = await db.from("raffles").select("*").eq("id", params.id).maybeSingle();
    if (!raffle) return NextResponse.json({ error: "Raffle not found" }, { status: 404 });

    if (body?.action === "release") {
      const { data: order } = await db.from("raffle_orders").select("*").eq("id", body.order_id).eq("raffle_id", raffle.id).maybeSingle();
      if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
      if (order.status === "paid") return NextResponse.json({ error: "That order is paid — its numbers can't be released." }, { status: 400 });
      await db.from("raffle_tickets").delete().eq("order_id", order.id);
      await db.from("raffle_orders").update({ status: "cancelled" }).eq("id", order.id);
      await touchRaffle(db, raffle.id);
      return NextResponse.json({ ok: true });
    }

    if (body?.action === "mark_paid") {
      const { data: order } = await db.from("raffle_orders").select("*").eq("id", body.order_id).eq("raffle_id", raffle.id).maybeSingle();
      if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
      await settleRaffleOrder(db, order.id);
      return NextResponse.json({ ok: true });
    }

    // Manual sale.
    const numbers = [...new Set((body?.numbers ?? []).map((n) => parseInt(n, 10)).filter(Number.isInteger))].sort((a, b) => a - b);
    const name = String(body?.name ?? "").trim();
    if (!numbers.length || !name) return NextResponse.json({ error: "Numbers and the buyer's name are required." }, { status: 400 });
    const taken = new Set((await takenNumbers(db, raffle.id)).map((t) => t.number));
    const clash = numbers.filter((n) => taken.has(n));
    if (clash.length) return NextResponse.json({ error: `Already taken: ${clash.join(", ")}` }, { status: 409 });
    const { data: order, error: oErr } = await db.from("raffle_orders").insert({
      raffle_id: raffle.id, buyer_name: name, buyer_email: String(body?.email ?? "").trim() || null, buyer_phone: String(body?.phone ?? "").trim() || null,
      numbers, total_cents: numbers.length * (raffle.ticket_price_cents ?? 0), status: "paid", method: "manual", paid_at: new Date().toISOString(),
    }).select().single();
    if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });
    const { error: tErr } = await db.from("raffle_tickets").insert(
      numbers.map((n) => ({ raffle_id: raffle.id, number: n, order_id: order.id, status: "sold", buyer_name: name }))
    );
    if (tErr) {
      await db.from("raffle_orders").delete().eq("id", order.id);
      return NextResponse.json({ error: /23505|duplicate/i.test(`${tErr.code ?? ""} ${tErr.message ?? ""}`) ? "One of those numbers was just taken." : tErr.message }, { status: 409 });
    }
    await touchRaffle(db, raffle.id);
    return NextResponse.json({ ok: true, order_id: order.id });
  } catch (err) {
    console.error("raffle/sell error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
