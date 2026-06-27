"use client";
import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const ALIASES = {
  num:          ["class #", "class no", "class number", "class num", "num", "#", "number", "no"],
  name:         ["class name", "name", "class"],
  judge:        ["judge", "judge name", "judged by"],
  scoring_mode: ["type", "scoring", "scoring mode", "scoring type", "mode", "score type", "class type"],
  hp_category:  ["hp category", "high points category", "high points cat", "hp cat", "high points", "hp"],
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

function mapHeader(h) {
  const n = String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
  for (const [field, aliases] of Object.entries(ALIASES)) {
    if (aliases.includes(n)) return field;
  }
  return null;
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

      raw.slice(1).forEach((row, i) => {
        const obj = {};
        headers.forEach((field, j) => { if (field) obj[field] = String(row[j] ?? "").trim(); });
        if (!obj.name) return; // blank row — skip silently
        const num = obj.num ? parseInt(obj.num, 10) : null;
        if (obj.num && isNaN(num)) {
          warns.push(`Row ${i + 2}: Class # "${obj.num}" is not a number — will be auto-numbered`);
        }
        let mode = null;
        if (hasModeCol && obj.scoring_mode) {
          mode = normaliseMode(obj.scoring_mode);
          if (!mode) warns.push(`Row ${i + 2}: Unrecognised type "${obj.scoring_mode}" — defaulting to Score`);
        }
        parsed.push({ num: isNaN(num) ? null : num, name: obj.name, judge: obj.judge || "", scoring_mode: mode ?? "score", hp_category: obj.hp_category || null });
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
        .from("classes")
        .select("num, name, sort_order")
        .eq("event_id", eventId);

      const existingNames = new Set((existing ?? []).map((c) => c.name.toLowerCase()));
      let maxNum   = Math.max(0, ...(existing ?? []).map((c) => c.num));
      let maxOrder = Math.max(0, ...(existing ?? []).map((c) => c.sort_order));

      const toInsert = [];
      const skipped  = [];

      for (const r of rows) {
        if (existingNames.has(r.name.toLowerCase())) {
          skipped.push(r.name);
          continue;
        }
        const assignedNum = r.num ?? (maxNum + 1);
        maxNum   = Math.max(maxNum, assignedNum);
        maxOrder = maxOrder + 1;
        toInsert.push({
          event_id:     eventId,
          num:          assignedNum,
          name:         r.name,
          judge:        r.judge,
          sort_order:   maxOrder,
          status:       "upcoming",
          scoring_mode: r.scoring_mode,
          hp_category:  r.hp_category,
        });
        existingNames.add(r.name.toLowerCase());
      }

      if (toInsert.length) {
        const { error: insErr } = await supabase.from("classes").insert(toInsert);
        if (insErr) throw insErr;
      }

      setDone({ created: toInsert.length, skipped: skipped.length });
    } catch (err) {
      setError(err.message ?? "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  if (done) {
    return (
      <>
        <h2 className="display modal-title">Classes imported</h2>
        <p style={{ color: "var(--green)", fontWeight: 700 }}>
          ✓ {done.created} class{done.created !== 1 ? "es" : ""} created.
          {done.skipped > 0 && ` ${done.skipped} already existed and were skipped.`}
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
        Exhibitors will then be able to pick from these classes when registering online.{" "}
        <a href="/hcqha-class-list-template.xlsx" download style={{ color: "var(--brass)", fontWeight: 700 }}>
          Download A Show class list
        </a>
      </p>

      {!rows ? (
        <>
          <p style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 0 }}>
            Columns: <strong>Class #</strong>, <strong>Class Name</strong>, Judge (optional),
            Type (optional — <em>Score</em>, <em>Placing</em>, <em>Class Only</em>, <em>TBC (draw)</em>, or <em>TBC (whole class)</em>; defaults to Score),
            <strong> HP Category</strong> (optional — e.g. <em>Amateur</em>, <em>Senior Horse</em>; sets which High Points table this class feeds into)
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
                <tr><th style={{ width: 55 }}>Class #</th><th>Class Name</th><th>Judge</th><th>Type</th><th>HP Category</th></tr>
              </thead>
              <tbody>
                {rows.slice(0, 60).map((r, i) => (
                  <tr key={i}>
                    <td style={{ color: "var(--quiet)", fontFamily: "monospace" }}>{r.num ?? "auto"}</td>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td style={{ color: "var(--quiet)", fontSize: 12 }}>{r.judge || "—"}</td>
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
                  </tr>
                ))}
                {rows.length > 60 && (
                  <tr><td colSpan={4} style={{ color: "var(--quiet)", textAlign: "center", padding: 10 }}>…and {rows.length - 60} more</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {error && <p className="modal-error">{error}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={commit} disabled={importing}>
              {importing ? "Creating classes…" : `Create ${rows.length} classes`}
            </button>
            <button className="btn-ghost" style={{ padding: "10px 18px" }}
              onClick={() => { setRows(null); setWarnings([]); setError(""); }}>Back</button>
          </div>
        </>
      )}
    </>
  );
}
