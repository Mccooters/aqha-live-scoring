"use client";
import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const HEADER_ALIASES = {
  back_number: ["back no", "back#", "back number", "back num", "backnumber", "backno", "back"],
  horse: ["horse", "horse name", "horsename"],
  exhibitor: ["exhibitor", "rider", "shown by", "owner/exhibitor", "owner"],
  class_name: ["class", "class name", "class no", "class number", "classname", "classno"],
  draw_order: ["draw", "draw order", "draw#", "draw no", "draworder"],
};

function mapHeader(h) {
  const n = String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(n)) return field;
  }
  return null;
}

export default function ImportEntries({ eventId, classes, onDone }) {
  const [rows, setRows] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

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

      raw.slice(1).forEach((row, i) => {
        const obj = {};
        headers.forEach((field, j) => { if (field) obj[field] = String(row[j] ?? "").trim(); });
        if (!obj.back_number && !obj.horse) return;
        if (!obj.back_number) { warns.push(`Row ${i + 2}: missing back number — skipped`); return; }
        if (!obj.horse) { warns.push(`Row ${i + 2}: missing horse name — skipped`); return; }
        if (!obj.exhibitor) { warns.push(`Row ${i + 2}: missing exhibitor — skipped`); return; }
        const back = parseInt(obj.back_number, 10);
        if (isNaN(back)) { warns.push(`Row ${i + 2}: back number "${obj.back_number}" is not a number — skipped`); return; }
        parsed.push({
          back_number: back,
          horse: obj.horse,
          exhibitor: obj.exhibitor,
          class_name: obj.class_name || null,
          draw_order: parseInt(obj.draw_order, 10) || 0,
        });
      });

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
      // Group by class name
      const byClass = {};
      rows.forEach((r) => {
        const key = r.class_name ?? "__none__";
        if (!byClass[key]) byClass[key] = [];
        byClass[key].push(r);
      });

      for (const [className, classRows] of Object.entries(byClass)) {
        let cls;
        if (className === "__none__") {
          if (!classes.length) {
            setError("No classes exist yet. Include a Class Name column or add a class first.");
            setImporting(false);
            return;
          }
          cls = classes[0];
        } else {
          cls = classes.find((c) => c.name.toLowerCase() === className.toLowerCase());
          if (!cls) {
            const maxNum = Math.max(0, ...classes.map((c) => c.num));
            const maxOrder = Math.max(0, ...classes.map((c) => c.sort_order));
            const { data: newCls, error: clsErr } = await supabase
              .from("classes")
              .insert({ event_id: eventId, num: maxNum + 1, name: className, sort_order: maxOrder + 1 })
              .select().single();
            if (clsErr) throw clsErr;
            cls = { ...newCls, entries: [] };
          }
        }

        const existingMax = Math.max(0, ...(cls.entries ?? []).map((e) => e.draw_order));
        const insertRows = classRows.map((r, i) => ({
          class_id: cls.id,
          back_number: r.back_number,
          horse: r.horse,
          exhibitor: r.exhibitor,
          draw_order: r.draw_order > 0 ? r.draw_order : existingMax + i + 1,
        }));

        const { error: insErr } = await supabase.from("entries").insert(insertRows);
        if (insErr) throw insErr;
      }

      setDone(true);
    } catch (err) {
      setError(err.message ?? "Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  if (done) {
    return (
      <>
        <h2 className="display modal-title">Import complete</h2>
        <p style={{ color: "var(--green)", fontWeight: 700 }}>✓ {rows.length} entries imported successfully.</p>
        <button className="btn" style={{ background: "var(--leather)", marginTop: 8 }} onClick={onDone}>Done</button>
      </>
    );
  }

  return (
    <>
      <h2 className="display modal-title">Import entries</h2>
      <p style={{ marginTop: 0, fontSize: 13.5, color: "var(--quiet)" }}>
        Upload an .xlsx or .csv file with columns: Back No, Horse Name, Exhibitor, Class Name (optional), Draw Order (optional).{" "}
        <a href="/entry-import-template.xlsx" download style={{ color: "var(--brass)", fontWeight: 700 }}>
          Download template
        </a>
      </p>

      {!rows ? (
        <>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ marginBottom: 12 }} />
          {error && <p className="modal-error">{error}</p>}
          <button className="btn-ghost" style={{ marginTop: 8 }} onClick={onDone}>Cancel</button>
        </>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "var(--quiet)", marginBottom: 8 }}>{rows.length} entries ready to import.</p>
          {warnings.length > 0 && (
            <div style={{ background: "#FFF8EC", border: "1px solid var(--brass)", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
              <strong>Warnings ({warnings.length}):</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, marginBottom: 12 }}>
            <table>
              <thead>
                <tr><th>Back</th><th>Horse</th><th>Exhibitor</th><th>Class</th></tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td style={{ color: "var(--quiet)" }}>#{r.back_number}</td>
                    <td style={{ fontWeight: 600 }}>{r.horse}</td>
                    <td>{r.exhibitor}</td>
                    <td style={{ color: "var(--quiet)", fontSize: 12 }}>{r.class_name ?? "—"}</td>
                  </tr>
                ))}
                {rows.length > 50 && (
                  <tr><td colSpan={4} style={{ color: "var(--quiet)", textAlign: "center", padding: 10 }}>…and {rows.length - 50} more rows</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {error && <p className="modal-error">{error}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={commit} disabled={importing}>
              {importing ? "Importing…" : `Commit ${rows.length} entries`}
            </button>
            <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={() => { setRows(null); setWarnings([]); setError(""); }}>Back</button>
          </div>
        </>
      )}
    </>
  );
}
