import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { adminClient, approveRegistration } from "../../_lib/registrations";

const squareBase =
  process.env.SQUARE_ENVIRONMENT === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";

export async function POST(req) {
  try {
    const { event_id, contact_name, contact_email, entries } = await req.json();

    if (!event_id || !contact_name?.trim() || !contact_email?.trim() || !entries?.length) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const db = adminClient();

    // Load event to get the per-class fee and entries status
    const { data: event, error: evErr } = await db
      .from("events")
      .select("id, name, entry_fee_cents, status")
      .eq("id", event_id)
      .single();
    if (evErr || !event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const entriesOpen = event.status === "open" || event.status === "upcoming";
    if (!entriesOpen) {
      const msg = event.status === "pre_open"
        ? "Entries for this event have not opened yet."
        : "Entries for this event are now closed. Please contact the show secretary.";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // Load classes (with capacity) to build Square line items and enforce spot limits
    const classIds = [...new Set(entries.map((e) => e.class_id))];
    const { data: classes } = await db
      .from("classes")
      .select("id, num, name, capacity")
      .in("id", classIds);
    const classMap = Object.fromEntries((classes ?? []).map((c) => [c.id, c]));

    // Capacity check — reject if any requested class is full
    for (const classId of classIds) {
      const cls = classMap[classId];
      if (cls?.capacity == null) continue; // no limit set
      const { count } = await db
        .from("entries")
        .select("id", { count: "exact", head: true })
        .eq("class_id", classId)
        .eq("scratched", false);
      const requestedForClass = entries.filter((e) => e.class_id === classId).length;
      if ((count ?? 0) + requestedForClass > cls.capacity) {
        const label = cls.name || `Class ${cls.num}`;
        return NextResponse.json(
          { error: `Sorry — "${label}" is now full. Please contact the show secretary.` },
          { status: 409 }
        );
      }
    }

    const feePerClass = event.entry_fee_cents ?? 0;
    const totalCents = entries.length * feePerClass;

    // Create the registration record (pending)
    const { data: reg, error: regErr } = await db
      .from("registrations")
      .insert({
        event_id,
        contact_name: contact_name.trim(),
        contact_email: contact_email.trim(),
        total_cents: totalCents,
        status: "pending",
      })
      .select()
      .single();
    if (regErr) return NextResponse.json({ error: regErr.message }, { status: 500 });

    // Store the pending entries
    const { error: entErr } = await db.from("registration_entries").insert(
      entries.map((e) => ({
        registration_id: reg.id,
        class_id: e.class_id,
        back_number: parseInt(e.back_number, 10),
        horse_name: e.horse_name.trim(),
        exhibitor: e.exhibitor.trim(),
      }))
    );
    if (entErr) return NextResponse.json({ error: entErr.message }, { status: 500 });

    // Free entry — approve straight away, no payment needed
    if (totalCents === 0) {
      await approveRegistration(db, reg.id);
      return NextResponse.json({
        redirect: `/event/${event_id}/register/success?reg=${reg.id}`,
      });
    }

    // Paid entry — create a Square payment link
    if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
      return NextResponse.json(
        { error: "Payment is not configured yet. Please contact the show secretary." },
        { status: 503 }
      );
    }

    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");

    const squarePayload = {
      idempotency_key: randomUUID(),
      order: {
        location_id: process.env.SQUARE_LOCATION_ID,
        reference_id: reg.id,
        line_items: entries.map((e) => {
          const cls = classMap[e.class_id];
          return {
            name: cls ? `Class ${cls.num}: ${cls.name}` : "Class entry",
            quantity: "1",
            base_price_money: { amount: feePerClass, currency: "AUD" },
            note: `Back #${e.back_number} — ${e.horse_name} (${e.exhibitor})`,
          };
        }),
      },
      checkout_options: {
        redirect_url: `${baseUrl}/event/${event_id}/register/success?reg=${reg.id}`,
        ask_for_shipping_address: false,
      },
      pre_populated_data: { buyer_email: contact_email.trim() },
    };

    const squareRes = await fetch(
      `${squareBase}/v2/online-checkout/payment-links`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
          "Square-Version": "2024-01-18",
        },
        body: JSON.stringify(squarePayload),
      }
    );

    const squareData = await squareRes.json();

    if (!squareRes.ok) {
      const msg = squareData.errors?.[0]?.detail ?? "Square payment setup failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const link = squareData.payment_link;

    // Save the Square order ID so the webhook can find this registration
    await db
      .from("registrations")
      .update({ square_order_id: link?.order_id, square_checkout_url: link?.url })
      .eq("id", reg.id);

    return NextResponse.json({ checkout_url: link?.url });
  } catch (err) {
    console.error("registration/create error:", err);
    return NextResponse.json(
      { error: err.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
