import { NextResponse } from "next/server";
import { adminClient } from "../../../_lib/registrations";

// Public: the success page polls this (by order id — a long random uuid)
// until the Square webhook marks the order paid.
export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const orderId = new URL(req.url).searchParams.get("order");
  if (!orderId) return NextResponse.json({ error: "order required" }, { status: 400 });
  const db = adminClient();
  const { data: order } = await db
    .from("raffle_orders")
    .select("id, raffle_id, buyer_name, numbers, total_cents, status, square_checkout_url")
    .eq("id", orderId).eq("raffle_id", params.id).maybeSingle();
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  return NextResponse.json({ ok: true, order });
}
