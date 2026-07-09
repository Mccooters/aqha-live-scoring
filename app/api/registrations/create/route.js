import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { adminClient, approveRegistration } from "../../_lib/registrations";
import { membershipRequirement, hasCurrentMembership, renewalOffer, markMembershipPaid } from "../../_lib/memberships";
import { getMemberAccount } from "../../_lib/memberAuth";
import { createSquarePaymentLink } from "../../_lib/squarePayments";
import { activeSeasons } from "../../../../lib/membershipSeason";

const DAY_MEMBERSHIP_CENTS = 2000;
const REPLACEMENT_NUMBERS_CENTS = 500;

function normalizeName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function classLabel(cls) {
  if (!cls) return "this class";
  return cls.num ? `Class ${cls.num}: ${cls.name}` : cls.name;
}

export async function POST(req) {
  try {
    const {
      event_id, contact_name, contact_email, entries,
      day_membership, replacement_numbers,
      membership_renewal, membership_renewal_type_id,
    } = await req.json();

    if (!event_id || !contact_name?.trim() || !contact_email?.trim() || !entries?.length) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const db = adminClient();

    // Load event to get the per-class fee and entries status
    const { data: event, error: evErr } = await db
      .from("events")
      .select("id, name, starts_on, entry_fee_cents, status, event_type")
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

    // Membership renewal add-on (offered during July only). The renewal
    // belongs to the member signed in via the member-portal cookie — never to
    // whatever email was typed into the form — and eligibility is re-checked
    // here so the flag can't be abused.
    let renewal = null;
    if (membership_renewal) {
      const account = await getMemberAccount(db);
      if (!account) {
        return NextResponse.json(
          { error: "Please sign in on the Members page to renew your membership with this entry, or untick the renewal option." },
          { status: 401 }
        );
      }
      let offer = null;
      try {
        offer = await renewalOffer(db, account.email);
      } catch (err) {
        console.error("Renewal offer lookup failed:", err);
      }
      if (!offer) {
        return NextResponse.json(
          { error: "Membership renewal isn't available on this account right now — please untick the renewal option and try again." },
          { status: 400 }
        );
      }
      if (!membership_renewal_type_id) {
        return NextResponse.json(
          { error: "Please choose a membership type for your renewal." },
          { status: 400 }
        );
      }
      const { data: type } = await db
        .from("membership_types")
        .select("*")
        .eq("id", membership_renewal_type_id)
        .eq("active", true)
        .maybeSingle();
      if (!type) {
        return NextResponse.json(
          { error: "That membership type is no longer offered — please pick another for your renewal." },
          { status: 400 }
        );
      }
      renewal = { ...offer, type };
    }

    // Membership check — when the coordinator has turned on "membership
    // required", only email addresses with an approved, current club
    // membership may enter. Any lookup failure fails open so entries are
    // never blocked by a technical problem.
    const requiresMembership = await membershipRequirement(db, event);
    const eventDate = event.starts_on ? new Date(event.starts_on) : new Date();
    // A renewal bought with this entry counts as the annual membership when
    // it covers the season the event falls in.
    const renewalCoversEvent = renewal
      ? activeSeasons(eventDate).includes(renewal.season)
      : false;
    let includeDayMembership = false;
    if (requiresMembership) {
      let isMember = false;
      try {
        isMember = await hasCurrentMembership(db, contact_email, eventDate);
      } catch (err) {
        console.error("Membership lookup failed (allowing entry):", err);
        isMember = true;
      }
      if (!isMember && !renewalCoversEvent) {
        includeDayMembership = Boolean(day_membership);
      }
      if (!isMember && !renewalCoversEvent && !includeDayMembership) {
        return NextResponse.json(
          { error: "We couldn't find an annual club membership for this event season. Choose the $20 day membership for this event, join on the Members page, or contact the club if you believe this is a mistake." },
          { status: 403 }
        );
      }
    }

    // Load classes (with capacity) to build Square line items and enforce spot limits.
    // Filtered by event_id so a crafted request can't buy entries into another
    // event's classes at this event's fee.
    const classIds = [...new Set(entries.map((e) => e.class_id))];
    const { data: classes } = await db
      .from("classes")
      .select("id, num, name, capacity, status")
      .eq("event_id", event_id)
      .in("id", classIds);
    const classMap = Object.fromEntries((classes ?? []).map((c) => [c.id, c]));

    for (const classId of classIds) {
      const cls = classMap[classId];
      if (!cls) {
        return NextResponse.json(
          { error: "One of the selected classes doesn't belong to this event. Please refresh the page and try again." },
          { status: 400 }
        );
      }
      if (cls.status !== "upcoming") {
        return NextResponse.json(
          { error: `${classLabel(cls)} has already ${cls.status === "live" ? "started" : "run"} and can't take online entries.` },
          { status: 409 }
        );
      }
    }

    // Capacity check — reject if any requested class is full
    for (const classId of classIds) {
      const cls = classMap[classId];
      if (cls.capacity == null) continue; // no limit set
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

    const isClinic = event.event_type === "clinic";
    const normalEntries = entries.map((e) => ({
      class_id: e.class_id,
      back_number: e.back_number == null || e.back_number === "" ? null : parseInt(e.back_number, 10),
      horse_name: String(e.horse_name ?? "").trim(),
      exhibitor: String(e.exhibitor ?? "").trim(),
    }));

    if (!isClinic) {
      // The back number is the horse's permanent registry identity — a horse
      // can only enter a given class once, keyed by back number, not by name
      // (two unrelated horses can share a name; a back number can't).
      const seenBackNumbers = new Map();
      for (const entry of normalEntries) {
        const backKey = entry.back_number == null ? "" : `${entry.class_id}:${entry.back_number}`;
        if (backKey && seenBackNumbers.has(backKey)) {
          const cls = classMap[entry.class_id];
          return NextResponse.json(
            { error: `Back #${entry.back_number} (${entry.horse_name}) is entered twice for ${classLabel(cls)}. Please remove the duplicate entry.` },
            { status: 409 }
          );
        }
        if (backKey) seenBackNumbers.set(backKey, true);
      }

      const { data: existingEntries } = await db
        .from("entries")
        .select("class_id, back_number, horse, exhibitor")
        .in("class_id", classIds)
        .eq("scratched", false);

      for (const entry of normalEntries) {
        const match = (existingEntries ?? []).find((existing) =>
          existing.class_id === entry.class_id &&
          entry.back_number != null &&
          existing.back_number === entry.back_number
        );

        if (match) {
          const cls = classMap[entry.class_id];
          return NextResponse.json(
            { error: `Back #${entry.back_number} (${entry.horse_name}) is already entered in ${classLabel(cls)}. Please check the class list or contact the show secretary.` },
            { status: 409 }
          );
        }
      }

      // Back number is the horse's permanent registry identity — the name
      // submitted must match whatever's on file for that number so entries
      // can't be recorded against the wrong horse. Unregistered back numbers
      // (new horses not yet added to the registry) are allowed through.
      const backNumbers = [...new Set(normalEntries.map((e) => e.back_number).filter((n) => n != null))];
      if (backNumbers.length) {
        const { data: horses } = await db
          .from("horses")
          .select("back_number, name")
          .in("back_number", backNumbers);
        const horseByBackNumber = Object.fromEntries((horses ?? []).map((h) => [h.back_number, h.name]));

        for (const entry of normalEntries) {
          const registryName = horseByBackNumber[entry.back_number];
          if (registryName && normalizeName(registryName) !== normalizeName(entry.horse_name)) {
            return NextResponse.json(
              { error: `Back #${entry.back_number} is registered to "${registryName}" — please check the horse name or back number.` },
              { status: 409 }
            );
          }
        }
      }
    }

    const feePerClass = event.entry_fee_cents ?? 0;
    const dayMembershipCents = includeDayMembership ? DAY_MEMBERSHIP_CENTS : 0;
    const includeReplacementNumbers = Boolean(replacement_numbers);
    const replacementNumbersCents = includeReplacementNumbers ? REPLACEMENT_NUMBERS_CENTS : 0;
    // The registration total is event money only. A membership renewal is
    // tracked on its own club_members row (like any application from the
    // join page) — it just shares this checkout's Square order.
    const renewalCents = renewal ? (renewal.type.fee_cents ?? 0) : 0;
    const totalCents = normalEntries.length * feePerClass + dayMembershipCents + replacementNumbersCents;
    const chargeCents = totalCents + renewalCents;

    // Create the registration record (pending)
    const registrationRow = {
      event_id,
      contact_name: contact_name.trim(),
      contact_email: contact_email.trim(),
      total_cents: totalCents,
      status: "pending",
    };
    if (includeDayMembership) {
      registrationRow.day_membership = true;
      registrationRow.day_membership_cents = dayMembershipCents;
    }
    if (includeReplacementNumbers) {
      registrationRow.replacement_numbers = true;
      registrationRow.replacement_numbers_cents = replacementNumbersCents;
    }

    const { data: reg, error: regErr } = await db
      .from("registrations")
      .insert(registrationRow)
      .select()
      .single();
    if (regErr) {
      const msg = `${regErr.message ?? ""} ${regErr.details ?? ""}`.toLowerCase();
      if ((includeDayMembership && msg.includes("day_membership")) || (includeReplacementNumbers && msg.includes("replacement_numbers"))) {
        return NextResponse.json(
          { error: "Registration add-ons need the latest database update before they can be sold. Run schema-v29 and schema-v30." },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: regErr.message }, { status: 500 });
    }

    // Store the pending entries
    const { error: entErr } = await db.from("registration_entries").insert(
      normalEntries.map((e) => ({
        registration_id: reg.id,
        class_id: e.class_id,
        back_number: e.back_number,
        horse_name: e.horse_name,
        exhibitor: e.exhibitor,
      }))
    );
    if (entErr) return NextResponse.json({ error: entErr.message }, { status: 500 });

    // Create the renewal application now (status pending), copying the
    // details from their latest membership — the Square webhook finds it by
    // order id and marks it paid, exactly like an application from the join
    // page. Committee approval still happens on the Memberships page.
    let renewalMember = null;
    if (renewal) {
      const src = renewal.latest;
      const renewalRow = {
        season: renewal.season,
        membership_type_id: renewal.type.id,
        membership_type_name: renewal.type.name,
        member_name: src.member_name,
        email: src.email,
        phone: src.phone,
        address: src.address,
        aqha_member_number: src.aqha_member_number,
        other_memberships: src.other_memberships,
        emergency_contact_name: src.emergency_contact_name,
        emergency_contact_phone: src.emergency_contact_phone,
        interests: src.interests,
        status: "pending",
        total_cents: renewalCents,
      };
      if (renewal.type.included_people != null) {
        renewalRow.included_people = renewal.type.included_people;
      }
      const { data: createdMember, error: renewErr } = await db
        .from("club_members")
        .insert(renewalRow)
        .select()
        .single();
      if (renewErr) return NextResponse.json({ error: renewErr.message }, { status: 500 });
      renewalMember = createdMember;

      // Carry the people and horses on the membership across to the new
      // season so nothing needs re-typing in the portal. People are capped by
      // the new type ("people included" counts the applicant, who isn't a row).
      try {
        const peopleCap = Math.max(0, (renewal.type.included_people ?? 1) - 1);
        const [{ data: people }, { data: horses }] = await Promise.all([
          db.from("club_member_people")
            .select("name, person_type, sort_order")
            .eq("member_id", src.id)
            .order("sort_order"),
          db.from("club_member_horses")
            .select("horse_name, back_number, breed, registrations, notes")
            .eq("member_id", src.id),
        ]);
        const copyPeople = (people ?? []).slice(0, peopleCap).map((p) => ({ ...p, member_id: renewalMember.id }));
        if (copyPeople.length) await db.from("club_member_people").insert(copyPeople);
        const copyHorses = (horses ?? []).map((h) => ({ ...h, member_id: renewalMember.id }));
        if (copyHorses.length) await db.from("club_member_horses").insert(copyHorses);
      } catch (err) {
        console.error("Copying people/horses to renewal failed (renewal still created):", err);
      }
    }

    // Nothing to pay — approve straight away
    if (chargeCents === 0) {
      await approveRegistration(db, reg.id);
      if (renewalMember) await markMembershipPaid(db, renewalMember.id);
      return NextResponse.json({
        redirect: `/event/${event_id}/register/success?reg=${reg.id}`,
      });
    }

    // Paid entry — create a Square payment link (squarePayments.js picks the
    // OAuth connection when the club has linked Square, else the club's own
    // access token, and applies the developer fee when configured)
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");

    const lineItems = feePerClass > 0
      ? normalEntries.map((e) => {
          const cls = classMap[e.class_id];
          return {
            name: cls ? `Class ${cls.num}: ${cls.name}` : "Class entry",
            quantity: "1",
            base_price_money: { amount: feePerClass, currency: "AUD" },
            note: isClinic
              ? `${e.horse_name || "Participant"} (${e.exhibitor})`
              : `Back #${e.back_number} — ${e.horse_name} (${e.exhibitor})`,
          };
        })
      : [];
    if (includeDayMembership) {
      lineItems.push({
        name: "Day membership",
        quantity: "1",
        base_price_money: { amount: dayMembershipCents, currency: "AUD" },
        note: `One-event membership for ${contact_name.trim()}`,
      });
    }
    if (includeReplacementNumbers) {
      lineItems.push({
        name: "Replacement numbers",
        quantity: "1",
        base_price_money: { amount: replacementNumbersCents, currency: "AUD" },
        note: `Replacement numbers for ${contact_name.trim()}`,
      });
    }
    if (renewal && renewalCents > 0) {
      lineItems.push({
        name: `Membership renewal — ${renewal.type.name}`,
        quantity: "1",
        base_price_money: { amount: renewalCents, currency: "AUD" },
        note: `${renewal.season} season for ${renewal.latest.member_name}`,
      });
    }

    const squarePayload = {
      idempotency_key: randomUUID(),
      order: {
        location_id: process.env.SQUARE_LOCATION_ID,
        reference_id: reg.id,
        line_items: lineItems,
      },
      checkout_options: {
        redirect_url: `${baseUrl}/event/${event_id}/register/success?reg=${reg.id}`,
        ask_for_shipping_address: false,
      },
      pre_populated_data: { buyer_email: contact_email.trim() },
    };

    const { link, error: squareError, status: squareStatus } =
      await createSquarePaymentLink(db, squarePayload);

    if (squareError) {
      // Remove the renewal application we just created — it never got a
      // checkout, so leaving it would show a dead "finish payment" in the
      // portal and block the offer from appearing again.
      if (renewalMember) {
        await db
          .from("club_members")
          .delete()
          .eq("id", renewalMember.id)
          .eq("status", "pending");
      }
      return NextResponse.json({ error: squareError }, { status: squareStatus ?? 500 });
    }

    // Save the Square order ID so the webhook can find this registration
    await db
      .from("registrations")
      .update({ square_order_id: link?.order_id, square_checkout_url: link?.url })
      .eq("id", reg.id);

    // The renewal shares the same order — the webhook marks it paid by this
    // id, and the portal can reopen the checkout while it's still pending.
    if (renewalMember) {
      await db
        .from("club_members")
        .update({ square_order_id: link?.order_id, square_checkout_url: link?.url })
        .eq("id", renewalMember.id);
    }

    return NextResponse.json({ checkout_url: link?.url });
  } catch (err) {
    console.error("registration/create error:", err);
    return NextResponse.json(
      { error: err.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
