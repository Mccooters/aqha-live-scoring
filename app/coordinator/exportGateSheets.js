// Official scoring export — replicates the secretary's manual workbook
// (e.g. "HCQHA Spring Classic Nov 025.xlsx"): one "gate sheet" per judge,
// every class in program order, placed rows (1/2/3 or CHAMP/RESERVE) with
// horse number, association numbers, owner and rider details, colour-coded
// by breed registration. Uses the vendored xlsx-js-style build because the
// standard SheetJS community build cannot write cell fills.
import { supabase } from "../../lib/supabaseClient";
import { isChampionship } from "../../lib/championship";

const FILLS = {
  appaloosa: "F1A983", // orange
  dual: "83CAEB", // blue — registered Paint AND Quarter Horse
  paint: "FF99CC", // pink
  unregistered: "95DCF7", // light blue — no registrations recorded
};

const clubKind = (club) => {
  const k = String(club ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (k === "AQHA") return "qh";
  if (k === "PHAA" || k === "APHA") return "paint";
  if (k === "AAA" || k === "APHCA") return "appaloosa";
  return "other";
};

// Row colour per the legend: QH plain, Appaloosa orange, Paint pink,
// dual Paint/QH blue, nothing recorded light blue.
function rowFillFor(regs) {
  const kinds = new Set((regs ?? []).map((r) => clubKind(r.club)));
  if (!kinds.size) return FILLS.unregistered;
  if (kinds.has("qh") && kinds.has("paint")) return FILLS.dual;
  if (kinds.has("appaloosa")) return FILLS.appaloosa;
  if (kinds.has("paint")) return FILLS.paint;
  return null; // Quarter Horse (or unknown club) = plain white
}

const fmtDateLong = (iso) => {
  if (!iso) return "";
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  } catch { return iso; }
};

export async function exportGateSheets(event, classes) {
  const mod = await import("../../lib/vendor/xlsx-js-style.min.js");
  const XLSX = mod.default ?? mod;

  const showClasses = classes.filter((c) => !c.hidden);

  // Registry lookups: horse owner + association numbers by back number, and
  // member numbers by person name (used for both rider and owner columns).
  const backs = [...new Set(showClasses.flatMap((c) => c.entries.map((e) => e.back_number)).filter((b) => b != null))];
  const horsesPromise = backs.length
    ? supabase.from("horses").select("back_number, owner, horse_registrations(club, registration_number)").in("back_number", backs)
    : Promise.resolve({ data: [] });
  // Riders with their association numbers (schema-v46); pre-migration
  // databases fall back to the legacy single member number.
  let ridersRes = await supabase.from("riders").select("name, member_number, rider_registrations(club, registration_number)");
  if (ridersRes.error) {
    ridersRes = await supabase.from("riders").select("name, member_number");
  }
  const { data: horses } = await horsesPromise;
  const riders = ridersRes.data ?? [];
  const horseMap = Object.fromEntries((horses ?? []).map((h) => [h.back_number, h]));

  // Second source for rider numbers: what exhibitors typed on their online
  // entries for THIS event (schema-v35) — covers everyone from before the
  // registry started filling itself (schema-v46). Staff-only table; this
  // export runs signed in.
  const declaredByName = {};
  try {
    const { data: regEntries } = await supabase
      .from("registration_entries")
      .select("exhibitor, rider_registrations, registrations!inner(event_id, status)")
      .eq("registrations.event_id", event.id)
      .eq("registrations.status", "paid");
    for (const e of regEntries ?? []) {
      const key = String(e.exhibitor ?? "").trim().toLowerCase();
      if (!key || !Array.isArray(e.rider_registrations) || !e.rider_registrations.length) continue;
      if (!declaredByName[key]) declaredByName[key] = e.rider_registrations;
    }
  } catch {}

  const riderNo = (name) => {
    const key = String(name ?? "").trim().toLowerCase();
    if (!key) return "";
    const r = riders.find((x) => String(x.name ?? "").trim().toLowerCase() === key);
    const regs = (r?.rider_registrations ?? []).filter((x) => x.registration_number);
    if (regs.length) {
      return regs.map((x) => `${x.club} ${x.registration_number}`).join("  ");
    }
    const declared = (declaredByName[key] ?? []).filter((x) => x.number);
    if (declared.length) {
      return declared.map((x) => `${x.club} ${x.number}`).join("  ");
    }
    return r?.member_number ?? "";
  };

  const judgeName = (slot) => {
    const names = showClasses.map((c) => (slot === 1 ? c.judge : c.judge2)).filter(Boolean);
    return names[0] ?? "";
  };
  const hasJ2 = showClasses.some((c) => c.judge2);

  const buildSheet = (slot) => {
    const key = slot === 1 ? "score" : "score2";
    const name = judgeName(slot);
    const aoa = [];
    const fills = []; // { r, c0, c1, rgb } to apply after sheet creation
    const bolds = []; // row indexes to bold

    aoa.push([null, event.name, null, null, "Quarter Horse", "Appaloosa"]);
    aoa.push([null, fmtDateLong(event.starts_on), null, null, "Dual Paint/Quarter Horse", "Unregistered"]);
    aoa.push([null, `Judge : ${name}`, null, null, "Paint/Paint Bred"]);
    aoa.push([]);
    aoa.push([`J${slot} - ${name}`, "Class", "Class Name", "Horse No.", "Horse Name", "Association No.", "Horse owner", "Horse owner no.", "Rider Name", "Rider Number"]);
    bolds.push(0, 1, 2, 4);
    fills.push({ r: 0, c0: 5, c1: 5, rgb: FILLS.appaloosa });
    fills.push({ r: 1, c0: 4, c1: 4, rgb: FILLS.dual });
    fills.push({ r: 1, c0: 5, c1: 5, rgb: FILLS.unregistered });
    fills.push({ r: 2, c0: 4, c1: 4, rgb: FILLS.paint });

    const pushResultRow = (label, cls, e) => {
      const h = horseMap[e.back_number];
      const regs = h?.horse_registrations ?? [];
      const assoc = regs.map((r) => `${r.club}${r.registration_number ? ` ${r.registration_number}` : ""}`).join("  ");
      aoa.push([
        label, cls.num, cls.name, e.back_number, e.horse, assoc,
        h?.owner ?? "", riderNo(h?.owner), e.exhibitor, riderNo(e.exhibitor),
      ]);
      const rgb = rowFillFor(regs);
      if (rgb) fills.push({ r: aoa.length - 1, c0: 0, c1: 9, rgb });
    };

    for (const cls of showClasses) {
      // Every class gets its heading row, like the manual sheet — even when
      // it has no results for this judge.
      aoa.push([null, cls.num, cls.name]);
      bolds.push(aoa.length - 1);

      // Skip result rows for a judge who didn't judge this class.
      if (slot === 2 && !cls.judge2) continue;

      const isPlacing = ["placing", "class_only", "tbc_class"].includes(cls.scoring_mode);
      const active = cls.entries.filter((e) => !e.scratched);
      const scored = active
        .filter((e) => e[key] != null && e[key] !== -1)
        .sort((a, b) => (isPlacing ? a[key] - b[key] : b[key] - a[key]));
      const dqs = active.filter((e) => e[key] === -1);

      if (isChampionship(cls)) {
        // This judge's own titles. The CHAMP/RESERVE rows reference the class
        // the horse won through (like the manual sheet), not the championship.
        const supreme = /supreme/i.test(cls.name ?? "");
        const originOf = (e) => {
          const feeder = (cls.champ_feeder_ids ?? [])
            .map((id) => showClasses.find((c) => c.id === id))
            .find((f) => f && f.entries.some((x) => x.back_number === e.back_number && !x.scratched));
          return feeder ?? cls;
        };
        if (scored[0]) pushResultRow(supreme ? "SUPREME" : "CHAMP", originOf(scored[0]), scored[0]);
        if (!supreme && scored[1]) pushResultRow("RESERVE", originOf(scored[1]), scored[1]);
      } else {
        scored.forEach((e, i) => {
          pushResultRow(isPlacing ? Math.round(e[key]) : i + 1, cls, e);
        });
      }
      dqs.forEach((e) => pushResultRow("DQ", cls, e));
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 10 }, { wch: 6 }, { wch: 38 }, { wch: 9 }, { wch: 26 },
      { wch: 22 }, { wch: 22 }, { wch: 20 }, { wch: 22 }, { wch: 20 },
    ];
    const border = { style: "thin", color: { rgb: "C0C0C0" } };
    for (const f of fills) {
      for (let c = f.c0; c <= f.c1; c++) {
        const ref = XLSX.utils.encode_cell({ r: f.r, c });
        if (!ws[ref]) ws[ref] = { t: "s", v: "" };
        ws[ref].s = { ...(ws[ref].s ?? {}), fill: { patternType: "solid", fgColor: { rgb: f.rgb } } };
      }
    }
    for (const r of bolds) {
      for (let c = 0; c <= 9; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (ws[ref]) ws[ref].s = { ...(ws[ref].s ?? {}), font: { bold: true } };
      }
    }
    // Light borders on the header row so the columns read on paper.
    for (let c = 0; c <= 9; c++) {
      const ref = XLSX.utils.encode_cell({ r: 4, c });
      if (ws[ref]) ws[ref].s = { ...(ws[ref].s ?? {}), border: { top: border, bottom: border, left: border, right: border } };
    }
    return { ws, name: `J${slot} - ${name || `Judge ${slot}`}`.slice(0, 31) };
  };

  const wb = XLSX.utils.book_new();
  const s1 = buildSheet(1);
  XLSX.utils.book_append_sheet(wb, s1.ws, s1.name);
  if (hasJ2) {
    const s2 = buildSheet(2);
    XLSX.utils.book_append_sheet(wb, s2.ws, s2.name);
  }
  XLSX.writeFile(wb, `${String(event.name ?? "event").replace(/[^a-z0-9]/gi, "-")}-official-scoring.xlsx`);
}
