export const fmtBack = (n) => String(n ?? "").padStart(3, "0");

export function ordinal(n) {
  if (n == null || n === "") return "";
  const value = Number(n);
  if (!Number.isFinite(value)) return String(n);
  const s = ["th", "st", "nd", "rd"];
  const v = value % 100;
  return value + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function isPlacingMode(cls) {
  const mode = cls?.scoring_mode ?? "score";
  return mode === "placing" || mode === "class_only" || mode === "tbc_class";
}

export function sortedEntries(cls) {
  return [...(cls?.entries ?? [])].sort((a, b) => (a.draw_order ?? 0) - (b.draw_order ?? 0));
}

export function activeEntries(cls) {
  return sortedEntries(cls).filter((entry) => !entry.scratched);
}

// A judge's disqualification is stored as a score of -1 (staff type "DQ").
// It reads as DQ everywhere, always ranks below every real result, and never
// earns points.
export const DQ_SCORE = -1;
export const isDq = (v) => v === DQ_SCORE;

// Sort value for a score: DQ ranks after everything in both modes.
export function scoreRank(v, placingMode, fallback) {
  if (v == null) return fallback;
  if (isDq(v)) return placingMode ? 9e9 : -9e9;
  return v;
}

// An entry counts as placed when EITHER judge has given it a result — judge
// 2 may place a horse judge 1 left out (a Reserve from one card only), and
// that horse belongs in the results, not back in the pending draw.
export const hasResult = (entry) => entry?.score != null || entry?.score2 != null;

// Results order: judge 1's result first (a horse judge 1 didn't place sorts
// after every placed one but ahead of a DQ), then judge 2's as tie-break.
export function resultOrder(cls) {
  const placingMode = isPlacingMode(cls);
  const j1Missing = placingMode ? 8e9 : -8e9;
  return (a, b) => {
    const primary = placingMode
      ? scoreRank(a.score, true, j1Missing) - scoreRank(b.score, true, j1Missing)
      : scoreRank(b.score, false, j1Missing) - scoreRank(a.score, false, j1Missing);
    if (primary !== 0) return primary;
    return placingMode
      ? scoreRank(a.score2, true, 99) - scoreRank(b.score2, true, 99)
      : scoreRank(b.score2, false, 0) - scoreRank(a.score2, false, 0);
  };
}

export function resultEntries(cls) {
  return activeEntries(cls).filter(hasResult).sort(resultOrder(cls));
}

export function scoreText(entry, cls) {
  if (!hasResult(entry)) return "";
  const placing = isPlacingMode(cls);
  const one = (v) => (v == null ? "?" : isDq(v) ? "DQ" : placing ? ordinal(v) : String(v));
  return cls?.judge2 && (entry.score2 != null || entry.score == null)
    ? `${one(entry.score)} / ${one(entry.score2)}`
    : one(entry.score);
}

export function drawIsPublished(event) {
  return ["closed", "live", "completed", "archived"].includes(event?.status);
}

export function dateRange(event) {
  if (!event?.starts_on) return "";
  if (event.ends_on && event.ends_on !== event.starts_on) return `${event.starts_on} - ${event.ends_on}`;
  return event.starts_on;
}

export function dayDate(event, day) {
  if (!event?.starts_on) return "";
  try {
    const d = new Date(`${event.starts_on}T00:00:00`);
    d.setDate(d.getDate() + Number(day) - 1);
    return d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
  } catch {
    return "";
  }
}

export const HCQHA_RULES = [
  "All horses competing in official classes must be registered with the appropriate breed association.",
  "Competitors that are not members of AQHA must become a temporary day member.",
  "Competitors compete at their own risk.",
  "Only competitors and officials permitted in the show ring while in progress.",
  "Show manager can make changes to the program and order of classes.",
  "The show manager and judge have the right to disqualify exhibitors from competition.",
  "If horses are unsound the judge or show manager have the right to disqualify competitors from competition.",
  "Competitors disqualified will forfeit entry fees.",
  "No smoking or alcohol is permitted in marshalling area or show ring.",
  "Youth competitors must be accompanied by a guardian.",
  "Youth ridden age group classes will be run concurrently but judged separately.",
  "No refunds of entry fees unless a vet certificate is supplied.",
  "No competitor can enter a class without prior payment.",
  "Results will not be forwarded to breed society, and competitors will be ineligible for high points if entering classes without class payment.",
];

export const BEGINNER_RULES = [
  "Must not have won any performance event at A, AA, State or National shows.",
  "Must not have won a high point beginner award.",
  "Cannot compete on colts or stallions.",
  "All beginner classes will be walk/jog or walk/trot.",
];
