import { championshipQualifiers } from "../../../lib/championship";

// Server-side twin of the dashboard's fillChampionshipsFedBy (schema-v43):
// when a class completes from somewhere other than the dashboard (a judge's
// signed card, schema-v63), any championship it feeds still gets its
// qualifiers once every feeder is completed. Insert-only — manual adds and
// existing qualifiers are never touched; staff re-sync with "↻ Refresh
// qualifiers" on the dashboard after a correction. Never throws.
export async function fillChampionshipsFedBy(db, eventId, completedClassId) {
  try {
    const { data: fresh, error } = await db
      .from("classes")
      .select("*, entries(*)")
      .eq("event_id", eventId)
      .order("sort_order");
    if (error || !fresh) return;
    const champs = fresh.filter((c) =>
      Array.isArray(c.champ_feeder_ids) && c.champ_feeder_ids.includes(completedClassId) &&
      (c.status !== "completed" || !(c.entries ?? []).some((e) => e.score != null || e.score2 != null)));
    const byId = Object.fromEntries(fresh.map((c) => [c.id, c]));
    const visibleById = Object.fromEntries(fresh.filter((c) => !c.hidden).map((c) => [c.id, c]));
    for (const champ of champs) {
      const feeders = (champ.champ_feeder_ids ?? []).map((id) => byId[id]).filter(Boolean).filter((f) => !f.hidden);
      if (!feeders.length || !feeders.every((f) => f.status === "completed")) continue;
      const qualifiers = championshipQualifiers(champ, visibleById);
      const existing = champ.entries ?? [];
      const existingBacks = new Set(existing.map((e) => e.back_number));
      let maxDraw = Math.max(0, ...existing.map((e) => e.draw_order ?? 0));
      const toInsert = qualifiers
        .filter((q) => !existingBacks.has(q.back_number))
        .map((q) => ({ class_id: champ.id, back_number: q.back_number, horse: q.horse, exhibitor: q.exhibitor, draw_order: ++maxDraw }));
      if (toInsert.length) await db.from("entries").insert(toInsert);
    }
  } catch (err) {
    console.error("Championship auto-fill (judge card) failed:", err);
  }
}
