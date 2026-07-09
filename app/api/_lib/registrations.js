import { createClient } from "@supabase/supabase-js";
import { deleteSquarePaymentLink } from "./squarePayments";
import { assignHorseNumber } from "./horseNumbers";

export function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Unpaid registrations older than this are cancelled automatically.
export const REGISTRATION_EXPIRY_HOURS = 48;

// Cancel one pending registration: flip the status (atomically, so a payment
// racing in still wins) and delete its Square checkout link so it can't be
// paid afterwards. Returns false when it wasn't pending (already paid or
// cancelled). `reason` is 'staff' or 'expired'.
export async function cancelRegistration(db, registrationId, reason) {
  const patch = {
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    cancel_reason: reason,
  };
  let { data, error } = await db
    .from("registrations")
    .update(patch)
    .eq("id", registrationId)
    .eq("status", "pending")
    .select("id, square_payment_link_id");
  if (error) {
    // Before migration v32 the extra columns don't exist — cancel anyway.
    ({ data, error } = await db
      .from("registrations")
      .update({ status: "cancelled" })
      .eq("id", registrationId)
      .eq("status", "pending")
      .select("id"));
  }
  if (error) throw new Error(error.message);
  if (!data?.length) return false;

  const linkId = data[0].square_payment_link_id;
  if (linkId) {
    try {
      await deleteSquarePaymentLink(db, linkId);
    } catch (err) {
      // The registration is still cancelled; a payment on the surviving link
      // is honoured by the webhook (it revives non-paid registrations).
      console.error(`Could not delete Square link for registration ${registrationId}:`, err.message);
    }
  }
  return true;
}

// Auto-expiry sweep: cancel every pending registration older than 48 hours
// (optionally just one event's). Runs lazily — on new registrations and when
// staff open the Registrations page — so no scheduled job is needed, the
// same idiom as member session cleanup. Returns how many were cancelled.
export async function expireStaleRegistrations(db, { eventId } = {}) {
  const cutoff = new Date(Date.now() - REGISTRATION_EXPIRY_HOURS * 3600 * 1000).toISOString();
  let query = db
    .from("registrations")
    .select("id")
    .eq("status", "pending")
    .lt("created_at", cutoff);
  if (eventId) query = query.eq("event_id", eventId);
  const { data, error } = await query;
  if (error || !data?.length) return 0;

  let expired = 0;
  for (const row of data) {
    try {
      if (await cancelRegistration(db, row.id, "expired")) expired += 1;
    } catch (err) {
      console.error(`Auto-expiry failed for registration ${row.id}:`, err.message);
    }
  }
  return expired;
}

function formatMoney(cents) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format((cents ?? 0) / 100);
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function classLabel(entry) {
  const cls = entry.class;
  if (!cls) return "Class";
  return cls.num ? `Class ${cls.num}: ${cls.name}` : cls.name;
}

function entryLabel(entry) {
  const back = entry.back_number ? `Back #${entry.back_number} - ` : "";
  return `${back}${entry.horse_name || "Participant"} (${entry.exhibitor})`;
}

async function sendBookingConfirmation(db, registrationId) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.BOOKING_EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn("Booking confirmation email skipped: RESEND_API_KEY or BOOKING_EMAIL_FROM is not configured.");
    return;
  }

  let { data: reg, error } = await db
    .from("registrations")
    .select(`
      id,
      contact_name,
      contact_email,
      total_cents,
      day_membership,
      day_membership_cents,
      replacement_numbers,
      replacement_numbers_cents,
      event:events(name, starts_on, location),
      registration_entries(
        id,
        back_number,
        horse_name,
        exhibitor,
        class:classes(num, name)
      )
    `)
    .eq("id", registrationId)
    .single();
  if (error) {
    const msg = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
    if (msg.includes("day_membership") || msg.includes("replacement_numbers")) {
      const retry = await db
        .from("registrations")
        .select(`
          id,
          contact_name,
          contact_email,
          total_cents,
          event:events(name, starts_on, location),
          registration_entries(
            id,
            back_number,
            horse_name,
            exhibitor,
            class:classes(num, name)
          )
        `)
        .eq("id", registrationId)
        .single();
      reg = retry.data
        ? {
            ...retry.data,
            day_membership: false,
            day_membership_cents: 0,
            replacement_numbers: false,
            replacement_numbers_cents: 0,
          }
        : null;
      error = retry.error;
    }
  }

  if (error || !reg) throw new Error(error?.message ?? "Registration not found");

  const entries = reg.registration_entries ?? [];
  const eventName = reg.event?.name ?? "your event";
  const eventDate = formatDate(reg.event?.starts_on);
  const eventMeta = [eventDate, reg.event?.location].filter(Boolean).join(" - ");
  const subject = `Booking confirmation - ${eventName}`;
  const hasPayment = (reg.total_cents ?? 0) > 0;
  const hasDayMembership = !!reg.day_membership;
  const dayMembershipAmount = reg.day_membership_cents ?? 2000;
  const hasReplacementNumbers = !!reg.replacement_numbers;
  const replacementNumbersAmount = reg.replacement_numbers_cents ?? 500;

  const rowsHtml = entries.map((entry) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e6ded1;">${escapeHtml(classLabel(entry))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e6ded1;">${escapeHtml(entryLabel(entry))}</td>
    </tr>
  `).join("") + (hasDayMembership ? `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e6ded1;">Day membership</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e6ded1;">One-event membership (${escapeHtml(formatMoney(dayMembershipAmount))})</td>
    </tr>
  ` : "") + (hasReplacementNumbers ? `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e6ded1;">Replacement numbers</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e6ded1;">${escapeHtml(formatMoney(replacementNumbersAmount))}</td>
    </tr>
  ` : "");

  const entriesText = entries
    .map((entry) => `- ${classLabel(entry)}: ${entryLabel(entry)}`)
    .join("\n");
  const dayMembershipText = hasDayMembership
    ? `- Day membership: One-event membership (${formatMoney(dayMembershipAmount)})`
    : null;
  const replacementNumbersText = hasReplacementNumbers
    ? `- Replacement numbers: ${formatMoney(replacementNumbersAmount)}`
    : null;

  const html = `
    <div style="font-family:Arial,sans-serif;color:#2f261d;line-height:1.45;">
      <h1 style="font-size:22px;margin:0 0 12px;">Booking confirmed</h1>
      <p>Hi ${escapeHtml(reg.contact_name)},</p>
      <p>Your entries for <strong>${escapeHtml(eventName)}</strong> have been confirmed and added to the draw.</p>
      ${eventMeta ? `<p style="color:#6e6254;">${escapeHtml(eventMeta)}</p>` : ""}
      <table style="border-collapse:collapse;width:100%;max-width:680px;margin:18px 0;border:1px solid #e6ded1;">
        <thead>
          <tr>
            <th align="left" style="padding:8px 10px;background:#fbf8f2;border-bottom:1px solid #e6ded1;">Class</th>
            <th align="left" style="padding:8px 10px;background:#fbf8f2;border-bottom:1px solid #e6ded1;">Entry</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p>Total paid: <strong>${escapeHtml(formatMoney(reg.total_cents))}</strong></p>
      ${hasPayment ? `<p style="color:#6e6254;">Square sends the payment receipt separately.</p>` : ""}
    </div>
  `;

  const text = [
    `Booking confirmed - ${eventName}`,
    eventMeta,
    "",
    `Hi ${reg.contact_name},`,
    `Your entries have been confirmed and added to the draw.`,
    "",
    entriesText,
    dayMembershipText,
    replacementNumbersText,
    "",
    `Total paid: ${formatMoney(reg.total_cents)}`,
    hasPayment ? "Square sends the payment receipt separately." : null,
  ].filter((line) => line != null).join("\n");

  const body = {
    from,
    to: [reg.contact_email],
    subject,
    html,
    text,
  };
  if (process.env.BOOKING_EMAIL_REPLY_TO) {
    body.reply_to = process.env.BOOKING_EMAIL_REPLY_TO;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Resend email failed: ${detail}`);
  }
}

// "Lock in" a back number for a show horse entered without one: match the
// registry by name (reusing the existing number if the horse IS registered),
// otherwise take the next available number and register the horse
// permanently. The unique index on horses.back_number is the referee when
// two payments land at once — on a clash we bump and retry.
async function lockInNewHorseNumber(db, horseName, owner, reservedNumbers) {
  const { fields } = await assignHorseNumber(db, { horse_name: horseName }, null, reservedNumbers);
  let backNumber = fields.back_number;
  const alreadyRegistered = await (async () => {
    const { data } = await db
      .from("horses")
      .select("id")
      .eq("back_number", backNumber)
      .maybeSingle();
    return Boolean(data);
  })();
  if (alreadyRegistered) return { backNumber, horseName: fields.horse_name }; // matched an existing registry horse

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { error } = await db
      .from("horses")
      .insert({ back_number: backNumber, name: fields.horse_name, owner: owner || null });
    if (!error) return { backNumber, horseName: fields.horse_name };
    const msg = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
    if (msg.includes("23505") || msg.includes("duplicate")) {
      backNumber += 1; // someone claimed it between our check and insert
      continue;
    }
    if (msg.includes("42501") || msg.includes("permission denied")) {
      // schema-v33 not run — the entries still get the number, but the horse
      // couldn't be added to the registry, so the number isn't reserved.
      console.error("Could not register new horse (run schema-v33) — number assigned but not reserved:", fields.horse_name, backNumber);
      return { backNumber, horseName: fields.horse_name };
    }
    throw new Error(error.message);
  }
  throw new Error(`Could not reserve a back number for ${fields.horse_name}`);
}

export async function approveRegistration(db, registrationId) {
  // Claim the registration first: flip it to paid only if it isn't already.
  // Square retries webhooks, so this can be called twice for one payment —
  // only the call that wins this update goes on to create entries.
  const { data: claimed, error: claimErr } = await db
    .from("registrations")
    .update({ status: "paid" })
    .eq("id", registrationId)
    .neq("status", "paid")
    .select("id, event:events(event_type)");
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed?.length) return; // another call already approved it
  const isClinic = claimed[0]?.event?.event_type === "clinic";

  const { data: regEntries, error: fetchErr } = await db
    .from("registration_entries")
    .select("*")
    .eq("registration_id", registrationId);
  if (fetchErr) {
    await db.from("registrations").update({ status: "pending" }).eq("id", registrationId);
    throw new Error(fetchErr.message);
  }

  // Show entries submitted without a back number ("new horse" on the entry
  // form): assign now that payment is confirmed — one number per horse name
  // within the registration — and write it back to registration_entries so
  // the success page and booking email show it. Clinics keep their own
  // sequential numbering further down.
  if (!isClinic && regEntries?.some((e) => e.back_number == null)) {
    try {
      const assigned = {}; // normalized horse name → locked-in number
      const reserved = [];
      for (const entry of regEntries) {
        if (entry.back_number != null) continue;
        const nameKey = String(entry.horse_name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
        if (!assigned[nameKey]) {
          assigned[nameKey] = await lockInNewHorseNumber(db, entry.horse_name, entry.exhibitor, reserved);
          reserved.push(assigned[nameKey].backNumber);
        }
        entry.back_number = assigned[nameKey].backNumber;
        entry.horse_name = assigned[nameKey].horseName;
        await db
          .from("registration_entries")
          .update({ back_number: entry.back_number, horse_name: entry.horse_name })
          .eq("id", entry.id);
      }
    } catch (err) {
      // Money may already be taken — put the registration back so the
      // webhook retry or force-approve can finish the job.
      await db.from("registrations").update({ status: "pending" }).eq("id", registrationId);
      throw new Error(`Assigning back numbers failed: ${err.message}`);
    }
  }

  if (regEntries?.length) {
    // Get the current max draw_order for each class so new entries slot in at the end
    const classIds = [...new Set(regEntries.map((e) => e.class_id))];
    const maxDraws = {};

    for (const classId of classIds) {
      const { data: existing } = await db
        .from("entries")
        .select("draw_order")
        .eq("class_id", classId)
        .order("draw_order", { ascending: false })
        .limit(1);
      maxDraws[classId] = existing?.[0]?.draw_order ?? 0;
    }

    const entryRows = regEntries.map((e) => {
      maxDraws[e.class_id] = (maxDraws[e.class_id] ?? 0) + 1;
      return {
        class_id: e.class_id,
        back_number: e.back_number || maxDraws[e.class_id], // clinics: auto-assign sequential number
        horse: e.horse_name,
        exhibitor: e.exhibitor,
        draw_order: maxDraws[e.class_id],
      };
    });

    const { error: insertErr } = await db.from("entries").insert(entryRows);
    if (insertErr) {
      // Put the registration back to pending so the webhook retry or the
      // coordinator's force-approve button can try again.
      await db.from("registrations").update({ status: "pending" }).eq("id", registrationId);
      throw new Error(insertErr.message);
    }
  }

  try {
    await sendBookingConfirmation(db, registrationId);
  } catch (err) {
    console.error("Booking confirmation email failed:", err);
  }
}
