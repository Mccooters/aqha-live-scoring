"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

const fmtBack = (n) => String(n).padStart(3, "0");

const RIDER_CATEGORIES = [
  "Open", "Amateur", "Novice Amateur", "Select", "Beginner", "Youth", "EWD", "Leadline", "Non Pro",
];

const HORSE_ALIASES = {
  back_number: ["back no", "back#", "back number", "back num", "backnumber", "backno", "back"],
  name: ["horse", "horse name", "name", "horsename"],
  owner: ["owner", "owner name", "registered owner", "registeredowner"],
  club: ["club", "association", "body"],
  registration_number: ["reg no", "registration", "registration number", "reg number", "regno", "reg#"],
};

function mapHorseHeader(h) {
  const n = String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
  for (const [field, aliases] of Object.entries(HORSE_ALIASES)) {
    if (aliases.includes(n)) return field;
  }
  return null;
}

export default function Registry() {
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState("horses");

  // ---- horses ----
  const [horses, setHorses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // ---- riders ----
  const [riders, setRiders] = useState([]);
  const [ridersLoading, setRidersLoading] = useState(false);
  const [riderSearch, setRiderSearch] = useState("");
  const [ridersError, setRidersError] = useState("");

  // ---- shared modal ----
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [formError, setFormError] = useState("");

  // ---- horse import ----
  const [importRows, setImportRows] = useState(null);
  const [importWarnings, setImportWarnings] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importError, setImportError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---- load horses ----
  const loadHorses = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("horses")
      .select("*, horse_registrations(*)")
      .order("back_number");
    setHorses(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { loadHorses(); }, [loadHorses]);

  // ---- load riders ----
  const loadRiders = useCallback(async () => {
    setRidersLoading(true);
    setRidersError("");
    const { data, error } = await supabase.from("riders").select("*").order("name");
    if (error) {
      setRidersError(error.message.includes("does not exist") || error.message.includes("relation")
        ? "The riders table hasn't been set up yet. Run supabase/schema-v4-riders.sql in your Supabase SQL Editor, then expose the riders table in Data API settings."
        : error.message);
    }
    setRiders(data ?? []);
    setRidersLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "riders") loadRiders();
  }, [tab, loadRiders]);

  // ---- modal helpers ----
  const openModal = (type, entity = null) => {
    if (type === "rider") {
      setModal({ type, rider: entity });
      setForm(entity
        ? { name: entity.name, member_number: entity.member_number ?? "", category: entity.category ?? "", notes: entity.notes ?? "" }
        : { name: "", member_number: "", category: "", notes: "" });
    } else if (type === "horse") {
      setModal({ type, horse: entity });
      setForm(entity ? { back_number: String(entity.back_number), name: entity.name, owner: entity.owner ?? "" } : {});
    } else if (type === "reg") {
      setModal({ type, horse: entity });
      setForm({});
    } else if (type === "import") {
      setModal({ type });
    }
    setFormError("");
  };
  const closeModal = () => { setModal(null); setForm({}); setFormError(""); };
  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // ---- horse CRUD ----
  const submitHorse = async () => {
    if (!form.back_number || !form.name?.trim()) { setFormError("Back number and horse name are required"); return; }
    const back = parseInt(form.back_number, 10);
    if (isNaN(back)) { setFormError("Back number must be a whole number"); return; }
    if (modal.horse) {
      await supabase.from("horses").update({ name: form.name.trim(), owner: form.owner?.trim() || null }).eq("id", modal.horse.id);
    } else {
      const { error } = await supabase.from("horses").insert({ back_number: back, name: form.name.trim(), owner: form.owner?.trim() || null });
      if (error) { setFormError(error.message.includes("unique") ? "A horse with this back number is already registered." : error.message); return; }
    }
    await loadHorses();
    closeModal();
  };

  const submitReg = async () => {
    if (!form.club?.trim()) { setFormError("Club name is required"); return; }
    const { error } = await supabase.from("horse_registrations").upsert(
      { horse_id: modal.horse.id, club: form.club.trim(), registration_number: form.reg_number?.trim() || null },
      { onConflict: "horse_id,club" }
    );
    if (error) { setFormError(error.message); return; }
    await loadHorses();
    closeModal();
  };

  const deleteReg = async (regId) => {
    await supabase.from("horse_registrations").delete().eq("id", regId);
    await loadHorses();
  };

  // ---- rider CRUD ----
  const submitRider = async () => {
    if (!form.name?.trim()) { setFormError("Rider name is required"); return; }
    const payload = {
      name: form.name.trim(),
      member_number: form.member_number?.trim() || null,
      category: form.category?.trim() || null,
      notes: form.notes?.trim() || null,
    };
    if (modal.rider) {
      const { error } = await supabase.from("riders").update(payload).eq("id", modal.rider.id);
      if (error) { setFormError(error.message); return; }
    } else {
      const { error } = await supabase.from("riders").insert(payload);
      if (error) { setFormError(error.message); return; }
    }
    await loadRiders();
    closeModal();
  };

  const deleteRider = async (id) => {
    if (!confirm("Remove this rider from the registry?")) return;
    await supabase.from("riders").delete().eq("id", id);
    await loadRiders();
  };

  // ---- horse import ----
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError("");
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
      if (raw.length < 2) { setImportError("Spreadsheet appears to be empty."); return; }

      const headers = raw[0].map(mapHorseHeader);
      const parsed = [];
      const warns = [];

      raw.slice(1).forEach((row, i) => {
        const obj = {};
        headers.forEach((field, j) => { if (field) obj[field] = String(row[j] ?? "").trim(); });
        if (!obj.back_number && !obj.name) return;
        if (!obj.back_number) { warns.push(`Row ${i + 2}: missing back number — skipped`); return; }
        if (!obj.name) { warns.push(`Row ${i + 2}: missing horse name — skipped`); return; }
        const back = parseInt(obj.back_number, 10);
        if (isNaN(back)) { warns.push(`Row ${i + 2}: back number "${obj.back_number}" is not a number — skipped`); return; }
        parsed.push({ back_number: back, name: obj.name, owner: obj.owner || null, club: obj.club || null, registration_number: obj.registration_number || null });
      });

      setImportRows(parsed);
      setImportWarnings(warns);
    } catch (err) {
      setImportError("Could not read file: " + (err?.message ?? String(err)));
    }
  };

  const commitImport = async () => {
    if (!importRows?.length) return;
    setImporting(true);
    try {
      const byBack = {};
      importRows.forEach((r) => {
        if (!byBack[r.back_number]) byBack[r.back_number] = { ...r, regs: [] };
        if (r.club) byBack[r.back_number].regs.push({ club: r.club, registration_number: r.registration_number });
      });

      for (const horse of Object.values(byBack)) {
        const { data: h, error: hErr } = await supabase
          .from("horses")
          .upsert({ back_number: horse.back_number, name: horse.name, owner: horse.owner }, { onConflict: "back_number" })
          .select().single();
        if (hErr) throw hErr;
        for (const reg of horse.regs) {
          await supabase.from("horse_registrations").upsert(
            { horse_id: h.id, club: reg.club, registration_number: reg.registration_number },
            { onConflict: "horse_id,club" }
          );
        }
      }

      setImportDone(true);
      await loadHorses();
    } catch (err) {
      setImportError(err.message ?? "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  // ---- filtered lists ----
  const filteredHorses = search.trim()
    ? horses.filter((h) => h.name.toLowerCase().includes(search.toLowerCase()) || String(h.back_number).includes(search) || (h.owner ?? "").toLowerCase().includes(search.toLowerCase()))
    : horses;

  const filteredRiders = riderSearch.trim()
    ? riders.filter((r) => r.name.toLowerCase().includes(riderSearch.toLowerCase()) || (r.member_number ?? "").toLowerCase().includes(riderSearch.toLowerCase()) || (r.category ?? "").toLowerCase().includes(riderSearch.toLowerCase()))
    : riders;

  const tabStyle = (t) => ({
    padding: "9px 20px",
    fontFamily: "'Archivo', sans-serif",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    cursor: "pointer",
    border: "none",
    background: "none",
    color: tab === t ? "var(--leather)" : "var(--quiet)",
    borderBottom: tab === t ? "2.5px solid var(--brass)" : "2.5px solid transparent",
    marginBottom: -1,
  });

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>Registry</div>
            <h1 className="display" style={{ fontWeight: 700, fontSize: 22, margin: "2px 0", color: "#F2EADB" }}>
              {tab === "horses" ? "Horse Registry" : "Rider Registry"}
            </h1>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {session && tab === "horses" && (
              <>
                <button className="btn-ghost" style={{ borderColor: "var(--brass-soft)", color: "var(--brass-soft)", background: "transparent", padding: "6px 12px" }}
                  onClick={() => { setImportRows(null); setImportDone(false); setImportError(""); openModal("import"); }}>
                  ⇪ Import
                </button>
                <button className="btn-ghost" style={{ borderColor: "var(--brass-soft)", color: "var(--brass-soft)", background: "transparent", padding: "6px 12px" }}
                  onClick={() => openModal("horse")}>
                  + Add horse
                </button>
              </>
            )}
            {session && tab === "riders" && (
              <button className="btn-ghost" style={{ borderColor: "var(--brass-soft)", color: "var(--brass-soft)", background: "transparent", padding: "6px 12px" }}
                onClick={() => openModal("rider")}>
                + Add rider
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Tab switcher */}
      <div style={{ background: "var(--paper)", borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex" }}>
          <button style={tabStyle("horses")} onClick={() => setTab("horses")}>Horses</button>
          <button style={tabStyle("riders")} onClick={() => setTab("riders")}>Riders</button>
        </div>
      </div>

      <main className="wrap">
        {!session && (
          <p style={{ fontSize: 13, color: "var(--quiet)", marginBottom: 16 }}>
            Read-only view. <Link href="/coordinator" style={{ color: "var(--brass)" }}>Sign in as staff</Link> to add or edit records.
          </p>
        )}

        {/* ===== HORSES TAB ===== */}
        {tab === "horses" && (
          <>
            <input className="field" style={{ width: "100%", fontSize: 15, marginBottom: 16 }}
              placeholder="Search by back number, name, or owner…"
              value={search} onChange={(e) => setSearch(e.target.value)} />

            {loading && <p style={{ color: "var(--quiet)" }}>Loading…</p>}

            {!loading && filteredHorses.length === 0 && (
              <p style={{ color: "var(--quiet)" }}>
                {search ? "No horses match your search." : `No horses registered yet.${session ? ' Click "+ Add horse" to get started.' : ""}`}
              </p>
            )}

            {filteredHorses.length > 0 && (
              <section className="card">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}>Back #</th>
                      <th>Horse</th>
                      <th>Owner</th>
                      <th>Club registrations</th>
                      {session && <th style={{ width: 1 }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHorses.map((h) => (
                      <tr key={h.id}>
                        <td className="display" style={{ fontWeight: 700, color: "var(--brass)" }}>#{fmtBack(h.back_number)}</td>
                        <td style={{ fontWeight: 600 }}>{h.name}</td>
                        <td style={{ color: "var(--quiet)" }}>{h.owner ?? "—"}</td>
                        <td>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            {h.horse_registrations?.map((r) => (
                              <span key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--sand)", border: "1px solid var(--line)", borderRadius: 20, padding: "2px 9px", fontSize: 12 }}>
                                <strong>{r.club}</strong>{r.registration_number ? ` · ${r.registration_number}` : ""}
                                {session && (
                                  <button onClick={() => deleteReg(r.id)} aria-label="Remove registration"
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--clay)", fontSize: 11, padding: "0 2px", lineHeight: 1 }}>✕</button>
                                )}
                              </span>
                            ))}
                            {session && (
                              <button className="btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => openModal("reg", h)}>+ Club</button>
                            )}
                            {!h.horse_registrations?.length && !session && <span style={{ color: "var(--quiet)", fontSize: 13 }}>—</span>}
                          </div>
                        </td>
                        {session && (
                          <td><button className="btn-ghost" onClick={() => openModal("horse", h)}>Edit</button></td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            <p style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 4 }}>
              {horses.length} horse{horses.length !== 1 ? "s" : ""} registered
            </p>
          </>
        )}

        {/* ===== RIDERS TAB ===== */}
        {tab === "riders" && (
          <>
            {ridersError ? (
              <div style={{ background: "#FFF8EC", border: "1px solid var(--brass)", borderRadius: 10, padding: "16px 18px", fontSize: 13.5, color: "var(--leather)" }}>
                <strong>Setup required:</strong> {ridersError}
              </div>
            ) : (
              <>
                <input className="field" style={{ width: "100%", fontSize: 15, marginBottom: 16 }}
                  placeholder="Search by name, member number, or category…"
                  value={riderSearch} onChange={(e) => setRiderSearch(e.target.value)} />

                {ridersLoading && <p style={{ color: "var(--quiet)" }}>Loading…</p>}

                {!ridersLoading && filteredRiders.length === 0 && (
                  <p style={{ color: "var(--quiet)" }}>
                    {riderSearch ? "No riders match your search." : `No riders registered yet.${session ? ' Click "+ Add rider" to get started.' : ""}`}
                  </p>
                )}

                {filteredRiders.length > 0 && (
                  <section className="card">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Member #</th>
                          <th>Category</th>
                          <th>Notes</th>
                          {session && <th style={{ width: 1 }}></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRiders.map((r) => (
                          <tr key={r.id}>
                            <td style={{ fontWeight: 600 }}>{r.name}</td>
                            <td style={{ color: "var(--quiet)", fontFamily: "monospace" }}>{r.member_number ?? "—"}</td>
                            <td>
                              {r.category ? (
                                <span style={{ background: "var(--sand)", border: "1px solid var(--line)", borderRadius: 20, padding: "2px 9px", fontSize: 12, fontWeight: 600 }}>
                                  {r.category}
                                </span>
                              ) : <span style={{ color: "var(--quiet)" }}>—</span>}
                            </td>
                            <td style={{ color: "var(--quiet)", fontSize: 13 }}>{r.notes ?? "—"}</td>
                            {session && (
                              <td style={{ display: "flex", gap: 6 }}>
                                <button className="btn-ghost" onClick={() => openModal("rider", r)}>Edit</button>
                                <button className="btn-ghost" style={{ color: "var(--clay)", borderColor: "var(--clay)" }} onClick={() => deleteRider(r.id)}>Delete</button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}

                <p style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 4 }}>
                  {riders.length} rider{riders.length !== 1 ? "s" : ""} registered
                </p>
              </>
            )}
          </>
        )}
      </main>

      {/* ===== MODALS ===== */}
      {modal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="modal-sheet">

            {modal.type === "horse" && (
              <>
                <h2 className="display modal-title">{modal.horse ? "Edit horse" : "Add horse"}</h2>
                <label className="modal-label">Back number *</label>
                <input className="field" type="number" style={{ width: "100%", fontSize: 16 }}
                  value={form.back_number ?? ""} onChange={setField("back_number")}
                  placeholder="e.g. 301" disabled={!!modal.horse} />
                {modal.horse && <p style={{ fontSize: 12, color: "var(--quiet)", margin: "4px 0 0" }}>Back numbers are permanent and cannot be changed.</p>}
                <label className="modal-label">Horse name *</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.name ?? ""} onChange={setField("name")} placeholder="e.g. Machine Made Lady" />
                <label className="modal-label">Owner</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.owner ?? ""} onChange={setField("owner")} placeholder="e.g. J. Santos" />
                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={submitHorse}>{modal.horse ? "Save changes" : "Add horse"}</button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                </div>
              </>
            )}

            {modal.type === "reg" && (
              <>
                <h2 className="display modal-title">Add club registration</h2>
                <p style={{ marginTop: 0, color: "var(--quiet)", fontSize: 13 }}>#{fmtBack(modal.horse?.back_number ?? 0)} {modal.horse?.name}</p>
                <label className="modal-label">Club / association *</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.club ?? ""} onChange={setField("club")} placeholder="e.g. AQHA · PHAA Paint" />
                <label className="modal-label">Registration number</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.reg_number ?? ""} onChange={setField("reg_number")} placeholder="e.g. 1234567" />
                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={submitReg}>Save registration</button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                </div>
              </>
            )}

            {modal.type === "rider" && (
              <>
                <h2 className="display modal-title">{modal.rider ? "Edit rider" : "Add rider"}</h2>
                <label className="modal-label">Name *</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.name ?? ""} onChange={setField("name")} placeholder="e.g. Sarah O'Brien" />
                <label className="modal-label">Member number</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.member_number ?? ""} onChange={setField("member_number")} placeholder="e.g. 12345" />
                <label className="modal-label">Category</label>
                <select className="field" style={{ width: "100%", fontSize: 16 }} value={form.category ?? ""} onChange={setField("category")}>
                  <option value="">— Select category —</option>
                  {RIDER_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <label className="modal-label">Notes</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.notes ?? ""} onChange={setField("notes")} placeholder="e.g. Junior rider, second year" />
                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={submitRider}>{modal.rider ? "Save changes" : "Add rider"}</button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                </div>
              </>
            )}

            {modal.type === "import" && (
              <>
                <h2 className="display modal-title">Import horses</h2>
                {importDone ? (
                  <>
                    <p style={{ color: "var(--green)", fontWeight: 700 }}>✓ Import complete.</p>
                    <button className="btn" style={{ background: "var(--leather)", marginTop: 8 }} onClick={closeModal}>Done</button>
                  </>
                ) : !importRows ? (
                  <>
                    <p style={{ marginTop: 0, fontSize: 13.5, color: "var(--quiet)" }}>
                      Upload an .xlsx or .csv. Columns: Back No, Horse Name, Owner, Club, Registration Number.
                      One row per club registration (a horse with 2 clubs = 2 rows).{" "}
                      <a href="/horse-registry-template.xlsx" download style={{ color: "var(--brass)", fontWeight: 700 }}>
                        Download template
                      </a>
                    </p>
                    <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} />
                    {importError && <p className="modal-error">{importError}</p>}
                    <button className="btn-ghost" style={{ marginTop: 12 }} onClick={closeModal}>Cancel</button>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: 13, color: "var(--quiet)" }}>{importRows.length} rows ready.</p>
                    {importWarnings.length > 0 && (
                      <div style={{ background: "#FFF8EC", border: "1px solid var(--brass)", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
                        <strong>Warnings:</strong>
                        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{importWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                      </div>
                    )}
                    <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, marginBottom: 12 }}>
                      <table>
                        <thead><tr><th>Back</th><th>Horse</th><th>Club</th></tr></thead>
                        <tbody>
                          {importRows.slice(0, 40).map((r, i) => (
                            <tr key={i}>
                              <td style={{ color: "var(--quiet)" }}>#{r.back_number}</td>
                              <td style={{ fontWeight: 600 }}>{r.name}</td>
                              <td style={{ color: "var(--quiet)", fontSize: 12 }}>{r.club ?? "—"}</td>
                            </tr>
                          ))}
                          {importRows.length > 40 && <tr><td colSpan={3} style={{ color: "var(--quiet)", textAlign: "center" }}>…and {importRows.length - 40} more</td></tr>}
                        </tbody>
                      </table>
                    </div>
                    {importError && <p className="modal-error">{importError}</p>}
                    <div style={{ display: "flex", gap: 10 }}>
                      <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={commitImport} disabled={importing}>
                        {importing ? "Importing…" : `Commit ${importRows.length} rows`}
                      </button>
                      <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={() => { setImportRows(null); setImportWarnings([]); setImportError(""); }}>Back</button>
                    </div>
                  </>
                )}
              </>
            )}

          </div>
        </div>
      )}
    </>
  );
}
