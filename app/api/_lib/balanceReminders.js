import { balanceOwingCents, balanceDueDate, balanceDueLabel } from "../../../lib/clinicPayments";

// Balance reminder emails (schema-v55). One place builds and sends the
// "you still owe $X for the clinic" email — used by the staff "Send
// reminder(s)" buttons and by the daily automatic run.

const formatMoney = (cents) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format((cents ?? 0) / 100);
const escapeHtml = (v) => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const missingColumn = (err) => /balance_reminder|schema cache/i.test(err?.message ?? "");
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

// Paid registrations on this event with money still owing on a deposit plan.
export async function owingRegistrations(db, eventId) {
  const { data, error } = await db
    .from("registrations")
    .select("*")
    .eq("event_id", eventId)
    .eq("status", "paid");
  if (error) throw new Error(error.message);
  return (data ?? []).filter((r) => balanceOwingCents(r) > 0);
}

// Send one reminder. Returns { sent: true } or { sent: false, reason }.
// Logs to the registration (best-effort on a pre-v55 database).
export async function sendBalanceReminder(db, reg, event, { method = "manual", by = null } = {}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.BOOKING_EMAIL_FROM;
  if (!apiKey || !from) return { sent: false, reason: "Email isn't configured (RESEND_API_KEY / BOOKING_EMAIL_FROM)." };
  if (!reg?.contact_email) return { sent: false, reason: "No email address on the registration." };
  const owing = balanceOwingCents(reg);
  if (owing <= 0) return { sent: false, reason: "Nothing owing." };

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  const payUrl = `${baseUrl}/event/${event.id}/register/success?reg=${reg.id}`;
  const due = balanceDueDate(event.starts_on);
  const dueLabel = balanceDueLabel(event.starts_on);
  const overdue = due ? new Date() > due : false;
  const when = event.starts_on
    ? new Date(`${event.starts_on}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "";
  const firstName = String(reg.contact_name ?? "").trim().split(/\s+/)[0] || "there";

  const subject = overdue
    ? `Overdue: ${formatMoney(owing)} balance for ${event.name}`
    : `Reminder: ${formatMoney(owing)} balance owing for ${event.name}`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#241A12">
      <h2 style="margin:0 0 8px">${escapeHtml(event.name)}</h2>
      <p style="margin:0 0 14px;color:#555">${escapeHtml(when)}${event.location ? ` · ${escapeHtml(event.location)}` : ""}</p>
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>This is a ${overdue ? "final" : "friendly"} reminder that your clinic balance of
        <strong>${escapeHtml(formatMoney(owing))}</strong> is still owing${reg.deposit_cents ? ` (deposit of ${escapeHtml(formatMoney(reg.deposit_cents))} received, thank you)` : ""}.
        ${dueLabel ? (overdue
          ? `Balances were due by <strong>${escapeHtml(dueLabel)}</strong>. Please contact the organiser to arrange payment.`
          : `Balances are due by <strong>${escapeHtml(dueLabel)}</strong>.`) : ""}
      </p>
      ${overdue ? "" : `
      <p style="margin:20px 0">
        <a href="${escapeHtml(payUrl)}" style="background:#3A2A1C;color:#F2EADB;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Pay the balance</a>
      </p>
      <p style="font-size:13px;color:#555">You can pay the full amount or part of it from that page. If you've already paid by bank transfer, please ignore this email — it can take a day or two to be recorded.</p>`}
      <p style="font-size:12px;color:#888;margin-top:24px">Hunter Coast Quarter Horse Association · HCQHA Live Scoring</p>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [reg.contact_email],
      ...(process.env.BOOKING_EMAIL_REPLY_TO ? { reply_to: process.env.BOOKING_EMAIL_REPLY_TO } : {}),
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { sent: false, reason: `Email service refused: ${text.slice(0, 200)}` };
  }

  const entry = { at: new Date().toISOString(), method, by, to: reg.contact_email, owing_cents: owing };
  const log = Array.isArray(reg.balance_reminder_log) ? reg.balance_reminder_log : [];
  const { error } = await db
    .from("registrations")
    .update({ balance_reminder_log: [...log, entry], balance_reminder_last_at: entry.at })
    .eq("id", reg.id);
  if (error && !missingColumn(error)) console.error("Reminder log failed:", error.message);
  return { sent: true, logged: !error };
}

// Daily automatic run: every clinic with reminder days set, when today is
// exactly one of those many days before it, emails everyone still owing —
// once per day at most (skips anyone already reminded today).
export async function runAutoReminders(db, now = new Date()) {
  const { data: events, error } = await db
    .from("events")
    .select("id, name, starts_on, location, balance_reminder_days")
    .not("balance_reminder_days", "is", null);
  if (error) {
    if (missingColumn(error)) return { skipped: "migration", sent: 0, events: [] };
    throw new Error(error.message);
  }
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  let sent = 0; const report = [];
  for (const ev of events ?? []) {
    const days = Array.isArray(ev.balance_reminder_days) ? ev.balance_reminder_days.map(Number) : [];
    if (!days.length || !ev.starts_on) continue;
    const start = new Date(`${ev.starts_on}T00:00:00`);
    const daysUntil = Math.round((start - today) / 86400000);
    if (!days.includes(daysUntil)) continue;
    const owing = await owingRegistrations(db, ev.id);
    let evSent = 0;
    for (const reg of owing) {
      if (reg.balance_reminder_last_at && dayKey(reg.balance_reminder_last_at) === dayKey(now)) continue;
      const r = await sendBalanceReminder(db, reg, ev, { method: "auto" });
      if (r.sent) { sent += 1; evSent += 1; }
    }
    report.push({ event: ev.name, days_until: daysUntil, sent: evSent, owing: owing.length });
  }
  return { sent, events: report };
}
