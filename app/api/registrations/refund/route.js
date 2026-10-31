import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { adminClient, isCommitteeViewer } from "../../_lib/registrations";
import { refundSquarePayment, getSquareRefund } from "../../_lib/squarePayments";
import { refundPayPalCapture, getPayPalRefund } from "../../_lib/paypal";
import { recordWebsiteFee } from "../../_lib/websiteFees";
import { grantCredit, creditStatus } from "../../_lib/credits";

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

    const { registration_id, amount_cents, reason, manual, credit, check } = await req.json();
    const db = adminClient();

    // "check": re-ask Square for the current status of every Square refund in
    // this registration's log (schema-v52) — refunds start PENDING and settle
    // to COMPLETED later, so staff can confirm the money really went back.
    if (check) {
      const { data: reg } = await db.from("registrations").select("id, refund_log").eq("id", registration_id).maybeSingle();
      if (!reg) return NextResponse.json({ error: "Registration not found" }, { status: 404 });
      const log = Array.isArray(reg.refund_log) ? reg.refund_log : [];
      let changed = false;
      let lookupError = null;
      const next = [];
      for (const item of log) {
        const viaProvider = item.method === "square" || item.method === "paypal";
        if (!viaProvider || !item.refund_id || item.status === "COMPLETED") { next.push(item); continue; }
        const { refund, error } = item.method === "paypal"
          ? await getPayPalRefund(item.refund_id)
          : await getSquareRefund(db, item.refund_id);
        if (error) { lookupError = error; next.push(item); continue; }
        const status = refund?.status ?? item.status;
        if (status !== item.status) changed = true;
        next.push({ ...item, status, checked_at: new Date().toISOString() });
      }
      if (changed) await db.from("registrations").update({ refund_log: next }).eq("id", registration_id);
      return NextResponse.json({ ok: true, refund_log: next, error: lookupError ?? undefined });
    }
    // A "manual" refund records money you already returned OUTSIDE Square
    // (cash, bank transfer, etc.) — it never calls Square, it just logs it so
    // the refunded total and revenue are right.
    const isCredit = Boolean(credit);             // keep the money as club credit (schema-v68)
    const isManual = Boolean(manual) || isCredit; // neither one calls the payment provider
    const amount = Math.round(Number(amount_cents));
    if (!registration_id || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "registration_id and a refund amount are required" }, { status: 400 });
    }

    if (await isCommitteeViewer(db, staff.id)) {
      return NextResponse.json({ error: "This account has read-only committee access — changes are not permitted." }, { status: 403 });
    }


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
    // A provider refund needs the payment on file (Square payment id, or the
    // PayPal capture id — schema-v58 says which); a manual (already-given)
    // refund can be recorded against any paid registration.
    const provider = reg.payment_provider === "paypal" ? "paypal" : "square";
    const providerName = provider === "paypal" ? "PayPal" : "Square";
    if (!isManual && !reg.square_payment_id) {
      return NextResponse.json(
        { error: `This registration has no ${providerName} payment on file (it may have been a free or manually-created entry). Record it as a refund given outside ${providerName} instead.` },
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

    let refund = null;
    if (!isManual && provider === "paypal") {
      const { refund: ppRefund, error: ppErr, status } = await refundPayPalCapture({
        captureId: reg.square_payment_id,
        amountCents: amount,
        note: reason || `HCQHA refund`,
      });
      if (ppErr) {
        return NextResponse.json({ error: ppErr }, { status: status ?? 502 });
      }
      refund = ppRefund;
    } else if (!isManual) {
      const { refund: sqRefund, error: sqErr, status } = await refundSquarePayment(db, {
        paymentId: reg.square_payment_id,
        amountCents: amount,
        reason: reason || `HCQHA refund`,
        idempotencyKey: randomUUID(),
      });
      if (sqErr) {
        return NextResponse.json({ error: sqErr }, { status: status ?? 502 });
      }
      refund = sqRefund;
    }

    // Website fee credit (schema-v60): the club shouldn't pay the website's
    // percentage on money it has given back. The flat once-per-event part is
    // credited only when this refund returns the whole registration (net of
    // any credit already given). Never blocks the refund from being recorded.
    if (!isManual && refund) {
      let ev = null;
      try {
        ({ data: ev } = await db.from("events").select("name").eq("id", reg.event_id).maybeSingle());
      } catch { /* name only */ }
      let flatCredit = 0;
      if (alreadyRefunded + amount >= (reg.total_cents ?? 0)) {
        try {
          const { data: lines } = await db.from("website_fees").select("flat_fee_cents").eq("registration_id", reg.id);
          flatCredit = (lines ?? []).reduce((s, l) => s + (Number(l.flat_fee_cents) || 0), 0);
        } catch { /* ledger optional */ }
      }
      await recordWebsiteFee(db, {
        provider,
        paymentId: refund.id ? `refund:${refund.id}` : null,
        kind: "refund",
        description: `${ev?.name ?? "Event"} — refund`,
        payerName: reg.contact_name,
        eventId: reg.event_id,
        registrationId: reg.id,
        amountCents: -amount,
        flatFeeCents: flatCredit > 0 ? -flatCredit : 0,
        note: reason ? String(reason).slice(0, 200) : null,
      });
    }

    // Credit instead of a refund (schema-v68): the money stays with the club
    // and the person gets the amount as club credit on their email, to
    // spend on a later event. Written first, so a database without the
    // credits table stops here with nothing half-done.
    let creditBalance = null;
    if (isCredit) {
      const { data: ev } = await db.from("events").select("name").eq("id", reg.event_id).maybeSingle();
      const granted = await grantCredit(db, {
        email: reg.contact_email,
        amount_cents: amount,
        kind: "credit",
        reason: reason ? String(reason).slice(0, 300) : `Credit instead of a refund — ${ev?.name ?? "event"} registration`,
        event_id: reg.event_id,
        registration_id: reg.id,
        created_by: staff.email ?? "staff",
      });
      if (granted.error) return NextResponse.json({ error: granted.error }, { status: 500 });
      creditBalance = (await creditStatus(db, reg.contact_email)).balance_cents;
    }

    // Record the refund. Best-effort for a Square refund: on a pre-v36
    // database the columns don't exist yet — the money is already refunded at
    // Square, so don't fail; just report it couldn't be recorded. A MANUAL
    // record is only useful if it saves, so it treats that as an error.
    const noteReason = reason || (isCredit ? "Kept as club credit" : isManual ? `Refunded outside ${providerName}` : null);
    const patch = {
      refunded_cents: alreadyRefunded + amount,
      last_refund_at: new Date().toISOString(),
      refund_reason: noteReason ? String(noteReason).slice(0, 500) : reg.refund_reason ?? null,
    };
    // One line per refund with Square's own id + status (schema-v52), so the
    // page can show a positive "COMPLETED" from Square rather than just the
    // app's running total. Falls back to the v36 columns alone on an older
    // database (the column is simply left out of the second attempt).
    const logEntry = {
      amount_cents: amount,
      at: new Date().toISOString(),
      method: isCredit ? "credit" : isManual ? "manual" : provider,
      refund_id: refund?.id ?? null,
      status: isCredit ? "CREDITED" : isManual ? "RECORDED" : (refund?.status ?? "PENDING"),
      reason: noteReason ? String(noteReason).slice(0, 200) : null,
      by: staff.email ?? null,
    };
    const prevLog = Array.isArray(reg.refund_log) ? reg.refund_log : [];
    let { error: updErr } = await db
      .from("registrations")
      .update({ ...patch, refund_log: [...prevLog, logEntry] })
      .eq("id", registration_id);
    if (updErr && /refund_log/i.test(updErr.message ?? "")) {
      ({ error: updErr } = await db.from("registrations").update(patch).eq("id", registration_id));
    }
    let recorded = true;
    if (updErr) {
      recorded = false;
      const note = isManual
        ? "could not record the manual refund"
        : `refund succeeded at ${providerName} but could not be recorded`;
      console.error(`${note} (run schema-v36):`, updErr.message);
      if (isManual) {
        return NextResponse.json(
          { error: "Couldn't record the refund — run schema-v36-registration-refunds.sql in Supabase first, then try again." },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      refunded_cents: amount,
      total_refunded_cents: alreadyRefunded + amount,
      refund_status: refund?.status ?? null,
      refund_id: refund?.id ?? null,
      provider: isCredit ? "credit" : isManual ? "manual" : provider,
      credit_balance_cents: creditBalance,
      recorded,
    });
  } catch (err) {
    console.error("registrations/refund error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
