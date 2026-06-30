"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

const HORSE_CATEGORIES = new Set([
  "Overall Halter", "Overall 2YO", "Overall 3YO", "Junior Horse", "Senior Horse"
]);

// All classes that should always appear even if no one has points yet.
// Any category found in the data but not listed here will still appear at the end.
const CANONICAL_CATEGORIES = [
  "Overall Halter", "Overall 2YO", "Overall 3YO", "Junior Horse", "Senior Horse",
  "Amateur", "Novice Amateur", "Select", "Beginner", "EWD", "Youth", "Leadline",
];

const KNOWN_CATEGORY_NAMES = new Set(CANONICAL_CATEGORIES.map(c => c.toLowerCase()));

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const SHOW_MONTH_ORDER = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december"
];

// Season runs August–July. Aug=0 … Dec=4, Jan=5 … Jul=11.
function seasonMonthIdxFromDate(dateStr) {
  const m = new Date(dateStr + "T00:00:00").getMonth(); // 0=Jan
  return m >= 7 ? m - 7 : m + 5;
}
function seasonMonthIdxFromName(name) {
  const i = SHOW_MONTH_ORDER.findIndex(m => name.toLowerCase().includes(m));
  if (i === -1) return 999;
  return i >= 7 ? i - 7 : i + 5;
}

// dateMap: show_name → show_date (ISO string). Used for reliable sort when available.
function sortShows(shows, dateMap = {}) {
  return [...shows].sort((a, b) => {
    const ia = dateMap[a] ? seasonMonthIdxFromDate(dateMap[a]) : seasonMonthIdxFromName(a);
    const ib = dateMap[b] ? seasonMonthIdxFromDate(dateMap[b]) : seasonMonthIdxFromName(b);
    return ia !== ib ? ia - ib : a.localeCompare(b);
  });
}

// Returns "Nov '25" from a stored date; falls back to extracting month from the show name.
function showLabel(name, season, date) {
  if (date) {
    const d = new Date(date + "T00:00:00");
    return `${MONTH_ABBR[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
  }
  const i = SHOW_MONTH_ORDER.findIndex(m => name.toLowerCase().includes(m));
  const base = name.replace(/ show$/i, "");
  if (i === -1 || !season) return base;
  const parts = season.split("-").map(Number);
  const year = i >= 7 ? parts[0] : parts[1];
  return `${base} '${String(year).slice(2)}`;
}

// Which season we're currently in (Aug 1 → Jul 31 cycle).
function currentSeasonFromDate(date = new Date()) {
  const y = date.getFullYear();
  return date.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

function parseHighPointsCSV(text) {
  const rows = text.split(/\r?\n/).map(l => l.split(",").map(c => c.trim()));
  if (!rows.length) return { entries: [], season: "", showNames: [] };

  const firstRow = rows[0];
  const seasonMatch = firstRow[0]?.match(/\d{4}-\d{4}/);
  const season = seasonMatch ? seasonMatch[0] : "Unknown";
  const showNames = firstRow.slice(1).filter(v => v && v !== "Total");

  const entries = [];
  let category = null;
  let entityType = "rider";
  let showCols = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const col0 = row[0];
    if (!col0) continue;

    const isCatByShows = showNames.length > 0 && showNames.includes(row[1]);
    const isCatByName = KNOWN_CATEGORY_NAMES.has(col0.toLowerCase());

    if (isCatByShows || isCatByName) {
      category = col0;
      entityType = HORSE_CATEGORIES.has(col0) ? "horse" : "rider";
      if (isCatByShows) {
        showCols = showNames
          .map(show => ({ show, col: row.indexOf(show) }))
          .filter(s => s.col !== -1);
      }
      continue;
    }

    if (!category || !showCols.length) continue;

    showCols.forEach(({ show, col }) => {
      const raw = row[col];
      if (!raw || raw.toLowerCase() === "na") return;
      const pts = parseFloat(raw);
      if (!isNaN(pts)) {
        entries.push({
          season, category,
          entity_type: entityType,
          entity_name: col0,
          show_name: show,
          points: pts,
        });
      }
    });
  }

  return { entries, season, showNames };
}

export default function HighPoints() {
  const [session, setSession] = useState(null);
  const [records, setRecords] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [season, setSeason] = useState("");
  const [activeCategory, setActiveCategory] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [tableError, setTableError] = useState(false);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [formError, setFormError] = useState("");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("high_points").select("*")
      .order("season", { ascending: false }).order("category").order("entity_name");

    if (error?.message?.includes("does not exist")) {
      setTableError(true); setLoading(false); return;
    }

    const rows = data ?? [];
    setRecords(rows);
    const computed = currentSeasonFromDate();
    const allSeasons = [...new Set(rows.map(r => r.season))].sort().reverse();
    // Always include the current season even if it has no data yet
    const withCurrent = allSeasons.includes(computed) ? allSeasons : [computed, ...allSeasons];
    setSeasons(withCurrent);
    // Default to current season, not just whatever is most recent in the DB
    setSeason(prev => prev || computed);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setField = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const closeModal = () => { setModal(null); setForm({}); setFormError(""); setImportError(""); };

  // ---- derived data ----
  const seasonRows = records.filter(r => !season || r.season === season);
  // Always show all canonical categories; append any extra ones found in the data.
  const dataCategories = [...new Set(seasonRows.map(r => r.category))];
  const allCategories = [
    ...CANONICAL_CATEGORIES,
    ...dataCategories.filter(c => !CANONICAL_CATEGORIES.includes(c)),
  ];
  const visibleCategories = filter === "horse"
    ? allCategories.filter(c => HORSE_CATEGORIES.has(c))
    : filter === "rider"
    ? allCategories.filter(c => !HORSE_CATEGORIES.has(c))
    : allCategories;

  const effectiveCategory = visibleCategories.includes(activeCategory)
    ? activeCategory : (visibleCategories[0] || "");

  // Build show_name → show_date map so labels and sort use the real event date.
  const showDateMap = {};
  seasonRows.forEach(r => { if (r.show_date && !showDateMap[r.show_name]) showDateMap[r.show_name] = r.show_date; });
  const allShowNames = sortShows([...new Set(seasonRows.map(r => r.show_name))], showDateMap);
  const catRows = seasonRows.filter(r => r.category === effectiveCategory);

  const buildLeaderboard = (rows) => {
    const map = {};
    rows.forEach(r => {
      if (!map[r.entity_name]) map[r.entity_name] = { type: r.entity_type, shows: {}, total: 0 };
      map[r.entity_name].shows[r.show_name] = (map[r.entity_name].shows[r.show_name] ?? 0) + r.points;
      map[r.entity_name].total += r.points;
    });
    return Object.entries(map)
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.total - a.total);
  };

  const leaderboard = buildLeaderboard(catRows);

  // ---- edit / add ----
  const openEdit = (entry) => {
    const showForm = {};
    allShowNames.forEach(s => { showForm["show__" + s] = String(entry.shows[s] ?? ""); });
    setForm({ name: entry.name, type: entry.type, ...showForm });
    setModal({ type: "edit", entry });
    setFormError("");
  };

  const openAdd = () => {
    const showForm = {};
    allShowNames.forEach(s => { showForm["show__" + s] = ""; });
    setForm({ name: "", type: HORSE_CATEGORIES.has(effectiveCategory) ? "horse" : "rider", ...showForm });
    setModal({ type: "add" });
    setFormError("");
  };

  const saveEntry = async () => {
    if (!form.name?.trim()) { setFormError("Name is required"); return; }
    const toInsert = [];
    allShowNames.forEach(show => {
      const raw = form["show__" + show];
      if (raw === "" || raw == null) return;
      const pts = parseFloat(raw);
      if (!isNaN(pts)) {
        toInsert.push({
          season, category: effectiveCategory,
          entity_type: form.type ?? "rider",
          entity_name: form.name.trim(),
          show_name: show, points: pts,
        });
      }
    });
    if (!toInsert.length) { setFormError("Enter at least one show result"); return; }

    if (modal.type === "edit") {
      await supabase.from("high_points").delete()
        .eq("season", season).eq("category", effectiveCategory).eq("entity_name", modal.entry.name);
    }

    const { error } = await supabase.from("high_points").insert(toInsert);
    if (error) { setFormError(error.message); return; }
    await load();
    closeModal();
  };

  const deleteEntry = async (entry) => {
    if (!window.confirm(`Remove all ${season} points for "${entry.name}" in ${effectiveCategory}?`)) return;
    await supabase.from("high_points").delete()
      .eq("season", season).eq("category", effectiveCategory).eq("entity_name", entry.name);
    await load();
  };

  // ---- CSV import ----
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(""); setImporting(true);
    try {
      const text = await file.text();
      const { entries, season: importedSeason } = parseHighPointsCSV(text);
      if (!entries.length) { setImportError("No data found in file."); setImporting(false); return; }

      // Deduplicate — if the same name+show appears twice, sum the points
      const dedupeMap = {};
      entries.forEach(e => {
        const key = `${e.season}||${e.category}||${e.entity_name}||${e.show_name}`;
        if (dedupeMap[key]) { dedupeMap[key].points += e.points; }
        else { dedupeMap[key] = { ...e }; }
      });
      const deduped = Object.values(dedupeMap);

      // Only delete records for the shows included in this CSV, preserving other shows' data
      const importedShows = [...new Set(deduped.map(e => e.show_name))];
      await supabase.from("high_points")
        .delete()
        .eq("season", importedSeason)
        .in("show_name", importedShows);
      const { error } = await supabase.from("high_points").upsert(deduped, { onConflict: "season,category,entity_name,show_name" });
      if (error) throw error;
      await load();
      setSeason(importedSeason);
      closeModal();
    } catch (err) {
      setImportError("Import failed: " + (err?.message ?? String(err)));
    } finally {
      setImporting(false);
    }
  };

  // ---- render: migration needed ----
  if (tableError) return (
    <main className="wrap" style={{ maxWidth: 640 }}>
      <h1 className="display" style={{ fontWeight: 700, fontSize: 24, margin: "0 0 12px" }}>High Points</h1>
      <div className="card" style={{ padding: 20 }}>
        <p style={{ color: "var(--clay)", fontWeight: 700, margin: "0 0 8px" }}>One-time database setup required</p>
        <p style={{ fontSize: 13.5, margin: "0 0 12px" }}>Go to <strong>Supabase → SQL Editor → New query</strong>, paste this, and click Run:</p>
        <pre style={{ background: "var(--sand)", border: "1px solid var(--line)", padding: 14, borderRadius: 8, fontSize: 12, overflowX: "auto", margin: 0 }}>{`create table high_points (
  id uuid primary key default gen_random_uuid(),
  season text not null,
  category text not null,
  entity_type text not null default 'rider',
  entity_name text not null,
  show_name text not null,
  points numeric not null default 0,
  created_at timestamptz default now(),
  unique(season, category, entity_name, show_name)
);
alter table high_points enable row level security;
create policy "public read high_points" on high_points
  for select using (true);
create policy "staff write high_points" on high_points
  for all to authenticated using (true) with check (true);
grant select on high_points to anon;
grant insert, update, delete on high_points to authenticated;`}</pre>
        <p style={{ fontSize: 12, color: "var(--quiet)", marginTop: 10, marginBottom: 0 }}>
          Also go to <strong>Supabase → Integrations → Data API → Exposed tables</strong> and enable <code>high_points</code>.
        </p>
      </div>
    </main>
  );

  if (loading) return <main className="wrap"><p style={{ color: "var(--quiet)" }}>Loading…</p></main>;

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
              <h1 className="display" style={{ fontWeight: 700, fontSize: "clamp(20px,4vw,28px)", margin: "0 0 2px", color: "#F2EADB" }}>
              High Points
              {seasons.length > 1 ? (
                <select value={season} onChange={e => { setSeason(e.target.value); setActiveCategory(""); }}
                  style={{ marginLeft: 10, background: "transparent", border: "none", color: "var(--brass-soft)", fontSize: 18, fontFamily: "inherit", cursor: "pointer" }}>
                  {seasons.map(s => {
                    const isCurrent = s === currentSeasonFromDate();
                    return <option key={s} value={s} style={{ color: "#241A12" }}>{s}{isCurrent ? " (current)" : " (archived)"}</option>;
                  })}
                </select>
              ) : season ? <span style={{ color: "var(--brass-soft)", fontSize: 18, marginLeft: 10 }}>{season}</span> : null}
            </h1>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {session && (
              <button className="btn-ghost" style={{ borderColor: "var(--brass-soft)", color: "var(--brass-soft)", background: "transparent", padding: "6px 12px" }}
                onClick={() => setModal({ type: "import" })}>
                ⇪ Import CSV
              </button>
            )}
            {!session && (
              <Link href="/coordinator" style={{ color: "var(--brass-soft)", fontSize: 13, textDecoration: "none" }}>Staff →</Link>
            )}
          </div>
        </div>
      </header>

      <main className="wrap">
        {!session && records.length > 0 && (
          <p style={{ fontSize: 12.5, color: "var(--quiet)", marginBottom: 12 }}>
            <Link href="/coordinator" style={{ color: "var(--brass)" }}>Sign in</Link> to add or edit results.
          </p>
        )}

        {/* Horse / Rider filter */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          {[["all", "All categories"], ["horse", "Horse points"], ["rider", "Rider points"]].map(([v, label]) => (
            <button key={v} onClick={() => { setFilter(v); setActiveCategory(""); }}
              style={{ border: "none", borderRadius: 20, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                background: filter === v ? "var(--leather)" : "var(--sand)",
                color: filter === v ? "#F2EADB" : "var(--quiet)" }}>
              {label}
            </button>
          ))}
        </div>

        {records.length === 0 && (
          <div className="card" style={{ padding: 24, textAlign: "center" }}>
            <p className="display" style={{ fontSize: 18, margin: 0, color: "var(--quiet)" }}>No high points data yet.</p>
            {session && <p style={{ fontSize: 13.5, color: "var(--quiet)", marginTop: 8, marginBottom: 0 }}>Use "⇪ Import CSV" to load your existing spreadsheet.</p>}
          </div>
        )}

        {records.length > 0 && seasonRows.length === 0 && (
          <div className="card" style={{ padding: 24, textAlign: "center" }}>
            <p className="display" style={{ fontSize: 18, margin: "0 0 8px", color: "var(--quiet)" }}>No results yet for the {season} season.</p>
            <p style={{ fontSize: 13.5, color: "var(--quiet)", margin: 0 }}>
              The season runs August to July. {session ? <>Use "⇪ Import CSV" or the + Add button to record the first results.</> : <>Check back once results have been entered.</>}
            </p>
          </div>
        )}

        {visibleCategories.length > 0 && (
          <>
            {/* Category tabs */}
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 16, WebkitOverflowScrolling: "touch" }}>
              {visibleCategories.map(cat => (
                <button key={cat} onClick={() => setActiveCategory(cat)}
                  style={{ whiteSpace: "nowrap", border: "none", borderRadius: 20, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0,
                    background: effectiveCategory === cat ? "var(--brass)" : "var(--sand)",
                    color: effectiveCategory === cat ? "#fff" : "var(--ink)" }}>
                  {cat}
                </button>
              ))}
            </div>

            {/* Leaderboard */}
            <section className="card">
              <div className="card-head">
                <div>
                  <div className="display" style={{ fontWeight: 700, fontSize: 17 }}>{effectiveCategory}</div>
                  <div style={{ fontSize: 12, color: "var(--quiet)", marginTop: 2 }}>
                    {HORSE_CATEGORIES.has(effectiveCategory) ? "Horse" : "Rider"} points · 3+ entries: 1st=3, 2nd=2, 3rd=1 · 2 entries: 1st=2, 2nd=1 · 1 entry: 1pt · per judge
                  </div>
                </div>
                {session && <button className="btn-ghost" onClick={openAdd}>+ Add</button>}
              </div>

              {leaderboard.length === 0 ? (
                <p style={{ padding: "16px", color: "var(--quiet)", margin: 0 }}>No results recorded for this category yet.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 44 }}>Rank</th>
                        <th>{HORSE_CATEGORIES.has(effectiveCategory) ? "Horse" : "Exhibitor"}</th>
                        {allShowNames.map(s => (
                          <th key={s} title={s} style={{ textAlign: "right", whiteSpace: "nowrap", fontSize: 10, minWidth: 52 }}>
                            {showLabel(s, season, showDateMap[s])}
                          </th>
                        ))}
                        <th style={{ textAlign: "right", minWidth: 56 }}>Total</th>
                        {session && <th style={{ width: 1 }}></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((entry, i) => (
                        <tr key={entry.name} style={i === 0 ? { background: "#FBF4E4" } : {}}>
                          <td className="display" style={{ fontWeight: 700, color: i === 0 ? "var(--brass)" : "var(--quiet)" }}>{i + 1}</td>
                          <td style={{ fontWeight: 600 }}>{entry.name}</td>
                          {allShowNames.map(s => (
                            <td key={s} style={{ textAlign: "right", color: entry.shows[s] != null ? "var(--ink)" : "var(--line)" }}>
                              {entry.shows[s] != null ? entry.shows[s] : "—"}
                            </td>
                          ))}
                          <td className="display" style={{ textAlign: "right", fontWeight: 700, color: "var(--brass)", fontSize: 18 }}>
                            {entry.total}
                          </td>
                          {session && (
                            <td style={{ whiteSpace: "nowrap" }}>
                              <span style={{ display: "inline-flex", gap: 4 }}>
                                <button className="btn-ghost" onClick={() => openEdit(entry)}>Edit</button>
                                <button className="btn-ghost danger" onClick={() => deleteEntry(entry)}>✕</button>
                              </span>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {modal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="modal-sheet">

            {(modal.type === "add" || modal.type === "edit") && (
              <>
                <h2 className="display modal-title">{modal.type === "add" ? "Add entry" : "Edit entry"}</h2>
                <p style={{ marginTop: 0, fontSize: 13, color: "var(--quiet)" }}>{effectiveCategory} · {season}</p>

                <label className="modal-label">{HORSE_CATEGORIES.has(effectiveCategory) ? "Horse name" : "Exhibitor name"} *</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }}
                  value={form.name ?? ""}
                  onChange={setField("name")}
                  disabled={modal.type === "edit"}
                  placeholder={HORSE_CATEGORIES.has(effectiveCategory) ? "e.g. Machine Made Lady" : "e.g. Chey McCarty"}
                  autoFocus={modal.type === "add"} />
                {modal.type === "edit" && (
                  <p style={{ fontSize: 12, color: "var(--quiet)", margin: "4px 0 0" }}>To rename, delete this entry and add a new one.</p>
                )}

                <label className="modal-label">Points per show</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
                  {allShowNames.map(show => (
                    <div key={show}>
                      <label style={{ fontSize: 11.5, color: "var(--quiet)", display: "block", marginBottom: 4 }}>
                        {showLabel(show, season, showDateMap[show])}
                      </label>
                      <input className="field" type="number" step="0.5" min="0"
                        style={{ width: "100%", fontSize: 15 }}
                        value={form["show__" + show] ?? ""}
                        onChange={setField("show__" + show)}
                        placeholder="—" />
                    </div>
                  ))}
                </div>

                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={saveEntry}>Save</button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                </div>
              </>
            )}

            {modal.type === "import" && (
              <>
                <h2 className="display modal-title">Import high points CSV</h2>
                <p style={{ marginTop: 0, fontSize: 13.5, color: "var(--quiet)" }}>
                  Upload your high points spreadsheet saved as CSV. The season year is read from the title row (e.g. "2025-2026 HCQHA High Points").
                  <strong style={{ color: "var(--ink)" }}> This will replace all existing data for that season.</strong>
                </p>
                <input type="file" accept=".csv" onChange={handleImportFile} style={{ marginBottom: 8 }} />
                {importing && <p style={{ color: "var(--quiet)", fontSize: 13 }}>Importing…</p>}
                {importError && <p className="modal-error">{importError}</p>}
                <button className="btn-ghost" style={{ marginTop: 8 }} onClick={closeModal}>Cancel</button>
              </>
            )}

          </div>
        </div>
      )}
    </>
  );
}
