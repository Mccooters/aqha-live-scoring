// Championship (Champ & Reserve / Grand Champion) helpers — schema-v43.
// A championship class is any class with a non-empty champ_feeder_ids list.
// It never takes normal entries: its draw is built from the 1st and 2nd
// place-getters (champ_take 'top2', default) or winners only ('top1') of its
// feeder classes. Shared between the coordinator dashboard (auto-fill and
// setup UI) and the public pages (Champion / Reserve labels).

import { isPlacingMode } from "./showPrint";

export function isChampionship(cls) {
  return Array.isArray(cls?.champ_feeder_ids) && cls.champ_feeder_ids.length > 0;
}

// Name-based hints, used only to suggest — staff always confirm.
// Championship tiers: Champ & Reserve → GRAND CHAMPION → SUPREME (the grand
// champions compete for Supreme, winners only).
export const looksLikeChampionship = (name) => /champ|supreme/i.test(String(name ?? ""));
export const looksLikeGrand = (name) => /grand/i.test(String(name ?? ""));
export const looksLikeSupreme = (name) => /supreme/i.test(String(name ?? ""));

// The qualifying entries from one completed feeder class. Placing-mode
// classes qualify the entries placed 1st/2nd; score-mode classes take the
// top scores. Two-judge classes keep each judge's placings separate (they
// are never combined), so BOTH judges' top place-getters qualify — the
// union, deduplicated. Scratched entries never qualify.
export function feederQualifiers(cls, take = "top2") {
  const limit = take === "top1" ? 1 : 2;
  const active = (cls?.entries ?? []).filter((e) => !e.scratched);
  const twoJudges = Boolean(cls?.judge2);

  if (isPlacingMode(cls)) {
    return active.filter((e) =>
      (e.score != null && e.score >= 1 && e.score <= limit) ||
      (twoJudges && e.score2 != null && e.score2 >= 1 && e.score2 <= limit)
    );
  }

  const topBy = (key) => active
    .filter((e) => e[key] != null)
    .sort((a, b) => b[key] - a[key])
    .slice(0, limit);
  const picked = [...topBy("score"), ...(twoJudges ? topBy("score2") : [])];
  const seen = new Set();
  return picked.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

// All qualifiers for a championship class, in feeder order then placing
// order, deduplicated by back number (a horse qualifies once even if it
// placed in several feeders).
export function championshipQualifiers(champCls, classesById) {
  const seen = new Set();
  const out = [];
  for (const feederId of champCls?.champ_feeder_ids ?? []) {
    const feeder = classesById[feederId];
    if (!feeder) continue;
    for (const entry of feederQualifiers(feeder, champCls.champ_take ?? "top2")) {
      if (seen.has(entry.back_number)) continue;
      seen.add(entry.back_number);
      out.push(entry);
    }
  }
  return out;
}

// Best-guess feeder classes for a championship, for staff to confirm:
// walk backwards through the same day's program from this class. A normal
// "Champ & Reserve" collects the ordinary classes above it until the
// previous championship-named class (its section boundary). A "GRAND
// CHAMPION" collects the championship classes above it until the previous
// grand champion. A "SUPREME" collects the GRAND CHAMPION classes above it
// until the previous supreme — the grand champions compete for Supreme.
export function suggestFeederIds(champLike, classes) {
  const day = champLike.day ?? 1;
  const order = (c) => c.sort_order ?? 0;
  const before = classes
    .filter((c) => (c.day ?? 1) === day && c.id !== champLike.id && order(c) < (champLike.sort_order ?? Infinity))
    .sort((a, b) => order(a) - order(b));
  const supreme = looksLikeSupreme(champLike.name);
  const grand = !supreme && looksLikeGrand(champLike.name);
  const out = [];
  for (let i = before.length - 1; i >= 0; i--) {
    const c = before[i];
    if (supreme) {
      if (looksLikeSupreme(c.name)) break;
      if (looksLikeGrand(c.name)) out.unshift(c.id);
    } else if (grand) {
      if (looksLikeGrand(c.name) || looksLikeSupreme(c.name)) break;
      if (looksLikeChampionship(c.name) || isChampionship(c)) out.unshift(c.id);
    } else {
      if (looksLikeChampionship(c.name) || isChampionship(c)) break;
      out.unshift(c.id);
    }
  }
  return out;
}
