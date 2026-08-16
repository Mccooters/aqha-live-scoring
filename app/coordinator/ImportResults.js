"use client";
import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";

// Import a past show's results from a spreadsheet of judges' cards:
// one row per judge's card — Class #, Class Name, then 1st..6th (back
// numbers in placing order). Two rows with the same class number are the two
// judges: first = Judge 1, second = Judge 2. Matches classes by NUMBER,
// creates any missing entries (names looked up from the horse registry),
// writes the placings, and marks those classes completed.

const ordinalCol = (h) => {
  const m = String(h ?? "").trim().toLowerCase().match(/^(\d+)(st|nd|rd|th)$/);
  return m ? parseInt(m[1], 10) : null;
};
const isClassNumHeader = (h) => /^(class\s*(#|no|num|number)?|#|no|num|number)$/.test(String(h ?? "").trim().toLowerCase().replace(/[^a-z#]/g, " ").replace(/\s+/g, " ").trim());
const isClassNameHeader = (h) => /class\s*name|^name$/.test(String(h ?? "").trim().toLowerCase());

export default function ImportResults({ classes, onDone }) {
  const [preview, setPreview] = useState(null); // { groups, warns }
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const [doneWarns, setDoneWarns] = useState([]);
  const [error, setError] = useState("");

  const parseFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const mod = await import("xlsx"); const XLSX = mod.default ?? mod;
      const wb = XLSX.read(await file.arrayBuffer());
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });

      // Find the header row: needs a class-number column and at least a "1st".
      let headerIdx = -1, numCol = -1, nameCol = -1;
      const placeCols = []; // [{ col, place }]
      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const row = rows[i] ?? [];
        const places = [];
        let nc = -1, nmc = -1;
        row.forEach((h, c) => {
          const p = ordinalCol(h);
          if (p) places.push({ col: c, place: p });
          else if (nc === -1 && isClassNumHeader(h)) nc = c;
          else if (nmc === -1 && isClassNameHeader(h)) nmc = c;
        });
        if (nc !== -1 && places.length) {
          headerIdx = i; numCol = nc; nameCol = nmc;
          placeCols.push(...places.sort((a, b) => a.place - b.place));
          break;
        }
      }
      if (headerIdx === -1) {
        setError('Could not find the header row — the sheet needs a "Class #" column and placing columns ("1st", "2nd", …).');
        return;
      }

      const warns = [];
      const cards = [];
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i] ?? [];
        const num = parseInt(String(row[numCol] ?? "").trim(), 10);
        if (isNaN(num)) continue;
        const places = [];
        let hadResults = false;
        for (const { col, place } of placeCols) {
          const raw = String(row[col] ?? "").trim();
          if (!raw) { places.push(null); continue; }
          hadResults = true;
          if (raw === "?" || /illegible/i.test(raw)) {
            warns.push(`Class ${num}: the ${place}${["st","nd","rd"][place-1] ?? "th"} place on one card is marked "?" (illegible) — skipped.`);
            places.push(null);
            continue;
          }
          const back = parseInt(raw, 10);
          if (isNaN(back)) {
            warns.push(`Class ${num}: "${raw}" isn't a back number — skipped.`);
            places.push(null);
          } else {
            places.push(back);
          }
        }
        if (!hadResults) continue; // an empty card (results on the other judge's card, or none)
        cards.push({ num, name: nameCol !== -1 ? String(row[nameCol] ?? "").trim() : "", places });
      }

      // Group by class number in file order: first card = Judge 1, second = Judge 2.
      const groups = new Map();
      for (const card of cards) {
        const g = groups.get(card.num) ?? { num: card.num, name: card.name, cards: [] };
        if (!g.name && card.name) g.name = card.name;
        g.cards.push(card);
        groups.set(card.num, g);
      }

      const out = [];
      for (const g of groups.values()) {
        if (g.cards.length > 2) {
          warns.push(`Class ${g.num}: ${g.cards.length} cards with results found — only the first two are used (J1, J2).`);
          g.cards = g.cards.slice(0, 2);
        }
        const cls = classes.find((c) => !c.hidden && Number(c.num) === g.num);
        if (!cls) {
          warns.push(`Class ${g.num} (${g.name || "no name"}) isn't in this event — skipped. Import the class list first if it's missing.`);
          continue;
        }
        if (g.cards.length === 2 && !cls.judge2) {
          warns.push(`Class ${g.num}: two judges' cards, but the class has no Judge 2 set — the second card still imports as J2.`);
        }
        if ((cls.scoring_mode ?? "score") === "score") {
          warns.push(`Class ${g.num} is set to 70-point scoring, but this file holds placings — they'll import as placings (1, 2, 3…).`);
        }
        out.push({ ...g, cls });
      }
      out.sort((a, b) => a.num - b.num);
      setPreview({ groups: out, warns });
    } catch (err) {
      setError("Could not read that file: " + (err?.message ?? String(err)));
    }
  };

  const commit = async () => {
    if (!preview?.groups?.length) return;
    setImporting(true);
    setError("");
    const warns = [];
    try {
      // Horse registry: names/owners for entries that need creating.
      const allBacks = [...new Set(preview.groups.flatMap((g) => g.cards.flatMap((c) => c.places.filter((b) => b != null))))];
      const { data: horses } = allBacks.length
        ? await supabase.from("horses").select("back_number, name, owner").in("back_number", allBacks)
        : { data: [] };
      const horseMap = Object.fromEntries((horses ?? []).map((h) => [h.back_number, h]));

      for (const g of preview.groups) {
        const cls = g.cls;
        const byBack = new Map(cls.entries.map((e) => [e.back_number, { ...e }]));
        let maxDraw = Math.max(0, ...cls.entries.map((e) => e.draw_order ?? 0));
        const patches = new Map(); // entry back → { score?, score2? }

        for (let j = 0; j < g.cards.length; j++) {
          const field = j === 0 ? "score" : "score2";
          g.cards[j].places.forEach((back, idx) => {
            if (back == null) return;
            const patch = patches.get(back) ?? {};
            patch[field] = idx + 1;
            patches.set(back, patch);
          });
        }

        for (const [back, patch] of patches) {
          let entry = byBack.get(back);
          if (!entry) {
            const h = horseMap[back];
            if (!h) warns.push(`Class ${g.num}: back #${back} isn't in the horse registry — added as "Horse ${back}".`);
            const { data, error: insErr } = await supabase.from("entries").insert({
              class_id: cls.id,
              back_number: back,
              horse: h?.name ?? `Horse ${back}`,
              exhibitor: h?.owner ?? "",
              draw_order: ++maxDraw,
            }).select().single();
            if (insErr) throw new Error(`Class ${g.num}, back #${back}: ${insErr.message}`);
            entry = data;
            byBack.set(back, entry);
          }
          const { error: updErr } = await supabase.from("entries").update(patch).eq("id", entry.id);
          if (updErr) throw new Error(`Class ${g.num}, back #${back}: ${updErr.message}`);
        }

        if (cls.status !== "completed") {
          const { error: stErr } = await supabase.from("classes").update({ status: "completed" }).eq("id", cls.id);
          if (stErr) warns.push(`Class ${g.num}: results imported but the class couldn't be marked completed (${stErr.message}).`);
        }
      }
      setDoneWarns([...preview.warns, ...warns]);
      setDone(true);
    } catch (err) {
      setError("Import stopped: " + (err?.message ?? String(err)) + " — classes finished before this point are saved; fix the file and import again (already-imported classes are safe to re-import).");
    } finally {
      setImporting(false);
    }
  };

  if (done) {
    return (
      <>
        <h2 className="display modal-title">Import results</h2>
        <p style={{ color: "var(--green)", fontWeight: 700 }}>✓ Results imported and classes marked completed.</p>
        {doneWarns.length > 0 && (
          <div style={{ border: "1px solid #E0B15A", background: "#FFF7D6", borderRadius: 8, padding: "8px 12px", maxHeight: 200, overflowY: "auto" }}>
            <div style={{ fontWeight: 800, fontSize: 12.5, color: "var(--leather)", marginBottom: 4 }}>Worth a look:</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--leather)" }}>
              {doneWarns.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
        <p style={{ fontSize: 12.5, color: "var(--quiet)" }}>
          Next: check the results on the event page, then use each class&apos;s ⋯ menu → &quot;Push to High Points&quot; (or the toolbar push-all) if this show counts for points.
        </p>
        <button className="btn" style={{ background: "var(--leather)", marginTop: 8 }} onClick={onDone}>Done</button>
      </>
    );
  }

  return (
    <>
      <h2 className="display modal-title">Import results</h2>
      <p style={{ marginTop: 0, fontSize: 13, color: "var(--quiet)" }}>
        For typing in a past show in one go. Upload a spreadsheet of the judges&apos; cards: one row per card, with
        <strong> Class #</strong> and the back numbers placed <strong>1st, 2nd, 3rd…</strong> Two rows with the same
        class number are the two judges (first = J1, second = J2). Classes are matched by number, missing entries are
        created from the horse registry, and each imported class is marked completed. Safe to run twice.
      </p>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={parseFile} style={{ marginBottom: 10 }} />
      {error && <p className="modal-error">{error}</p>}

      {preview && (
        <>
          {preview.warns.length > 0 && (
            <div style={{ border: "1px solid #E0B15A", background: "#FFF7D6", borderRadius: 8, padding: "8px 12px", marginBottom: 10, maxHeight: 180, overflowY: "auto" }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, color: "var(--leather)", marginBottom: 4 }}>Notes:</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--leather)" }}>
                {preview.warns.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          <div style={{ border: "1px solid var(--line)", borderRadius: 8, maxHeight: 300, overflowY: "auto", marginBottom: 12 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 55 }}>Class</th>
                  <th>Name</th>
                  <th>J1 placings</th>
                  <th>J2 placings</th>
                </tr>
              </thead>
              <tbody>
                {preview.groups.map((g) => (
                  <tr key={g.num}>
                    <td className="display" style={{ fontWeight: 700 }}>{g.num}</td>
                    <td style={{ fontSize: 12.5 }}>{g.cls.name}</td>
                    <td style={{ fontSize: 12.5, fontFamily: "monospace" }}>{g.cards[0]?.places.filter((b) => b != null).join(", ") || "—"}</td>
                    <td style={{ fontSize: 12.5, fontFamily: "monospace" }}>{g.cards[1]?.places.filter((b) => b != null).join(", ") || "—"}</td>
                  </tr>
                ))}
                {!preview.groups.length && (
                  <tr><td colSpan={4} style={{ color: "var(--quiet)", fontStyle: "italic" }}>No classes with results matched this event.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <button className="btn" style={{ width: "100%", background: "var(--leather)" }}
            disabled={importing || !preview.groups.length} onClick={commit}>
            {importing ? "Importing…" : `Import results for ${preview.groups.length} class${preview.groups.length === 1 ? "" : "es"}`}
          </button>
        </>
      )}
      <button className="btn-ghost" style={{ marginTop: 10 }} onClick={onDone}>Cancel</button>
    </>
  );
}
