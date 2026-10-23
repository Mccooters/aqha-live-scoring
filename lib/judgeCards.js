// Digital judge cards — the card families (schema-v63 stage 1 + v64 stage 2)
// and the arithmetic they share. Used by the judge's page (on the device,
// offline), the /api/judge route (which recomputes every score it is sent)
// and the coordinator dashboard (card picker + card viewer).
//
// Pattern cards follow the club's AQHA score sheets:
//   trail           Trail — up to 10 obstacles, obstacle score -1½ … +1½,
//                   penalties ½ / 1 / 3 / 5 under each obstacle, tie-breaker =
//                   the obstacles the judge numbered before the class.
//   western_riding  Western Riding — 12 manoeuvres, -1½ … +1½, penalties
//                   ½ / 1 / 3 / 5 (10 for the worst), ties broken on penalties.
//   ranch_riding    Ranch Riding — 12 manoeuvres, -1½ … +1½, penalties 1 / 3 / 5
//                   plus the 10-point column, "Off pattern" (placed below every
//                   horse that did the whole pattern), tie-breaker obstacles.
//   pattern3        Showmanship / Horsemanship / Hunt Seat Equitation — 10
//                   manoeuvres, -3 … +3 in halves, penalties 3 / 5 / 10,
//                   Form & Effectiveness 0–5 added, tie-breakers 1-2-3.
// Every pattern score starts at 70: 70 + manoeuvres (+ F&E) − penalties.
// A DQ / zero score is never placed (stored as -1 on the entry, like the
// dashboard's DQ).

export const BASE_SCORE = 70;

export const CARD_FAMILIES = {
  placings: { label: "Placings", short: "placings", kind: "placings" },
  scores: { label: "Scores (70-point)", short: "scores", kind: "scores" },
  trail: {
    label: "Trail", short: "trail", kind: "pattern", sheet: "Trail score sheet",
    boxNoun: "Obstacle", maxBoxes: 10, scale: 1.5, penalties: [0.5, 1, 3, 5], tiebreak: "boxes",
    boxScoreLabel: "Obstacle score",
  },
  western_riding: {
    label: "Western Riding", short: "western riding", kind: "pattern", sheet: "Western Riding score sheet",
    boxNoun: "Manoeuvre", maxBoxes: 12, scale: 1.5, penalties: [0.5, 1, 3, 5, 10], tiebreak: "penalties",
    boxScoreLabel: "Manoeuvre score",
  },
  ranch_riding: {
    label: "Ranch Riding", short: "ranch riding", kind: "pattern", sheet: "Ranch Riding score sheet",
    boxNoun: "Manoeuvre", maxBoxes: 12, scale: 1.5, penalties: [1, 3, 5, 10], tiebreak: "boxes", offPattern: true,
    boxScoreLabel: "Manoeuvre score",
  },
  pattern3: {
    label: "Showmanship / Horsemanship / Hunt Seat Eq", short: "pattern (±3)", kind: "pattern",
    sheet: "Showmanship · Hunt Seat Equitation · Horsemanship score sheet",
    boxNoun: "Manoeuvre", maxBoxes: 10, scale: 3, penalties: [3, 5, 10], tiebreak: "boxes", fe: true,
    boxScoreLabel: "Manoeuvre score",
  },
};

export const CARD_TYPE_ORDER = ["placings", "scores", "trail", "western_riding", "ranch_riding", "pattern3"];

export const isPatternType = (type) => CARD_FAMILIES[type]?.kind === "pattern";

// Which card a class gets when the coordinator leaves it on "Auto": the
// class name (and its program heading) names the discipline; anything else
// is a scores card on a 70-point class and a placings card otherwise.
export function suggestCardType(cls) {
  const n = `${cls?.name ?? ""} ${cls?.program_category ?? ""}`;
  if (/\btrail\b/i.test(n)) return "trail";
  if (/western\s*riding/i.test(n)) return "western_riding";
  if (/ranch\s*riding/i.test(n)) return "ranch_riding";
  if (/showmanship|horsemanship|hunt\s*seat\s*eq|equitation/i.test(n)) return "pattern3";
  return (cls?.scoring_mode ?? "score") === "score" ? "scores" : "placings";
}

export function cardTypeFor(cls) {
  const t = cls?.judge_card_type;
  if (t && t !== "auto" && CARD_FAMILIES[t]) return t;
  return suggestCardType(cls);
}

export const familyFor = (type) => CARD_FAMILIES[type] ?? CARD_FAMILIES.placings;

// The content-score chips for a family: -1½ … +1½ or -3 … +3, in halves.
export function contentValues(family) {
  const out = [];
  for (let v = -family.scale; v <= family.scale + 1e-9; v += 0.5) out.push(Math.round(v * 2) / 2);
  return out;
}

// ½ / 1½ / -½ / +1 — how the judges write them.
export function fmtHalf(v, { sign = false } = {}) {
  if (v == null || Number.isNaN(Number(v))) return "";
  const n = Number(v);
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs + 1e-9);
  const half = Math.abs(abs - whole - 0.5) < 1e-9;
  let s = half ? (whole ? `${whole}½` : "½") : String(whole);
  if (neg) s = `-${s}`;
  else if (sign && n > 0) s = `+${s}`;
  return s;
}

// The box layout a class uses: the judge's own layout on the card wins (they
// may have renamed an obstacle on the day), else what the coordinator or the
// other judge saved on the class, else blank boxes.
export function layoutFor(cls, family, cardLayout) {
  const max = family.maxBoxes ?? 10;
  const pick = (src) => {
    if (!src || typeof src !== "object" || !Array.isArray(src.boxes) || src.boxes.length === 0) return null;
    const boxes = src.boxes.slice(0, max).map((b) => String(b ?? "").slice(0, 40));
    const tiebreak = (Array.isArray(src.tiebreak) ? src.tiebreak : [])
      .map((i) => parseInt(i, 10)).filter((i) => Number.isInteger(i) && i >= 0 && i < boxes.length);
    return { boxes, tiebreak: Array.from(new Set(tiebreak)) };
  };
  return pick(cardLayout) ?? pick(cls?.judge_card_config) ?? { boxes: Array.from({ length: max }, () => ""), tiebreak: [] };
}

export const boxLabel = (family, layout, i) => `${i + 1}${layout.boxes[i] ? ` ${layout.boxes[i]}` : ""}`;

const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

// Clean one horse's pattern marks into the stored shape:
//   { boxes: [{ c: content|null, p: [penalties] }], fe, off_pattern, scored }
export function cleanPatternResult(r, family, boxCount) {
  const boxes = [];
  for (let i = 0; i < boxCount; i++) {
    const src = Array.isArray(r?.boxes) ? r.boxes[i] : null;
    let c = num(src?.c);
    if (c != null) c = Math.max(-family.scale, Math.min(family.scale, Math.round(c * 2) / 2));
    const p = (Array.isArray(src?.p) ? src.p : []).map(num).filter((x) => x != null && x > 0).slice(0, 12);
    boxes.push({ c, p });
  }
  let fe = family.fe ? num(r?.fe) : null;
  if (fe != null) fe = Math.max(0, Math.min(5, Math.round(fe)));
  const off_pattern = Boolean(family.offPattern && r?.off_pattern);
  const touched = boxes.some((b) => b.c != null || b.p.length) || fe != null || off_pattern;
  return { boxes, fe, off_pattern, scored: Boolean(r?.scored) || touched };
}

// 70 + content (+ F&E) − penalties. Unmarked boxes count as "0 correct".
export function patternTotals(r, family) {
  const boxes = Array.isArray(r?.boxes) ? r.boxes : [];
  let content = 0, penalties = 0;
  boxes.forEach((b) => {
    content += num(b?.c) ?? 0;
    (Array.isArray(b?.p) ? b.p : []).forEach((p) => { penalties += num(p) ?? 0; });
  });
  const fe = family.fe ? (num(r?.fe) ?? 0) : 0;
  const score = Math.round((BASE_SCORE + content + fe - penalties) * 2) / 2;
  return { content, penalties, fe, score };
}

// Has the judge actually marked this horse (so it has a score at all)?
export const patternScored = (r) => Boolean(r && (r.scored || (Array.isArray(r.boxes) && r.boxes.some((b) => b?.c != null || (b?.p ?? []).length)) || r.fe != null));

// Score of one box for tie-breaking: content less that box's penalties.
const boxScore = (r, i) => {
  const b = Array.isArray(r?.boxes) ? r.boxes[i] : null;
  return (num(b?.c) ?? 0) - (Array.isArray(b?.p) ? b.p : []).reduce((s, p) => s + (num(p) ?? 0), 0);
};

// Order two scored horses on a pattern card: higher score first; off-pattern
// below everyone; ties on the tie-breaker boxes in the judge's order (or on
// fewer penalties for Western Riding); then the judge's ▲▼ (tie_rank); then
// draw order. Returns <0 when a should place above b.
export function comparePattern(a, b, family, layout) {
  const ra = a.result, rb = b.result;
  if (family.offPattern && Boolean(ra.off_pattern) !== Boolean(rb.off_pattern)) return ra.off_pattern ? 1 : -1;
  const ta = patternTotals(ra, family), tb = patternTotals(rb, family);
  if (tb.score !== ta.score) return tb.score - ta.score;
  if (family.tiebreak === "penalties") {
    if (ta.penalties !== tb.penalties) return ta.penalties - tb.penalties;
  } else {
    for (const i of layout?.tiebreak ?? []) {
      const d = boxScore(rb, i) - boxScore(ra, i);
      if (d !== 0) return d;
    }
  }
  const ka = ra.tie_rank ?? Number.MAX_SAFE_INTEGER, kb = rb.tie_rank ?? Number.MAX_SAFE_INTEGER;
  if (ka !== kb) return ka - kb;
  return (a.draw_order ?? 0) - (b.draw_order ?? 0);
}

// True when two neighbouring horses are tied on everything but the judge's
// ▲▼ — the card shows "tie" and lets the judge order them.
export function patternTied(a, b, family, layout) {
  const probe = (x) => ({ ...x, result: { ...x.result, tie_rank: null }, draw_order: 0 });
  return comparePattern(probe(a), probe(b), family, layout) === 0;
}

export const CARD_TYPE_HINT = {
  placings: "The judge taps the horses in placing order (like the Judges Result Card).",
  scores: "One score per horse on the 70-point scale; placings follow the scores.",
  trail: "Obstacle boxes with a score of -1½ to +1½ and penalties under each, tie-breaker obstacles, running total from 70.",
  western_riding: "12 manoeuvre boxes, -1½ to +1½, penalties ½/1/3/5/10; ties broken on penalties.",
  ranch_riding: "12 manoeuvre boxes, -1½ to +1½, penalties 1/3/5/10, Off pattern and Zero score.",
  pattern3: "10 manoeuvre boxes, -3 to +3, penalties 3/5/10, Form & Effectiveness 0–5.",
};
