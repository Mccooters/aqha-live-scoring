import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { adminClient } from "../../_lib/registrations";
import { markMembershipPaid } from "../../_lib/memberships";
import { escapeIlike } from "../../_lib/memberAuth";
import { assignHorseNumber, cleanHorseFields } from "../../_lib/horseNumbers";
import { createSquarePaymentLink } from "../../_lib/squarePayments";
import { signupSeason, activeSeasons } from "../../../../lib/membershipSeason";

export async function POST(req) {
  try {
    const {
      membership_type_id, member_name, email, phone, address,
      aqha_member_number, other_memberships,
      emergency_contact_name, emergency_contact_phone,
      interests, applicant_notes, horses, people,
    } = await req.json();

    // Required fields match the club's membership application form.
    if (
      !membership_type_id || !member_name?.trim() || !email?.trim() || !email.includes("@") ||
      !String(phone ?? "").trim() || !String(address ?? "").trim() ||
      !String(emergency_contact_name ?? "").trim() || !String(emergency_contact_phone ?? "").trim()
    ) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const db = adminClient();

    // select * so this works whether or not v25 (included_people) has run.
    const { data: type, error: typeErr } = await db
      .from("membership_types")
      .select("*")
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
    const escapedEmail = escapeIlike(cleanedEmail);
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

    const memberFields = {
      season,
      membership_type_id: type.id,
      membership_type_name: type.name,
      member_name: member_name.trim(),
      email: cleanedEmail,
      phone: String(phone ?? "").trim() || null,
      address: String(address ?? "").trim() || null,
      aqha_member_number: String(aqha_member_number ?? "").trim() || null,
      other_memberships: String(other_memberships ?? "").trim() || null,
      emergency_contact_name: String(emergency_contact_name ?? "").trim() || null,
      emergency_contact_phone: String(emergency_contact_phone ?? "").trim() || null,
      interests: String(interests ?? "").trim() || null,
      applicant_notes: String(applicant_notes ?? "").trim() || null,
      total_cents: totalCents,
      status: "pending",
      // Snapshot how many people this membership covers (like the type
      // name) so later edits to the type never change existing memberships.
      // Only sent once v25 has added the column to the type.
      ...(type.included_people != null ? { included_people: type.included_people } : {}),
    };

    // Reuse an existing UNPAID pending application for this person+season
    // instead of creating a second one — otherwise a double-tap on "Join &
    // Pay", or going back to Square and submitting again, leaves a stranded
    // duplicate "pending payment" row. (Paid/approved is already blocked
    // above, so this only ever reuses an unpaid, not-yet-approved row.)
    const { data: existingPending } = await db
      .from("club_members")
      .select("id")
      .eq("season", season)
      .eq("status", "pending")
      .ilike("email", escapedEmail)
      .order("created_at", { ascending: false })
      .limit(1);
    const reuseId = existingPending?.[0]?.id ?? null;

    let member, memberErr;
    if (reuseId) {
      // Refresh the row with the latest details and clear the old checkout so
      // a fresh Square link is issued. Its old horses/people are replaced below.
      ({ data: member, error: memberErr } = await db
        .from("club_members")
        .update({ ...memberFields, square_order_id: null, square_checkout_url: null, square_payment_id: null })
        .eq("id", reuseId)
        .eq("status", "pending")
        .select()
        .single());
      if (!memberErr && member) {
        await db.from("club_member_horses").delete().eq("member_id", member.id);
        await db.from("club_member_people").delete().eq("member_id", member.id);
      }
    } else {
      ({ data: member, error: memberErr } = await db
        .from("club_members")
        .insert(memberFields)
        .select()
        .single());
    }
    if (memberErr || !member) return NextResponse.json({ error: memberErr?.message ?? "Could not save the application" }, { status: 500 });

    const rawHorseRows = (horses ?? [])
      .map(cleanHorseFields)
      .filter((h) => h.horse_name);
    const horseRows = [];
    const reservedBackNumbers = [];
    for (const rawHorse of rawHorseRows) {
      const { fields } = await assignHorseNumber(db, rawHorse, null, reservedBackNumbers);
      horseRows.push({ member_id: member.id, ...fields });
      if (fields.back_number != null) reservedBackNumbers.push(fields.back_number);
    }
    if (horseRows.length) {
      const { error: horseErr } = await db.from("club_member_horses").insert(horseRows);
      if (horseErr) return NextResponse.json({ error: horseErr.message }, { status: 500 });
    }

    // Extra people covered by the membership (e.g. the rest of a family).
    // Best-effort: a missing v25 table must never eat an application that's
    // about to be paid for — they can be added later in the member portal.
    const personRows = (people ?? [])
      .map((p, idx) => ({
        member_id: member.id,
        name: String(p?.name ?? "").trim(),
        person_type: p?.person_type === "child" ? "child" : "adult",
        sort_order: idx + 1,
      }))
      .filter((p) => p.name)
      .slice(0, Math.max(0, (type.included_people ?? 1) - 1));
    if (personRows.length) {
      try {
        const { error: peopleErr } = await db.from("club_member_people").insert(personRows);
        if (peopleErr) console.error("club_member_people insert failed:", peopleErr.message);
      } catch (err) {
        console.error("club_member_people insert failed:", err);
      }
    }

    // Free (or price not set yet) — no payment step; goes straight to the
    // committee for approval.
    if (totalCents === 0) {
      await markMembershipPaid(db, member.id);
      return NextResponse.json({ redirect: `/membership/success?m=${member.id}` });
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

    const { link, error: squareError, status: squareStatus } =
      await createSquarePaymentLink(db, squarePayload);
    if (squareError) {
      return NextResponse.json({ error: squareError }, { status: squareStatus ?? 500 });
    }

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
