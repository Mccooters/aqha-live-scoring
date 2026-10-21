// Camping & yards (schema-v61): helpers shared by the entry form, the
// registration route, the staff pages and the booking email. An "extra" is
// anything bookable with an entry — a yard or a camping site priced per
// night, or something with one price for the whole event.

export const EXTRA_KINDS = { yard: "Yard", camping: "Camping", other: "Other" };
export const KIND_ICON = { yard: "🐴", camping: "🏕", other: "➕" };
export const MAX_NIGHTS = 14;      // longest run of nights one item can offer
export const MAX_QUANTITY = 20;    // most of one item in a single booking

export function addDays(iso, n) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The nights a per-night item can be booked for: first_night..last_night,
// defaulting to the night BEFORE the event's first day (people arrive the
// day before) through the night of its last day.
export function extraNights(extra, event) {
  if (!extra || extra.unit !== "night") return [];
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
  return extra?.unit === "night" ? price * q * (Array.isArray(nights) ? nights.length : 0) : price * q;
}

export function priceLabel(extra) {
  const cents = extra?.price_cents ?? 0;
  if (!(cents > 0)) return "free";
  const dollars = `$${(cents / 100).toFixed(2)}`;
  return extra?.unit === "night" ? `${dollars} per night` : `${dollars} for the event`;
}

// "Yard × 2 · Fri 14 Nov, Sat 15 Nov"
export function bookingSummary(extra, booking) {
  const nights = Array.isArray(booking?.nights) ? booking.nights : [];
  const parts = [`${extra?.name ?? "Extra"} × ${booking?.quantity ?? 1}`];
  if (extra?.unit === "night" && nights.length) parts.push(nights.map(nightLabel).join(", "));
  return parts.join(" · ");
}
