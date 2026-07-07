import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { adminClient } from "../../_lib/registrations";
import { markMembershipPaid } from "../../_lib/memberships";
import { signupSeason, activeSeasons } from "../../../../lib/membershipSeason";

const squareBase =
  process.env.SQUARE_ENVIRONMENT === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";

export async function POST(req) {
  try {
    const { membership_type_id, member_name, email, phone, address, applicant_notes, horses } =
      await req.json();

    if (!membership_type_id || !member_name?.trim() || !email?.trim() || !email.includes("@")) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const db = adminClient();

    const { data: type, error: typeErr } = await db
      .from("membership_types")
      .select("id, name, fee_cents, active")
      .eq("id", membership_type_id)
      .single();
    if (typeErr || !type || !type.active) {
      return NextResponse.json(
        { error: "That membership type is no longer available. Please refresh the page and try again." },
        { status: 400 }
      );
    }

    const season = signupSeason();
    const cleanedEmail = email.trim();

    // One live application per person per season — stops accidental double
    // payment. Abandoned checkouts (still "pending") don't block a retry.
    const escapedEmail = cleanedEmail.replace(/([\\%_])/g, "\\$1");
    const { data: existing } = await db
      .from("club_members")
      .select("id, status, season")
      .in("season", activeSeasons())
      .in("status", ["paid", "approved"])
      .ilike("email", escapedEmail)
      .limit(1);
    if (existing?.length) {
      const msg = existing[0].status === "approved"
        ? "You already have a current membership with this email address."
        : "A membership application for this email address has already been paid and is awaiting approval.";
      return NextResponse.json({ error: msg }, { status: 409 });
    }

    const totalCents = type.fee_cents ?? 0;

    const { data: member, error: memberErr } = await db
      .from("club_members")
      .insert({
        season,
        membership_type_id: type.id,
        membership_type_name: type.name,
        member_name: member_name.trim(),
        email: cleanedEmail,
        phone: String(phone ?? "").trim() || null,
        address: String(address ?? "").trim() || null,
        applicant_notes: String(applicant_notes ?? "").trim() || null,
        total_cents: totalCents,
        status: "pending",
      })
      .select()
      .single();
    if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });

    const horseRows = (horses ?? [])
      .map((h) => ({
        member_id: member.id,
        horse_name: String(h.horse_name ?? "").trim(),
        back_number:
          h.back_number == null || h.back_number === "" ? null : parseInt(h.back_number, 10),
        breed: String(h.breed ?? "").trim() || null,
        registrations: String(h.registrations ?? "").trim() || null,
        notes: String(h.notes ?? "").trim() || null,
      }))
      .filter((h) => h.horse_name);
    if (horseRows.length) {
      const { error: horseErr } = await db.from("club_member_horses").insert(horseRows);
      if (horseErr) return NextResponse.json({ error: horseErr.message }, { status: 500 });
    }

    // Free (or price not set yet) — no payment step; goes straight to the
    // committee for approval.
    if (totalCents === 0) {
      await markMembershipPaid(db, member.id);
      return NextResponse.json({ redirect: `/membership/success?m=${member.id}` });
    }

    if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
      return NextResponse.json(
        { error: "Payment is not configured yet. Please contact the club." },
        { status: 503 }
      );
    }

    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");

    const squarePayload = {
      idempotency_key: randomUUID(),
      order: {
        location_id: process.env.SQUARE_LOCATION_ID,
        reference_id: member.id,
        line_items: [
          {
            name: `${type.name} — ${season} season`,
            quantity: "1",
            base_price_money: { amount: totalCents, currency: "AUD" },
            note: member_name.trim(),
          },
        ],
      },
      checkout_options: {
        redirect_url: `${baseUrl}/membership/success?m=${member.id}`,
        ask_for_shipping_address: false,
      },
      pre_populated_data: { buyer_email: cleanedEmail },
    };

    const squareRes = await fetch(`${squareBase}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Square-Version": "2024-01-18",
      },
      body: JSON.stringify(squarePayload),
    });

    const squareData = await squareRes.json();
    if (!squareRes.ok) {
      const msg = squareData.errors?.[0]?.detail ?? "Square payment setup failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const link = squareData.payment_link;

    // Save the Square order ID so the webhook can find this application
    await db
      .from("club_members")
      .update({ square_order_id: link?.order_id, square_checkout_url: link?.url })
      .eq("id", member.id);

    return NextResponse.json({ checkout_url: link?.url });
  } catch (err) {
    console.error("memberships/create error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
