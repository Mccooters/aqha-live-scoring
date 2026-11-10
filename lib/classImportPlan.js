// Class-list import planner (owner's report, Nov 2026: "it is difficult to
// see the changes it is making to the current program, need to ensure people
// that have already booked classes keep those classes").
//
// Pure functions, no database: the import modal fetches the event's classes
// and booking counts, then this works out — BEFORE anything is written —
// which rows add a class, which change an existing class (field by field),
// which existing classes the new sheet leaves out, and the final running
// order. Nothing is ever deleted: bookings (entries and pending online
// registrations) belong to a class id, so a class that is updated or left
// out keeps every booking. The one way a booking could be stranded is a
// class RENAMED in the sheet — it no longer matches, so a new class would be
// created beside the booked original. The planner suggests the link when a
// new row has the same class number as an unmatched class with a similar
// name, and staff can link any new row to any unmatched class by hand.

import { normaliseBreakLabel, normaliseCategoryLabel } from "./classCategories";

const lc = (s) => String(s ?? "").trim().toLowerCase();

export function classIdentityKey(cls) {
  return `${normaliseCategoryLabel(cls.program_category).toLowerCase()}::${lc(cls.name)}`;
}

function uniqueMap(rows, keyFn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    if (!key) return;
    map.set(key, map.has(key) ? null : row);
  });
  return map;
}

const words = (s) => new Set(lc(s).replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean));

// 0..1 — share of words two class names have in common.
export function nameSimilarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  A.forEach((w) => { if (B.has(w)) both += 1; });
  return both / (A.size + B.size - both);
}

// Which existing class each sheet row is (id or null). Same rules the import
// has always used — number + name, else category + name, else name when the
// row has no number — except that one existing class can only be claimed
// once (a second row with the same name becomes a new class).
export function autoMatch(rows, existing) {
  const byNumName = uniqueMap(existing, (c) => (c.num == null ? "" : `${c.num}::${lc(c.name)}`));
  const byIdentity = uniqueMap(existing, classIdentityKey);
  const byName = uniqueMap(existing, (c) => lc(c.name));
  const claimed = new Set();
  return rows.map((r) => {
    const cands = [
      r.num == null ? null : byNumName.get(`${r.num}::${lc(r.name)}`),
      byIdentity.get(classIdentityKey(r)),
      r.num == null ? byName.get(lc(r.name)) : null,
    ];
    const hit = cands.find((c) => c && !claimed.has(c.id));
    if (!hit) return null;
    claimed.add(hit.id);
    return hit.id;
  });
}

// For rows auto-match left new: the unmatched existing class with the same
// number, when the names look alike (a likely rename). { rowIndex: id }.
export function suggestLinks(rows, existing, matchIds) {
  const used = new Set(matchIds.filter(Boolean));
  const out = {};
  rows.forEach((r, i) => {
    if (matchIds[i] || r.num == null) return;
    const same = existing.filter((c) => !used.has(c.id) && c.num === r.num);
    const best = same
      .map((c) => ({ c, s: nameSimilarity(c.name, r.name) }))
      .sort((a, b) => b.s - a.s)[0];
    if (best && best.s >= 0.4) {
      out[i] = best.c.id;
      used.add(best.c.id);
    }
  });
  return out;
}

const MODE_LABEL = { score: "Score", placing: "Placing", class_only: "Class only", tbc: "TBC (draw)", tbc_class: "TBC (whole class)" };
const show = (v) => (v == null || v === "" ? "—" : String(v));

// What the sheet row would change on an existing class, field by field.
// `cls` carries booked (entries + pending online bookings) and hasResults.
export function changesFor(row, cls) {
  const patch = {};
  const changes = [];
  const notes = [];
  const set = (field, label, to, fmt = show) => {
    const from = cls[field] ?? null;
    const norm = (v) => (v === "" || v === undefined ? null : v);
    if (norm(from) === norm(to)) return;
    patch[field] = to;
    changes.push({ field, label, from: fmt(from), to: fmt(to) });
  };
  if (row.renamed) set("name", "Name", row.name);
  if (row.num != null) set("num", "Class number", row.num);
  if (row.hasModeCol) {
    if ((cls.status && cls.status !== "upcoming") || cls.hasResults) {
      if ((cls.scoring_mode ?? "score") !== row.scoring_mode) {
        notes.push(`Type kept as ${MODE_LABEL[cls.scoring_mode] ?? cls.scoring_mode} — this class already has results, so the sheet's "${MODE_LABEL[row.scoring_mode] ?? row.scoring_mode}" was not applied.`);
      }
    } else {
      set("scoring_mode", "Type", row.scoring_mode, (v) => MODE_LABEL[v] ?? show(v));
    }
  }
  if (row.hasJudgeCol) set("judge", "Judge 1", row.judge || "");
  if (row.hasJudge2Col) set("judge2", "Judge 2", row.judge2 || null);
  if (row.hasCategoryCol) set("program_category", "Section heading", normaliseCategoryLabel(row.program_category) || null);
  if (row.hasBreakCol) set("program_break_before", "Break before", normaliseBreakLabel(row.program_break_before) || null);
  if (row.hasBreakAfterCol) set("program_break_after", "Break after", normaliseBreakLabel(row.program_break_after) || null);
  if (row.hp_category !== null && row.hp_category !== undefined) set("hp_category", "HP category", row.hp_category);
  if (row.hasDayCol) set("day", "Day", row.day || 1);
  if (row.hasCapacityCol) {
    set("capacity", "Spots", row.capacity, (v) => (v == null ? "no limit" : String(v)));
    if (row.capacity != null && (cls.booked ?? 0) > row.capacity) {
      notes.push(`Only ${row.capacity} spots, but ${cls.booked} already booked — nobody loses their place; the class just stops taking new bookings.`);
    }
  }
  if (row.hasPatternCol) set("pattern_url", "Pattern", row.pattern_url, (v) => (v ? "file link" : "—"));
  return { patch, changes, notes };
}

// The running order after the import: the sheet's rows in order, with each
// existing class the sheet leaves out kept right after the class it used to
// follow (so it stays where it was rather than jumping to the top or end).
export function finalOrder(rows, links, existing) {
  const order = rows.map((_, i) => ({ kind: "row", i }));
  const linked = new Set(links.filter(Boolean));
  const old = [...existing].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.num ?? 0) - (b.num ?? 0));
  const rowOf = new Map();
  links.forEach((id, i) => { if (id) rowOf.set(id, i); });
  let lastPos = -1; // position in `order` of the latest matched/kept class seen in the old order
  for (const c of old) {
    if (linked.has(c.id)) {
      lastPos = order.findIndex((o) => o.kind === "row" && o.i === rowOf.get(c.id));
      continue;
    }
    order.splice(lastPos + 1, 0, { kind: "keep", id: c.id });
    lastPos += 1;
  }
  return order;
}

// The whole plan. `links[i]` = existing class id row i updates (or null =
// add as new). Returns lists for the preview and the writes to make.
export function buildPlan(rows, existing, links) {
  const byId = new Map(existing.map((c) => [c.id, c]));
  const order = finalOrder(rows, links, existing);
  const sortFor = new Map(); // "row:i" | "keep:id" → sort_order
  order.forEach((o, k) => sortFor.set(o.kind === "row" ? `row:${o.i}` : `keep:${o.id}`, k + 1));

  const added = [], updated = [], unchanged = [], kept = [];
  const writes = { inserts: [], updates: [] };
  let moved = 0;

  rows.forEach((r, i) => {
    const sort_order = sortFor.get(`row:${i}`);
    const cls = links[i] ? byId.get(links[i]) : null;
    if (!cls) {
      added.push({ i, row: r });
      writes.inserts.push({ i, sort_order });
      return;
    }
    const renamed = lc(cls.name) !== lc(r.name);
    const { patch, changes, notes } = changesFor({ ...r, renamed }, cls);
    if ((cls.sort_order ?? null) !== sort_order) { patch.sort_order = sort_order; moved += 1; }
    const item = { i, row: r, cls, changes, notes };
    if (changes.length || notes.length) updated.push(item); else unchanged.push(item);
    if (Object.keys(patch).length) writes.updates.push({ id: cls.id, patch });
  });

  existing.forEach((c) => {
    if (links.includes(c.id)) return;
    kept.push(c);
    const sort_order = sortFor.get(`keep:${c.id}`);
    if ((c.sort_order ?? null) !== sort_order) { writes.updates.push({ id: c.id, patch: { sort_order } }); moved += 1; }
  });

  // Two classes ending up with the same number confuse the program and the
  // entry form — flag them.
  const nums = new Map();
  const note = (num, label) => { if (num == null) return; (nums.get(num) ?? nums.set(num, []).get(num)).push(label); };
  rows.forEach((r, i) => note(links[i] ? (r.num ?? byId.get(links[i]).num) : r.num, r.name));
  kept.forEach((c) => note(c.num, c.name));
  const duplicateNumbers = [...nums.entries()].filter(([, names]) => names.length > 1).map(([num, names]) => ({ num, names }));

  const bookedClasses = existing.filter((c) => (c.booked ?? 0) > 0);
  return { added, updated, unchanged, kept, moved, writes, duplicateNumbers, bookedClasses, order };
}
