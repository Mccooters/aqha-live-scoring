import { createClient } from "@supabase/supabase-js";

export function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
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
    if (msg.includes("day_membership")) {
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
      reg = retry.data ? { ...retry.data, day_membership: false, day_membership_cents: 0 } : null;
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
  ` : "");

  const entriesText = entries
    .map((entry) => `- ${classLabel(entry)}: ${entryLabel(entry)}`)
    .join("\n");
  const dayMembershipText = hasDayMembership
    ? `- Day membership: One-event membership (${formatMoney(dayMembershipAmount)})`
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

export async function approveRegistration(db, registrationId) {
  // Claim the registration first: flip it to paid only if it isn't already.
  // Square retries webhooks, so this can be called twice for one payment —
  // only the call that wins this update goes on to create entries.
  const { data: claimed, error: claimErr } = await db
    .from("registrations")
    .update({ status: "paid" })
    .eq("id", registrationId)
    .neq("status", "paid")
    .select("id");
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed?.length) return; // another call already approved it

  const { data: regEntries, error: fetchErr } = await db
    .from("registration_entries")
    .select("*")
    .eq("registration_id", registrationId);
  if (fetchErr) {
    await db.from("registrations").update({ status: "pending" }).eq("id", registrationId);
    throw new Error(fetchErr.message);
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
