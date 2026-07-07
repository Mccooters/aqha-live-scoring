import { currentSeason, seasonLabel } from "../../../lib/membershipSeason";
import { escapeIlike } from "./memberAuth";

function formatMoney(cents) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format((cents ?? 0) / 100);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.BOOKING_EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn("Membership email skipped: RESEND_API_KEY or BOOKING_EMAIL_FROM is not configured.");
    return;
  }
  const body = { from, to: [to], subject, html, text };
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

async function sendApplicationReceivedEmail(member) {
  const hasPayment = (member.total_cents ?? 0) > 0;
  const subject = "Membership application received";
  const intro = hasPayment
    ? `We've received your payment of <strong>${escapeHtml(formatMoney(member.total_cents))}</strong> for your <strong>${escapeHtml(member.membership_type_name || "club membership")}</strong>.`
    : `We've received your application for <strong>${escapeHtml(member.membership_type_name || "club membership")}</strong>.`;
  const html = `
    <div style="font-family:Arial,sans-serif;color:#2f261d;line-height:1.45;">
      <h1 style="font-size:22px;margin:0 0 12px;">Application received</h1>
      <p>Hi ${escapeHtml(member.member_name)},</p>
      <p>${intro}</p>
      <p>Your membership for the <strong>${escapeHtml(seasonLabel(member.season))}</strong> is now with the committee for approval — we'll email you as soon as it's confirmed.</p>
      ${hasPayment ? `<p style="color:#6e6254;">Square sends the payment receipt separately.</p>` : ""}
    </div>
  `;
  const text = [
    "Application received",
    "",
    `Hi ${member.member_name},`,
    hasPayment
      ? `We've received your payment of ${formatMoney(member.total_cents)} for your ${member.membership_type_name || "club membership"}.`
      : `We've received your application for ${member.membership_type_name || "club membership"}.`,
    `Your membership for the ${seasonLabel(member.season)} is now with the committee for approval — we'll email you as soon as it's confirmed.`,
    hasPayment ? "Square sends the payment receipt separately." : null,
  ].filter((line) => line != null).join("\n");
  await sendEmail({ to: member.email, subject, html, text });
}

// The 6-digit code for signing in to the member portal (/account).
export async function sendLoginCodeEmail(email, code) {
  const subject = "Your sign-in code";
  const html = `
    <div style="font-family:Arial,sans-serif;color:#2f261d;line-height:1.45;">
      <h1 style="font-size:22px;margin:0 0 12px;">Sign in to the member portal</h1>
      <p>Hi, here's your code to sign in:</p>
      <p style="font-size:32px;letter-spacing:.25em;font-weight:700;margin:16px 0;">${escapeHtml(code)}</p>
      <p>It expires in 10 minutes.</p>
      <p style="color:#6e6254;">If you didn't request this, you can safely ignore this email — no one can sign in without the code.</p>
    </div>
  `;
  const text = [
    "Sign in to the member portal",
    "",
    "Hi, here's your code to sign in:",
    "",
    code,
    "",
    "It expires in 10 minutes.",
    "If you didn't request this, you can safely ignore this email — no one can sign in without the code.",
  ].join("\n");
  await sendEmail({ to: email, subject, html, text });
}

async function sendApprovedEmail(member) {
  const subject = "Welcome — your membership is approved";
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  const portalHtml = baseUrl
    ? `<p>You can view and update your details any time at <a href="${baseUrl}/account">${baseUrl}/account</a>.</p>`
    : "";
  const html = `
    <div style="font-family:Arial,sans-serif;color:#2f261d;line-height:1.45;">
      <h1 style="font-size:22px;margin:0 0 12px;">Membership approved</h1>
      <p>Hi ${escapeHtml(member.member_name)},</p>
      <p>Great news — your <strong>${escapeHtml(member.membership_type_name || "club membership")}</strong> for the <strong>${escapeHtml(seasonLabel(member.season))}</strong> has been approved. Welcome to the club!</p>
      <p>You can now enter our events online using this email address.</p>
      ${portalHtml}
    </div>
  `;
  const text = [
    "Membership approved",
    "",
    `Hi ${member.member_name},`,
    `Great news — your ${member.membership_type_name || "club membership"} for the ${seasonLabel(member.season)} has been approved. Welcome to the club!`,
    "You can now enter our events online using this email address.",
    baseUrl ? `You can view and update your details any time at ${baseUrl}/account.` : null,
  ].filter((line) => line != null).join("\n");
  await sendEmail({ to: member.email, subject, html, text });
}

// Move a membership from pending → paid (awaiting committee approval).
// Square retries webhooks, so this can run twice for one payment — the
// status guard makes only the first call send the email.
export async function markMembershipPaid(db, memberId) {
  const { data: claimed, error } = await db
    .from("club_members")
    .update({ status: "paid" })
    .eq("id", memberId)
    .eq("status", "pending")
    .select("*");
  if (error) throw new Error(error.message);
  if (!claimed?.length) return; // already handled

  try {
    await sendApplicationReceivedEmail(claimed[0]);
  } catch (err) {
    console.error("Membership received email failed:", err);
  }
}

// Staff approval: paid (or pending, for cash/manual cases) → approved.
export async function approveMembership(db, memberId) {
  const { data: approved, error } = await db
    .from("club_members")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", memberId)
    .neq("status", "approved")
    .select("*");
  if (error) throw new Error(error.message);
  if (!approved?.length) return; // already approved

  try {
    await sendApprovedEmail(approved[0]);
  } catch (err) {
    console.error("Membership approved email failed:", err);
  }
}

// Is there an approved annual membership for this email address in the season
// the event belongs to?
export async function hasCurrentMembership(db, email, date = new Date()) {
  // ilike gives case-insensitive matching; escapeIlike (shared with the
  // member portal's ownership rule) stops % or _ matching anything else.
  const cleaned = escapeIlike(String(email ?? "").trim());
  const season = currentSeason(date);
  const { data, error } = await db
    .from("club_members")
    .select("id")
    .eq("status", "approved")
    .eq("season", season)
    .ilike("email", cleaned)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

// Does event entry require a membership? Reads the coordinator's switch in
// site_settings. Fails open on any database error (e.g. the membership
// migration hasn't been run yet) so event registration is never blocked by
// a missing table — the switch simply hasn't been turned on in that case.
export async function membershipRequirement(db, event) {
  try {
    const { data } = await db
      .from("site_settings")
      .select("value")
      .eq("key", "membership_required")
      .maybeSingle();
    const value = data?.value ?? {};
    if (!value.enabled) return false;
    if (event?.event_type === "clinic" && !value.include_clinics) return false;
    return true;
  } catch (err) {
    console.error("membership_required check failed (allowing entry):", err);
    return false;
  }
}
