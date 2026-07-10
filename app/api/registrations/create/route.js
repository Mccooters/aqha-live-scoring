import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { adminClient, approveRegistration, expireStaleRegistrations } from "../../_lib/registrations";
import { membershipRequirement, hasMembershipForEvent, renewalOffer, markMembershipPaid } from "../../_lib/memberships";
import { getMemberAccount } from "../../_lib/memberAuth";
import { createSquarePaymentLink, deleteSquarePaymentLink } from "../../_lib/squarePayments";
import { signupSeason, currentSeason } from "../../../../lib/membershipSeason";

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
      annual_membership_type_id,
    } = await req.json();

    if (!event_id || !contact_name?.trim() || !contact_email?.trim() || !entries?.length) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const db = adminClient();

    // Load event to get the fees and entries status. select("*") so the
    // ground/admin fee columns (schema-v34) come through when that migration
    // has been run, and are simply absent (treated as $0) when it hasn't.
    const { data: event, error: evErr } = await db
      .from("events")
      .select("*")
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

    // Lazy housekeeping: cancel this event's abandoned checkouts (>48h
    // unpaid) whenever a new registration comes in. Never blocks the entry.
    try {
      await expireStaleRegistrations(db, { eventId: event_id });
    } catch (err) {
      console.error("Stale-registration sweep failed:", err);
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
    const eventSeason = currentSeason(eventDate);
    // A membership only covers the event when the event date falls in its
    // season — so a next-season membership does NOT cover the last event of
    // the outgoing season (which then needs a day membership).
    const renewalCoversEvent = renewal ? renewal.season === eventSeason : false;
    let includeDayMembership = false;
    let annualJoin = null; // { type, season } — full membership bought with this entry (also covers entry)
    if (requiresMembership) {
      let isMember = false;
      try {
        isMember = await hasMembershipForEvent(db, contact_email, eventDate);
      } catch (err) {
        console.error("Membership lookup failed (allowing entry):", err);
        isMember = true;
      }
      // Non-members can join the club as part of this checkout: the fee is
      // added to the same Square payment and a normal membership application
      // (paid → awaiting committee approval) is created, like the renewal flow.
      // The membership is for signupSeason() — the current season most of the
      // year, but NEXT season from July on. Joining always covers entry to
      // this event: either its season matches, or (at the last show of the
      // season) it carries over to next season AND covers this final event as
      // a joining perk. The club_members row is still for signupSeason.
      if (!isMember && !renewal && annual_membership_type_id) {
        const { data: type } = await db
          .from("membership_types")
          .select("*")
          .eq("id", annual_membership_type_id)
          .eq("active", true)
          .maybeSingle();
        if (!type) {
          return NextResponse.json(
            { error: "That membership type is no longer offered — please pick another, or choose the day membership." },
            { status: 400 }
          );
        }
        annualJoin = { type, season: signupSeason() };
      }
      const satisfiedByAnnual = Boolean(annualJoin);
      if (!isMember && !renewalCoversEvent && !satisfiedByAnnual) {
        includeDayMembership = Boolean(day_membership);
      }
      if (!isMember && !renewalCoversEvent && !satisfiedByAnnual && !includeDayMembership) {
        return NextResponse.json(
          { error: "We couldn't find a club membership covering this event. Add a day membership or an annual membership to your entry, join on the Members page, or contact the club if you believe this is a mistake." },
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
    // Association registration numbers (schema-v35): a list of {club, number}
    // pairs per entry, [] meaning "declared not registered", null meaning not
    // collected (clinics / older forms).
    const normalizeRegList = (value) => {
      if (!Array.isArray(value)) return null;
      return value
        .map((r) => ({
          club: String(r?.club ?? "").trim().slice(0, 40),
          number: String(r?.number ?? "").trim().slice(0, 60),
        }))
        .filter((r) => r.club && r.number)
        .slice(0, 8);
    };
    const normalEntries = entries.map((e) => ({
      class_id: e.class_id,
      back_number: e.back_number == null || e.back_number === "" ? null : parseInt(e.back_number, 10),
      horse_name: String(e.horse_name ?? "").trim(),
      exhibitor: String(e.exhibitor ?? "").trim(),
      rider_registrations: isClinic ? null : normalizeRegList(e.rider_registrations),
      horse_registrations: isClinic ? null : normalizeRegList(e.horse_registrations),
    }));

    if (!isClinic) {
      // Points are on the line at shows, so every entry must carry the
      // rider's and the horse's association registration numbers — or an
      // explicit "not registered with any association" (an empty list).
      for (let i = 0; i < normalEntries.length; i++) {
        const entry = normalEntries[i];
        const raw = entries[i];
        const riderProvided = Array.isArray(raw?.rider_registrations);
        const horseProvided = Array.isArray(raw?.horse_registrations);
        const riderDropped = riderProvided && raw.rider_registrations.length > 0 && entry.rider_registrations.length === 0;
        const horseDropped = horseProvided && raw.horse_registrations.length > 0 && entry.horse_registrations.length === 0;
        if (!riderProvided || !horseProvided || riderDropped || horseDropped) {
          return NextResponse.json(
            { error: `Please complete the association registration numbers for ${entry.horse_name || "each horse"} and its rider — or tick "not registered with any association". If the fields aren't showing, refresh the page and try again.` },
            { status: 400 }
          );
        }
      }
    }

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

      // New horses (no back number yet — one is assigned at payment) can't
      // be duplicate-checked by number, so check by name within a class.
      const seenNewHorses = new Map();
      for (const entry of normalEntries) {
        if (entry.back_number != null) continue;
        if (!entry.horse_name) {
          return NextResponse.json(
            { error: "Please give the horse's name so a back number can be assigned." },
            { status: 400 }
          );
        }
        const nameKey = `${entry.class_id}:${normalizeName(entry.horse_name)}`;
        if (seenNewHorses.has(nameKey)) {
          const cls = classMap[entry.class_id];
          return NextResponse.json(
            { error: `${entry.horse_name} is entered twice for ${classLabel(cls)}. Please remove the duplicate entry.` },
            { status: 409 }
          );
        }
        seenNewHorses.set(nameKey, true);
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

    // One-off ground/admin fees (schema-v34): charged the first time this
    // person pays for this event, and skipped when they come back to add more
    // entries. We match by email, and only skip if an earlier PAID
    // registration actually included the fees (so people who entered before
    // fees were added still pay them once). Any lookup failure charges the
    // fees — never undercharge silently.
    const groundFee = event.ground_fee_cents ?? 0;
    const adminFee = event.admin_fee_cents ?? 0;
    let feesCents = groundFee + adminFee;
    if (feesCents > 0) {
      const escapedEmail = contact_email.trim().replace(/([\\%_])/g, "\\$1");
      const { data: priorPaid, error: priorErr } = await db
        .from("registrations")
        .select("id")
        .eq("event_id", event_id)
        .eq("status", "paid")
        .gt("fees_cents", 0)
        .ilike("contact_email", escapedEmail)
        .limit(1);
      if (!priorErr && priorPaid?.length) feesCents = 0;
    }

    // The registration total is event money only. A membership renewal or a
    // new annual membership is tracked on its own club_members row (like any
    // application from the join page) — it just shares this checkout's
    // Square order.
    const renewalCents = renewal ? (renewal.type.fee_cents ?? 0) : 0;
    const annualCents = annualJoin ? (annualJoin.type.fee_cents ?? 0) : 0;
    const totalCents = normalEntries.length * feePerClass + dayMembershipCents + replacementNumbersCents + feesCents;
    const chargeCents = totalCents + renewalCents + annualCents;

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
    // The one-off fee portion of the total; only sent when charged so this
    // still works before the schema-v34 migration adds the column (fees
    // can't be non-zero there anyway).
    if (feesCents > 0) {
      registrationRow.fees_cents = feesCents;
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
      if (feesCents > 0 && msg.includes("fees_cents")) {
        return NextResponse.json(
          { error: "Ground/admin fees need the latest database update before they can be charged. Run schema-v34." },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: regErr.message }, { status: 500 });
    }

    // Store the pending entries (with their association registration
    // numbers; pre-v35 databases don't have those columns yet, so retry
    // without them rather than block the entry — nothing is enforced there
    // until the migration is run anyway).
    const entryRows = normalEntries.map((e) => ({
      registration_id: reg.id,
      class_id: e.class_id,
      back_number: e.back_number,
      horse_name: e.horse_name,
      exhibitor: e.exhibitor,
      rider_registrations: e.rider_registrations,
      horse_registrations: e.horse_registrations,
    }));
    let { error: entErr } = await db.from("registration_entries").insert(entryRows);
    if (entErr && `${entErr.message ?? ""}`.match(/rider_registrations|horse_registrations/)) {
      console.error("registration_entries is missing the registration-number columns (run schema-v35) — storing entries without them");
      ({ error: entErr } = await db.from("registration_entries").insert(
        entryRows.map(({ rider_registrations: _r, horse_registrations: _h, ...row }) => row)
      ));
    }
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

    // A new annual membership bought with this entry: create the application
    // now (status pending) from the entry's contact details — the Square
    // webhook finds it by order id and marks it paid, exactly like an
    // application from the join page. Committee approval happens as usual,
    // and the member can fill in the rest of their details (emergency
    // contact, horses, family) in the member portal.
    let annualMember = null;
    if (annualJoin) {
      const annualRow = {
        season: annualJoin.season,
        membership_type_id: annualJoin.type.id,
        membership_type_name: annualJoin.type.name,
        member_name: contact_name.trim(),
        email: contact_email.trim(),
        status: "pending",
        total_cents: annualCents,
      };
      if (annualJoin.type.included_people != null) {
        annualRow.included_people = annualJoin.type.included_people;
      }
      const { data: createdAnnual, error: annualErr } = await db
        .from("club_members")
        .insert(annualRow)
        .select()
        .single();
      if (annualErr) return NextResponse.json({ error: annualErr.message }, { status: 500 });
      annualMember = createdAnnual;
    }

    // Nothing to pay — approve straight away
    if (chargeCents === 0) {
      await approveRegistration(db, reg.id);
      if (renewalMember) await markMembershipPaid(db, renewalMember.id);
      if (annualMember) await markMembershipPaid(db, annualMember.id);
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
    // One-off fees appear as their own lines on the Square receipt
    if (feesCents > 0 && groundFee > 0) {
      lineItems.push({
        name: "Ground fee",
        quantity: "1",
        base_price_money: { amount: groundFee, currency: "AUD" },
        note: "Once per event",
      });
    }
    if (feesCents > 0 && adminFee > 0) {
      lineItems.push({
        name: "Admin fee",
        quantity: "1",
        base_price_money: { amount: adminFee, currency: "AUD" },
        note: "Once per event",
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
    if (annualJoin && annualCents > 0) {
      lineItems.push({
        name: `Club membership — ${annualJoin.type.name}`,
        quantity: "1",
        base_price_money: { amount: annualCents, currency: "AUD" },
        note: `${annualJoin.season} season for ${contact_name.trim()}`,
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
      // Remove the membership applications we just created — they never got
      // a checkout, so leaving them would show a dead "finish payment" in
      // the portal and block the offer from appearing again.
      if (renewalMember) {
        await db
          .from("club_members")
          .delete()
          .eq("id", renewalMember.id)
          .eq("status", "pending");
      }
      if (annualMember) {
        await db
          .from("club_members")
          .delete()
          .eq("id", annualMember.id)
          .eq("status", "pending");
      }
      return NextResponse.json({ error: squareError }, { status: squareStatus ?? 500 });
    }

    // Save the Square order ID so the webhook can match the payment back to
    // this registration. If this write fails, the webhook could never find the
    // registration — the customer would pay and get no entries. So on failure
    // we void the payment link (so it can't be paid) and error out BEFORE
    // sending them to checkout, rather than redirect into a broken payment.
    const { error: orderSaveErr } = await db
      .from("registrations")
      .update({ square_order_id: link?.order_id, square_checkout_url: link?.url })
      .eq("id", reg.id);
    if (orderSaveErr) {
      console.error("Could not store square_order_id — voiding the payment link:", orderSaveErr.message);
      try { await deleteSquarePaymentLink(db, link?.id); } catch (e) { console.error("Void link failed:", e.message); }
      if (renewalMember) await db.from("club_members").delete().eq("id", renewalMember.id).eq("status", "pending");
      if (annualMember) await db.from("club_members").delete().eq("id", annualMember.id).eq("status", "pending");
      return NextResponse.json(
        { error: "Something went wrong setting up payment. Please try again — you have not been charged." },
        { status: 500 }
      );
    }

    // The link id lets a later cancellation delete the checkout at Square.
    // Separate best-effort write: pre-v32 databases don't have the column,
    // and that must never break the payment that's about to happen.
    if (link?.id) {
      const { error: linkIdErr } = await db
        .from("registrations")
        .update({ square_payment_link_id: link.id })
        .eq("id", reg.id);
      if (linkIdErr) console.error("Could not store square_payment_link_id (run schema-v32):", linkIdErr.message);
    }

    // The renewal / new membership shares the same order — the webhook marks
    // it paid by this id, and the portal can reopen the checkout while it's
    // still pending.
    if (renewalMember) {
      await db
        .from("club_members")
        .update({ square_order_id: link?.order_id, square_checkout_url: link?.url })
        .eq("id", renewalMember.id);
    }
    if (annualMember) {
      await db
        .from("club_members")
        .update({ square_order_id: link?.order_id, square_checkout_url: link?.url })
        .eq("id", annualMember.id);
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
