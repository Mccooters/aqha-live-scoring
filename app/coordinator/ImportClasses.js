"use client";
import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { normaliseBreakLabel, normaliseCategoryLabel } from "../../lib/classCategories";
import { isChampionship, looksLikeChampionship, looksLikeSupreme, suggestFeederIds } from "../../lib/championship";
import { autoMatch, suggestLinks, buildPlan } from "../../lib/classImportPlan";

const ALIASES = {
  num:          ["class #", "class no", "class number", "class num", "num", "#", "number", "no"],
  name:         ["class name", "name", "class"],
  program_category: ["category", "class category", "program category", "program section", "section", "division", "group"],
  program_break_before: ["break", "break before", "program break", "program break before", "break heading", "program break heading"],
  program_break_after: ["break after", "program break after", "finish after"],
  judge:        ["judge", "judge 1", "judge1", "judge name", "judge 1 name", "judge one", "judge one name", "first judge", "judge a", "judged by"],
  judge2:       ["judge 2", "judge2", "judge 2 name", "judge two", "judge two name", "second judge", "judge b"],
  scoring_mode: ["type", "scoring", "scoring mode", "scoring type", "mode", "score type", "class type"],
  hp_category:  ["hp category", "high points category", "high points cat", "hp cat", "high points", "hp"],
  day:          ["day", "show day", "program day"],
  capacity:     ["capacity", "spot capacity", "class capacity", "limit", "spots"],
  pattern_url:  ["pattern", "pattern url", "pattern link", "pattern file", "pattern_url"],
};

const MODE_MAP = {
  score:      ["score", "70pt", "70 pt", "70point", "70 point", "points", "scored", "70"],
  placing:    ["placing", "placings", "place", "places", "1st2nd3rd", "1st/2nd/3rd", "ribbon", "ribbons"],
  class_only: ["class only", "class_only", "classonly", "rail", "rail class", "together", "group", "no draw"],
  tbc:        ["tbc draw", "tbc-draw", "draw tbc", "tbc individual", "individual tbc"],
  tbc_class:  ["tbc", "tbc class", "tbc_class", "tbc whole class", "to be confirmed", "confirmed later", "paperwork", "paper", "judge paper", "results later", "whole class tbc"],
};

function normaliseMode(raw) {
  // Collapse runs of spaces so "TBC (whole class)" — whose brackets become
  // two spaces — still matches the "tbc whole class" alias.
  const v = String(raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  if (!v) return null;
  for (const [mode, aliases] of Object.entries(MODE_MAP)) {
    if (aliases.includes(v)) return mode;
  }
  return null;
}

function normaliseHeader(h) {
  return String(h ?? "").toLowerCase().replace(/#/g, " number ").replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

function mapHeader(h) {
  const n = normaliseHeader(h);
  for (const [field, aliases] of Object.entries(ALIASES)) {
    if (aliases.some((alias) => normaliseHeader(alias) === n)) return field;
  }
  return null;
}

function looksLikeCategoryHeading(obj) {
  const name = obj.name?.trim();
  if (!name || obj.num || obj.judge || obj.judge2 || obj.scoring_mode || obj.hp_category) return false;
  const letters = name.replace(/[^A-Za-z]/g, "");
  return letters.length >= 4 && name === name.toUpperCase();
}

function parseOptionalInt(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function ImportClasses({ eventId, onDone }) {
  const [rows, setRows]       = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [importing, setImporting] = useState(false);
  const [done, setDone]       = useState(false);
  const [error, setError]     = useState("");
  // The event's classes as they stand, with how many people have booked each
  // (placed entries + unpaid online bookings) — loaded when a file is chosen
  // so the preview can show exactly what the import changes.
  const [existing, setExisting] = useState(null);
  const [links, setLinks]       = useState([]); // per sheet row: existing class id it updates, or null = new class
  const [showAll, setShowAll]   = useState(false);

  const loadExisting = async (parsed) => {
    const { data: cls, error: clsErr } = await supabase
      .from("classes").select("*").eq("event_id", eventId);
    if (clsErr) throw clsErr;
    const ids = (cls ?? []).map((c) => c.id);
    const booked = {}, results = {};
    if (ids.length) {
      const { data: ents } = await supabase
        .from("entries").select("class_id, scratched, score, score2").in("class_id", ids);
      for (const e of ents ?? []) {
        if (!e.scratched) booked[e.class_id] = (booked[e.class_id] ?? 0) + 1;
        if (e.score != null || e.score2 != null) results[e.class_id] = true;
      }
      // Unpaid online bookings waiting on payment count too — they become
      // entries in this class the moment they're paid.
      const { data: pend } = await supabase
        .from("registration_entries").select("class_id, registrations!inner(status)")
        .in("class_id", ids).eq("registrations.status", "pending");
      for (const p of pend ?? []) booked[p.class_id] = (booked[p.class_id] ?? 0) + 1;
    }
    const rows = (cls ?? []).map((c) => ({ ...c, booked: booked[c.id] ?? 0, hasResults: !!results[c.id] }));
    const auto = autoMatch(parsed, rows);
    const sugg = suggestLinks(parsed, rows, auto);
    setExisting(rows);
    setLinks(auto.map((id, i) => id ?? sugg[i] ?? null));
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const mod = await import("xlsx"); const XLSX = mod.default ?? mod;
      let wb;
      if (file.name.toLowerCase().endsWith(".csv")) {
        wb = XLSX.read(await file.text(), { type: "string" });
      } else {
        wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
      }
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (raw.length < 2) { setError("Spreadsheet appears to be empty."); return; }

      const headers = raw[0].map(mapHeader);
      const parsed = [];
      const warns = [];

      const hasModeCol = headers.includes("scoring_mode");
      const hasJudgeCol = headers.includes("judge");
      const hasJudge2Col = headers.includes("judge2");
      const hasCategoryCol = headers.includes("program_category");
      const hasBreakCol = headers.includes("program_break_before");
      const hasBreakAfterCol = headers.includes("program_break_after");
      const hasDayCol = headers.includes("day");
      const hasCapacityCol = headers.includes("capacity");
      const hasPatternCol = headers.includes("pattern_url");
      let currentCategory = "";
      let pendingBreak = "";

      raw.slice(1).forEach((row, i) => {
        const obj = {};
        headers.forEach((field, j) => { if (field) obj[field] = String(row[j] ?? "").trim(); });
        const rowCategory = normaliseCategoryLabel(obj.program_category);
        const rowBreak = normaliseBreakLabel(obj.program_break_before);
        const rowBreakAfter = normaliseBreakLabel(obj.program_break_after);
        if (rowCategory) currentCategory = rowCategory;
        if (rowBreak) pendingBreak = rowBreak;
        if (!obj.name && rowBreak) return; // break heading row
        if (!obj.name && rowCategory) return; // category heading row
        if (!obj.name) return; // blank row — skip silently
        if (!hasCategoryCol && looksLikeCategoryHeading(obj)) {
          currentCategory = normaliseCategoryLabel(obj.name);
          return;
        }
        const breakBefore = rowBreak || pendingBreak || null;
        pendingBreak = "";
        const num = obj.num ? parseInt(obj.num, 10) : null;
        if (obj.num && isNaN(num)) {
          warns.push(`Row ${i + 2}: Class # "${obj.num}" is not a number — will be auto-numbered`);
        }
        let mode = null;
        if (hasModeCol && obj.scoring_mode) {
          mode = normaliseMode(obj.scoring_mode);
          if (!mode) warns.push(`Row ${i + 2}: Unrecognised type "${obj.scoring_mode}" — defaulting to Score`);
        }
        const day = parseOptionalInt(obj.day);
        if (hasDayCol && obj.day && !day) warns.push(`Row ${i + 2}: Day "${obj.day}" is not a number — defaulting to Day 1`);
        const capacity = parseOptionalInt(obj.capacity);
        if (hasCapacityCol && obj.capacity && !capacity) warns.push(`Row ${i + 2}: Capacity "${obj.capacity}" is not a number — leaving it unlimited`);
        parsed.push({
          num: isNaN(num) ? null : num,
          name: obj.name,
          judge: obj.judge || "",
          judge2: obj.judge2 || "",
          sort_order: parsed.length + 1,
          hasJudgeCol,
          hasJudge2Col,
          program_category: rowCategory || currentCategory || null,
          hasCategoryCol: hasCategoryCol || !!currentCategory,
          program_break_before: breakBefore,
          hasBreakCol: hasBreakCol || !!breakBefore,
          program_break_after: rowBreakAfter || null,
          hasBreakAfterCol,
          scoring_mode: mode ?? "score",
          hasModeCol,
          hp_category: obj.hp_category || null,
          day: day || 1,
          hasDayCol,
          capacity,
          hasCapacityCol,
          pattern_url: obj.pattern_url || null,
          hasPatternCol,
        });
      });

      if (!parsed.length) { setError("No class names found. Make sure the spreadsheet has a 'Class Name' column."); return; }
      setRows(parsed);
      setWarnings(warns);
      await loadExisting(parsed);
    } catch (err) {
      setError("Could not read file: " + (err?.message ?? String(err)));
    }
  };

  const plan = rows && existing ? buildPlan(rows, existing, links) : null;

  const commit = async () => {
    if (!rows?.length || !plan) return;
    setImporting(true);
    try {
      const toInsert = plan.writes.inserts.map(({ i, sort_order }) => {
        const r = rows[i];
        const insertRow = {
          event_id:     eventId,
          num:          r.num,
          name:         r.name,
          judge:        r.judge,
          judge2:       r.judge2 || null,
          sort_order,
          status:       "upcoming",
          scoring_mode: r.scoring_mode,
          hp_category:  r.hp_category,
          day:          r.day || 1,
          capacity:     r.capacity,
          pattern_url:  r.pattern_url,
        };
        if (r.program_category) insertRow.program_category = normaliseCategoryLabel(r.program_category);
        if (r.program_break_before) insertRow.program_break_before = normaliseBreakLabel(r.program_break_before);
        if (r.program_break_after) insertRow.program_break_after = normaliseBreakLabel(r.program_break_after);
        return insertRow;
      });
      // Rows without a class number get the next free one.
      let maxNum = Math.max(0, ...existing.map((c) => c.num ?? 0), ...toInsert.map((r) => r.num ?? 0));
      toInsert.forEach((r) => { if (r.num == null) r.num = ++maxNum; });

      const insertedIds = new Set();
      if (toInsert.length) {
        const { data: inserted, error: insErr } = await supabase.from("classes").insert(toInsert).select("id");
        if (insErr) throw insErr;
        (inserted ?? []).forEach((c) => insertedIds.add(c.id));
      }
      // Updates only ever change fields on an existing class — its id, and so
      // every entry and online booking attached to it, stays the same.
      for (const { id, patch } of plan.writes.updates) {
        const { error: updErr } = await supabase.from("classes").update(patch).eq("id", id);
        if (updErr) throw updErr;
      }

      // Championship classes (schema-v43): a freshly created "Champ &
      // Reserve" / "GRAND CHAMPION" / "SUPREME" class is linked to its feeder
      // classes with the same guess the class form pre-ticks, so a 200-class
      // program doesn't need every championship opened by hand. Only classes
      // created by THIS import are touched — never links staff already set.
      let linked = 0;
      if (toInsert.some((r) => looksLikeChampionship(r.name))) {
        const { data: fresh } = await supabase
          .from("classes").select("id, name, day, sort_order, champ_feeder_ids")
          .eq("event_id", eventId).order("sort_order", { ascending: true });
        const all = fresh ?? [];
        for (const cls of all) {
          if (!insertedIds.has(cls.id) || !looksLikeChampionship(cls.name) || isChampionship(cls)) continue;
          const feederIds = suggestFeederIds(cls, all);
          if (!feederIds.length) continue;
          const { error: linkErr } = await supabase.from("classes")
            .update({ champ_feeder_ids: feederIds, champ_take: looksLikeSupreme(cls.name) ? "top1" : "top2" })
            .eq("id", cls.id);
          if (linkErr) {
            // Pre-v43 database: the classes are in, just not linked.
            if (linkErr.message?.includes("champ_feeder_ids") || linkErr.message?.includes("champ_take")) break;
            throw linkErr;
          }
          cls.champ_feeder_ids = feederIds; // so a Grand Champion above sees this one as a championship
          linked += 1;
        }
      }

      setDone({ created: toInsert.length, updated: plan.updated.length, kept: plan.kept.length, linked,
        bookedKept: plan.bookedClasses.length });
    } catch (err) {
      setError(err.message?.includes("program_category")
        ? 'Database migration needed. Please run "schema-v19-class-categories.sql" in your Supabase SQL Editor first.'
        : err.message?.includes("program_break_before") || err.message?.includes("program_break_after") ? 'Database migration needed. Please run "schema-v20-program-breaks.sql" in your Supabase SQL Editor first.'
        : err.message ?? "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  if (done) {
    return (
      <>
        <h2 className="display modal-title">Classes imported</h2>
        <p style={{ color: "var(--green)", fontWeight: 700 }}>
          ✓ {done.created} class{done.created !== 1 ? "es" : ""} added
          {done.updated > 0 && `, ${done.updated} changed`}
          {done.kept > 0 && `, ${done.kept} kept that weren't in the file`}.
        </p>
        {done.bookedKept > 0 && (
          <p style={{ fontSize: 13, color: "var(--leather)", marginTop: 0 }}>
            All {done.bookedKept} class{done.bookedKept !== 1 ? "es" : ""} people had booked are still in the program with their bookings.
          </p>
        )}
        {done.linked > 0 && (
          <p style={{ fontSize: 13, color: "var(--leather)", marginTop: 0 }}>
            🏆 {done.linked} championship class{done.linked !== 1 ? "es" : ""} linked to the classes above {done.linked !== 1 ? "them" : "it"} in the program. Open a championship from its ⋯ menu to check the ticked feeder classes.
          </p>
        )}
        <p style={{ fontSize: 13, color: "var(--quiet)", marginTop: 0 }}>
          Classes are now live on the online registration form. Exhibitors can choose from them when they register.
        </p>
        <button className="btn" style={{ background: "var(--leather)", marginTop: 8 }} onClick={onDone}>Done</button>
      </>
    );
  }

  return (
    <>
      <h2 className="display modal-title">Import class list</h2>
      <p style={{ marginTop: 0, fontSize: 13.5, color: "var(--quiet)" }}>
        Upload a spreadsheet of classes to add to this event, or an updated version of the whole list — classes already
        in the program are matched and updated, never deleted, and you see every change before it is saved. No entries needed — just the class list.
        Exhibitors will then be able to pick from these classes when registering online. The example file includes an Options tab and grey free-entry cells for class numbers, names, and judges.{" "}
        <a href="/hcqha-class-list-template.xlsx" download style={{ color: "var(--brass)", fontWeight: 700 }}>
          Download example class template
        </a>
      </p>

      {!rows ? (
        <>
          <p style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 0 }}>
            Columns: <strong>Category</strong> (optional), <strong>Break Before</strong> (optional), <strong>Class #</strong>, <strong>Class Name</strong>, <strong>Judge 1</strong> (optional), <strong>Judge 2</strong> (optional), <strong>Break After</strong> (optional),
            Type (optional — <em>Score</em>, <em>Placing</em>, <em>Class Only</em>, <em>TBC (draw)</em>, or <em>TBC (whole class)</em>; defaults to Score),
            <strong> HP Category</strong> (optional — e.g. <em>Amateur</em>, <em>Senior Horse</em>; sets which High Points table this class feeds into),
            <strong> Day</strong>, <strong>Capacity</strong>, and <strong>Pattern URL</strong>.
          </p>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ marginBottom: 12 }} />
          {error && <p className="modal-error">{error}</p>}
          <button className="btn-ghost" style={{ marginTop: 8 }} onClick={onDone}>Cancel</button>
        </>
      ) : (
        <>
          {!plan ? (
            <p style={{ fontSize: 13, color: "var(--quiet)" }}>Comparing with the current program…</p>
          ) : (
            <ImportChanges plan={plan} rows={rows} existing={existing} links={links} setLinks={setLinks} />
          )}
          {warnings.length > 0 && (
            <div style={{ background: "#FFF8EC", border: "1px solid var(--brass)", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
              <strong>Notes:</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          <details open={showAll} onToggle={(e) => setShowAll(e.currentTarget.open)} style={{ marginBottom: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--leather)" }}>Everything in the file ({rows.length} classes)</summary>
          <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, marginBottom: 12 }}>
            <table>
              <thead>
                <tr><th>Category</th><th>Break Before</th><th style={{ width: 55 }}>Class #</th><th>Class Name</th><th>Judge 1</th><th>Judge 2</th><th>Break After</th><th>Type</th><th>HP Category</th><th>Day</th><th>Capacity</th><th>Pattern URL</th></tr>
              </thead>
              <tbody>
                {rows.slice(0, 60).map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 12, color: r.program_category ? "#1746C6" : "var(--line)", fontWeight: r.program_category ? 700 : 400 }}>{r.program_category || "—"}</td>
                    <td style={{ fontSize: 12, color: r.program_break_before ? "var(--leather)" : "var(--line)", fontWeight: r.program_break_before ? 700 : 400 }}>{r.program_break_before || "—"}</td>
                    <td style={{ color: "var(--quiet)", fontFamily: "monospace" }}>{r.num ?? "auto"}</td>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td style={{ color: "var(--quiet)", fontSize: 12 }}>{r.judge || "—"}</td>
                    <td style={{ color: "var(--quiet)", fontSize: 12 }}>{r.judge2 || "—"}</td>
                    <td style={{ fontSize: 12, color: r.program_break_after ? "var(--leather)" : "var(--line)", fontWeight: r.program_break_after ? 700 : 400 }}>{r.program_break_after || "—"}</td>
                    <td style={{ fontSize: 12 }}>
                      <span style={{
                        background: r.scoring_mode === "placing" ? "#EEF4FF" : r.scoring_mode === "class_only" ? "#F3F0FF" : (r.scoring_mode === "tbc" || r.scoring_mode === "tbc_class") ? "#FFF3E0" : "#F0FBF0",
                        color: r.scoring_mode === "placing" ? "#2255CC" : r.scoring_mode === "class_only" ? "#5533AA" : (r.scoring_mode === "tbc" || r.scoring_mode === "tbc_class") ? "#A05000" : "#226622",
                        borderRadius: 10, padding: "2px 8px", fontWeight: 600, fontSize: 11, whiteSpace: "nowrap",
                      }}>
                        {r.scoring_mode === "placing" ? "Placing" : r.scoring_mode === "class_only" ? "Class only" : r.scoring_mode === "tbc" ? "TBC (draw)" : r.scoring_mode === "tbc_class" ? "TBC (whole class)" : "Score"}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: r.hp_category ? "var(--brass)" : "var(--line)", fontWeight: r.hp_category ? 700 : 400 }}>
                      {r.hp_category || "—"}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--quiet)", textAlign: "center" }}>{r.day || 1}</td>
                    <td style={{ fontSize: 12, color: r.capacity ? "var(--quiet)" : "var(--line)", textAlign: "center" }}>{r.capacity || "—"}</td>
                    <td style={{ fontSize: 12, color: r.pattern_url ? "var(--brass)" : "var(--line)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.pattern_url || "—"}
                    </td>
                  </tr>
                ))}
                {rows.length > 60 && (
                  <tr><td colSpan={12} style={{ color: "var(--quiet)", textAlign: "center", padding: 10 }}>…and {rows.length - 60} more</td></tr>
                )}
              </tbody>
            </table>
          </div>
          </details>
          {error && <p className="modal-error">{error}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={commit} disabled={importing || !plan}>
              {importing ? "Saving…" : !plan ? "Comparing…" : `Apply: ${plan.added.length} new, ${plan.updated.length} changed`}
            </button>
            <button className="btn-ghost" style={{ padding: "10px 18px" }}
              onClick={() => { setRows(null); setWarnings([]); setError(""); setExisting(null); setLinks([]); }}>Back</button>
          </div>
        </>
      )}
    </>
  );
}

// The "what will change" preview. Booked classes are called out everywhere:
// nothing here can remove a booking, but a class renamed in the sheet only
// keeps its bookings if it is linked to the existing class (the dropdown on
// each new class).
const bookedTag = (n) => (n > 0 ? (
  <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, padding: "1px 7px", borderRadius: 999, background: "#2D7A52", color: "#fff", whiteSpace: "nowrap" }}>
    {n} booked
  </span>
) : null);
const clsLabel = (c) => `${c.num != null ? `#${c.num} ` : ""}${c.name}`;

export function ImportChanges({ plan, rows, existing, links, setLinks }) {
  const linkedIds = new Set(links.filter(Boolean));
  const box = { border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 13, background: "#fff" };
  const h = { fontWeight: 800, color: "var(--leather)", marginBottom: 4 };
  const bookedKept = plan.bookedClasses.length;
  return (
    <>
      <div style={{ ...box, background: "#E6F2EA", borderColor: "#2D7A52" }}>
        <div style={{ fontWeight: 800, color: "#2D7A52" }}>
          {plan.added.length} new · {plan.updated.length} changed · {plan.unchanged.length} unchanged
          {plan.kept.length > 0 ? ` · ${plan.kept.length} not in the file (kept)` : ""}
        </div>
        <div style={{ color: "var(--leather)", marginTop: 2 }}>
          No class is deleted.{bookedKept > 0 ? ` All ${bookedKept} class${bookedKept !== 1 ? "es" : ""} people have booked stay in the program, and every booking stays with its class.` : ""}
          {plan.moved > 0 ? ` ${plan.moved} class${plan.moved !== 1 ? "es" : ""} move to match the file's order.` : ""}
        </div>
      </div>

      {plan.duplicateNumbers.length > 0 && (
        <div style={{ ...box, background: "#FFF8EC", borderColor: "var(--brass)" }}>
          <div style={h}>⚠ Two classes would share a number</div>
          {plan.duplicateNumbers.map((d) => (
            <div key={d.num}>#{d.num}: {d.names.join(" and ")}</div>
          ))}
          <div style={{ color: "var(--quiet)", marginTop: 4 }}>If one is the other renamed, link it below so it is updated instead of added.</div>
        </div>
      )}

      {plan.added.length > 0 && (
        <div style={box}>
          <div style={h}>New classes ({plan.added.length})</div>
          <div style={{ color: "var(--quiet)", marginBottom: 6 }}>
            If one of these is an existing class with a new name, choose it in the box — it is then renamed instead, and keeps its bookings.
          </div>
          {plan.added.map(({ i, row }) => {
            const options = existing.filter((c) => !linkedIds.has(c.id) || links[i] === c.id)
              .sort((a, b) => (a.num ?? 0) - (b.num ?? 0));
            return (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "4px 0", borderTop: "1px solid var(--line)" }}>
                <span style={{ fontWeight: 700, flex: "1 1 200px" }}>{clsLabel(row)}{row.program_category ? <span style={{ color: "var(--quiet)", fontWeight: 400 }}> · {row.program_category}</span> : null}</span>
                <select className="field" style={{ fontSize: 12.5, padding: "4px 6px", maxWidth: 320 }} value=""
                  onChange={(e) => setLinks((cur) => cur.map((v, k) => (k === i ? (e.target.value || null) : v)))}>
                  <option value="">Add as a new class</option>
                  {options.map((c) => (
                    <option key={c.id} value={c.id}>Same class as {clsLabel(c)}{c.booked ? ` (${c.booked} booked)` : ""}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}

      {plan.updated.length > 0 && (
        <div style={box}>
          <div style={h}>Changes to existing classes ({plan.updated.length})</div>
          {plan.updated.map(({ i, cls, changes, notes }) => (
            <div key={cls.id} style={{ padding: "5px 0", borderTop: "1px solid var(--line)" }}>
              <div style={{ fontWeight: 700 }}>
                {clsLabel(cls)}{bookedTag(cls.booked)}
                {links[i] && rows[i] && String(rows[i].name).trim().toLowerCase() !== String(cls.name).trim().toLowerCase() && (
                  <button className="btn-ghost" style={{ fontSize: 11, marginLeft: 8 }}
                    onClick={() => setLinks((cur) => cur.map((v, k) => (k === i ? null : v)))}>Unlink</button>
                )}
              </div>
              {changes.map((c) => (
                <div key={c.field} style={{ color: "var(--ink)" }}>
                  {c.label}: <span style={{ color: "var(--quiet)", textDecoration: "line-through" }}>{c.from}</span> → <strong>{c.to}</strong>
                </div>
              ))}
              {notes.map((n, k) => <div key={k} style={{ color: "#A05000" }}>⚠ {n}</div>)}
            </div>
          ))}
        </div>
      )}

      {plan.kept.length > 0 && (
        <div style={box}>
          <div style={h}>In the program but not in the file ({plan.kept.length})</div>
          <div style={{ color: "var(--quiet)", marginBottom: 4 }}>
            These stay exactly as they are, in their usual place in the running order. Delete or hide them on the dashboard if they're no longer wanted.
          </div>
          {plan.kept.map((c) => (
            <div key={c.id} style={{ padding: "3px 0", borderTop: "1px solid var(--line)" }}>
              {clsLabel(c)}{bookedTag(c.booked)}
              {c.booked > 0 && plan.added.length > 0 && (
                <span style={{ color: "#A05000" }}> — renamed in the file? Link it under New classes.</span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
