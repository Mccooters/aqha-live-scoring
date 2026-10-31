// Sponsors (schema-v69) — shared by the staff Sponsors page and the public
// pages. The tiers mirror the club's sponsorship invitation letter; the
// `logo` size is how big that tier's logo is drawn on the website.
//
// A sponsor with no event_id belongs to the whole club: it shows on the home
// page and on every event. One tied to an event shows on that event's pages
// (and on the home page while the event is coming up or on now). Sponsored
// classes (class_ids) get "Proudly sponsored by …" wherever the class is
// listed — program, schedule, live scoring and results.

export const TIERS = [
  { key: "platinum", label: "Platinum", short: "Event title sponsor", logo: 180, rank: 0 },
  { key: "gold",     label: "Gold",     short: "Main ring sponsor",   logo: 130, rank: 1 },
  { key: "silver",   label: "Silver",   short: "Class / ribbon naming", logo: 100, rank: 2 },
  { key: "bronze",   label: "Bronze",   short: "Thank-you board",     logo: 72,  rank: 3 },
  { key: "class",    label: "Class / Ribbon", short: "Sponsored class", logo: 0, rank: 4 },
  { key: "in_kind",  label: "In-Kind",  short: "Products, vouchers, prizes", logo: 0, rank: 5 },
];

export const tierOf = (key) => TIERS.find((t) => t.key === key) ?? TIERS[3];
export const tierLabel = (key) => tierOf(key).label;

export const activeSponsors = (list) => (list ?? []).filter((s) => s && s.active !== false);

// Sponsors that belong on one event's pages: club-wide ones plus that event's own.
export const sponsorsForEvent = (list, eventId) =>
  activeSponsors(list).filter((s) => !s.event_id || s.event_id === eventId);

export const titleSponsors = (list) => (list ?? []).filter((s) => s.tier === "platinum");

export const classIdsOf = (s) => (Array.isArray(s?.class_ids) ? s.class_ids.map(String) : []);

// Every sponsor of a given class, by tier then staff order.
export const classSponsors = (list, classId) =>
  sortSponsors(activeSponsors(list).filter((s) => classIdsOf(s).includes(String(classId))));

export function sortSponsors(list) {
  return [...(list ?? [])].sort((a, b) =>
    tierOf(a.tier).rank - tierOf(b.tier).rank ||
    (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
    (a.name ?? "").localeCompare(b.name ?? ""));
}

export function groupByTier(list) {
  const out = TIERS.map((t) => ({ tier: t, sponsors: [] }));
  for (const s of sortSponsors(list)) out[tierOf(s.tier).rank].sponsors.push(s);
  return out.filter((g) => g.sponsors.length > 0);
}

export const joinNames = (list) => (list ?? []).map((s) => s.name).filter(Boolean).join(", ");

// "Proudly sponsored by Hunter Feeds" / "Proudly sponsored by A and B".
export function sponsoredByText(list) {
  const names = (list ?? []).map((s) => s.name).filter(Boolean);
  if (!names.length) return "";
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Proudly sponsored by ${joined}`;
}

// A pasted link without a scheme still has to open somewhere sensible.
export function normaliseUrl(u) {
  const s = (u ?? "").trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}
