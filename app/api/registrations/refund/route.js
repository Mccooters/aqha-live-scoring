import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { adminClient } from "../../_lib/registrations";
import { refundSquarePayment } from "../../_lib/squarePayments";

// Issuing a refund moves real money, so only signed-in show staff may call it.
// The dashboard sends the coordinator's login token; we verify it with
// Supabase before doing anything.
async function verifyStaff(req) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const authCheck = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const { data, error } = await authCheck.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function POST(req) {
  try {
    const staff = await verifyStaff(req);
    if (!staff) {
      return NextResponse.json({ error: "Staff sign-in required" }, { status: 401 });
    }

    const { registration_id, amount_cents, reason } = await req.json();
    const amount = Math.round(Number(amount_cents));
    if (!registration_id || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "registration_id and a refund amount are required" }, { status: 400 });
    }

    const db = adminClient();

    // select * so refunded_cents comes through when schema-v36 has been run,
    // and is simply absent (treated as 0) when it hasn't.
    const { data: reg, error: regErr } = await db
      .from("registrations")
      .select("*")
      .eq("id", registration_id)
      .maybeSingle();
    if (regErr || !reg) {
      return NextResponse.json({ error: "Registration not found" }, { status: 404 });
    }
    if (reg.status !== "paid") {
      return NextResponse.json({ error: "Only a paid registration can be refunded." }, { status: 400 });
    }
    if (!reg.square_payment_id) {
      return NextResponse.json(
        { error: "This registration has no Square payment on file (it may have been a free or manually-created entry). Refund in your Square account instead." },
        { status: 400 }
      );
    }

    const alreadyRefunded = reg.refunded_cents ?? 0;
    const refundable = (reg.total_cents ?? 0) - alreadyRefunded;
    if (amount > refundable) {
      return NextResponse.json(
        { error: `That's more than is left to refund. Up to ${(refundable / 100).toFixed(2)} can still be refunded on this registration.` },
        { status: 400 }
      );
    }

    const { refund, error: sqErr, status } = await refundSquarePayment(db, {
      paymentId: reg.square_payment_id,
      amountCents: amount,
      reason: reason || `HCQHA refund`,
      idempotencyKey: randomUUID(),
    });
    if (sqErr) {
      return NextResponse.json({ error: sqErr }, { status: status ?? 502 });
    }

    // Record the refund. Best-effort: on a pre-v36 database the columns don't
    // exist yet — the money is already refunded at Square, so don't fail; just
    // note that the running total couldn't be recorded.
    const { error: updErr } = await db
      .from("registrations")
      .update({
        refunded_cents: alreadyRefunded + amount,
        last_refund_at: new Date().toISOString(),
        refund_reason: reason ? String(reason).slice(0, 500) : reg.refund_reason ?? null,
      })
      .eq("id", registration_id);
    let recorded = true;
    if (updErr) {
      recorded = false;
      console.error("Refund succeeded at Square but could not be recorded (run schema-v36):", updErr.message);
    }

    return NextResponse.json({
      ok: true,
      refunded_cents: amount,
      total_refunded_cents: alreadyRefunded + amount,
      refund_status: refund?.status ?? null,
      recorded,
    });
  } catch (err) {
    console.error("registrations/refund error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
