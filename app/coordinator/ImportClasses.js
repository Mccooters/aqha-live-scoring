"use client";
import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { normaliseBreakLabel, normaliseCategoryLabel } from "../../lib/classCategories";

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
  const v = String(raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
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

function classIdentityKey(cls) {
  const category = normaliseCategoryLabel(cls.program_category).toLowerCase();
  const name = String(cls.name ?? "").trim().toLowerCase();
  return `${category}::${name}`;
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
    } catch (err) {
      setError("Could not read file: " + (err?.message ?? String(err)));
    }
  };

  const commit = async () => {
    if (!rows?.length) return;
    setImporting(true);
    try {
      // Find the current max num and sort_order so we don't collide
      const { data: existing } = await supabase
        .from("classes").select("id, num, name, sort_order, program_category")
        .eq("event_id", eventId);

      const existingRows = existing ?? [];
      const existingByNumAndName = uniqueMap(existingRows, (c) => c.num == null ? "" : `${c.num}::${String(c.name ?? "").trim().toLowerCase()}`);
      const existingByIdentity = uniqueMap(existingRows, classIdentityKey);
      const existingByName = uniqueMap(existingRows, (c) => String(c.name ?? "").trim().toLowerCase());
      let maxNum   = Math.max(0, ...(existing ?? []).map((c) => c.num));
      let maxOrder = Math.max(0, ...(existing ?? []).map((c) => c.sort_order));

      const toInsert = [];
      const toUpdate = [];

      for (const r of rows) {
        const numNameMatch = r.num == null ? null : existingByNumAndName.get(`${r.num}::${r.name.toLowerCase()}`);
        const identityMatch = existingByIdentity.get(classIdentityKey(r));
        const nameMatch = r.num == null ? existingByName.get(r.name.toLowerCase()) : null;
        const match = numNameMatch || identityMatch || nameMatch;
        if (match) {
          // Update judges and other fields on the existing class
          const patch = { scoring_mode: r.scoring_mode, sort_order: r.sort_order };
          if (r.hasJudgeCol) patch.judge = r.judge;
          if (r.hasJudge2Col) patch.judge2 = r.judge2 || null;
          if (r.hasCategoryCol) patch.program_category = normaliseCategoryLabel(r.program_category) || null;
          if (r.hasBreakCol) patch.program_break_before = normaliseBreakLabel(r.program_break_before) || null;
          if (r.hasBreakAfterCol) patch.program_break_after = normaliseBreakLabel(r.program_break_after) || null;
          if (r.hp_category !== null) patch.hp_category = r.hp_category;
          if (r.hasDayCol) patch.day = r.day || 1;
          if (r.hasCapacityCol) patch.capacity = r.capacity;
          if (r.hasPatternCol) patch.pattern_url = r.pattern_url;
          if (r.num !== null) patch.num = r.num;
          toUpdate.push({ id: match.id, ...patch });
        } else {
          const assignedNum = r.num ?? (maxNum + 1);
          maxNum   = Math.max(maxNum, assignedNum);
          const assignedOrder = r.sort_order ?? (maxOrder + 1);
          maxOrder = Math.max(maxOrder, assignedOrder);
          const insertRow = {
            event_id:     eventId,
            num:          assignedNum,
            name:         r.name,
            judge:        r.judge,
            judge2:       r.judge2 || null,
            sort_order:   assignedOrder,
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
          toInsert.push(insertRow);
        }
      }

      if (toInsert.length) {
        const { error: insErr } = await supabase.from("classes").insert(toInsert);
        if (insErr) throw insErr;
      }
      for (const { id, ...patch } of toUpdate) {
        const { error: updErr } = await supabase.from("classes").update(patch).eq("id", id);
        if (updErr) throw updErr;
      }

      setDone({ created: toInsert.length, updated: toUpdate.length });
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
          ✓ {done.created} class{done.created !== 1 ? "es" : ""} created
          {done.updated > 0 && `, ${done.updated} updated`}.
        </p>
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
        Upload a spreadsheet of classes to add to this event. No entries needed — just the class list.
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
          <p style={{ fontSize: 13, color: "var(--quiet)", marginBottom: 8 }}>
            {rows.length} classes ready to create.
          </p>
          {warnings.length > 0 && (
            <div style={{ background: "#FFF8EC", border: "1px solid var(--brass)", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
              <strong>Notes:</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
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
          {error && <p className="modal-error">{error}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={commit} disabled={importing}>
              {importing ? "Importing…" : `Import ${rows.length} class${rows.length !== 1 ? "es" : ""}`}
            </button>
            <button className="btn-ghost" style={{ padding: "10px 18px" }}
              onClick={() => { setRows(null); setWarnings([]); setError(""); }}>Back</button>
          </div>
        </>
      )}
    </>
  );
}
