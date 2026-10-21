// Camping & yards (schema-v61): helpers shared by the entry form, the
// registration route, the staff pages and the booking email. An "extra" is
// anything bookable with an entry — a yard priced per DAY, a camping site
// priced per night (owner's rule, Oct 2026: "Yards are per day"), or
// something with one price for the whole event.

export const EXTRA_KINDS = { yard: "Yard", camping: "Camping", other: "Other" };
export const KIND_ICON = { yard: "🐴", camping: "🏕", other: "➕" };
// How an item is priced. Per-day and per-night items are both booked for
// particular dates; the dates live in the `nights` / `first_night` /
// `last_night` columns either way (named before yards went per day).
export const EXTRA_UNITS = { day: "Per day", night: "Per night", event: "One price for the event" };
export const MAX_NIGHTS = 14;      // longest run of days/nights one item can offer
export const MAX_QUANTITY = 20;    // most of one item in a single booking

export const isDated = (extra) => extra?.unit === "day" || extra?.unit === "night";

// "day" / "days" or "night" / "nights", for wording.
export function unitNoun(extra, n = 1) {
  const noun = extra?.unit === "day" ? "day" : "night";
  return n === 1 ? noun : `${noun}s`;
}

export function addDays(iso, n) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The dates a per-day or per-night item can be booked for:
// first_night..last_night, defaulting to the day BEFORE the event's first
// day (people arrive, and horses go into yards, the day before) through its
// last day.
export function extraNights(extra, event) {
  if (!extra || !isDated(extra)) return [];
  const start = extra.first_night || (event?.starts_on ? addDays(event.starts_on, -1) : null);
  const end = extra.last_night || event?.ends_on || event?.starts_on || start;
  if (!start || !end) return [];
  const out = [];
  let cur = String(start).slice(0, 10);
  const last = String(end).slice(0, 10);
  while (cur && cur <= last && out.length < MAX_NIGHTS) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

// "Fri 14 Nov" — built by hand so the server (emails, error messages) and
// every browser print exactly the same thing (toLocaleDateString adds a
// comma in some engines and not others).
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function nightLabel(iso) {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
}

export function extraAmountCents(extra, quantity, nights) {
  const q = Math.max(0, Math.floor(Number(quantity) || 0));
  const price = Math.max(0, Math.round(Number(extra?.price_cents) || 0));
  if (!q) return 0;
  return isDated(extra) ? price * q * (Array.isArray(nights) ? nights.length : 0) : price * q;
}

export function priceLabel(extra) {
  const cents = extra?.price_cents ?? 0;
  if (!(cents > 0)) return "free";
  const dollars = `$${(cents / 100).toFixed(2)}`;
  return isDated(extra) ? `${dollars} per ${unitNoun(extra)}` : `${dollars} for the event`;
}

// "Yard × 2 · Fri 14 Nov, Sat 15 Nov"
export function bookingSummary(extra, booking) {
  const nights = Array.isArray(booking?.nights) ? booking.nights : [];
  const parts = [`${extra?.name ?? "Extra"} × ${booking?.quantity ?? 1}`];
  if (isDated(extra) && nights.length) parts.push(nights.map(nightLabel).join(", "));
  return parts.join(" · ");
}
