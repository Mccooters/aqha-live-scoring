"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import ImportEntries from "./ImportEntries";

const firstPending = (entries) =>
  entries.find((e) => e.score == null && !e.scratched) ?? null;

// Points scale: max(0, competing_entries - placing).
// With 5 entries: 1st=4pts, 2nd=3pts, 3rd=2pts, 4th=1pt, 5th=0pts.
// Verify this against the current AQHA Australia rule book before use.
function calcPoints(placing, competingEntries) {
  if (competingEntries < 2) return 0;
  return Math.max(0, competingEntries - placing);
}

async function triggerPush(title, body, tag) {
  try { await supabase.functions.invoke("send-push", { body: { title, body, tag } }); } catch {}
}

export default function Coordinator() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState(null);
  const [classes, setClasses] = useState([]);

  const [scoreInput, setScoreInput] = useState("");
  const [busy, setBusy] = useState(false);

  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [formError, setFormError] = useState("");
  const [exporting, setExporting] = useState(false);

  // ---- auth ----
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async () => {
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
  };

  // ---- data ----
  const loadEvents = useCallback(async () => {
    const { data } = await supabase.from("events").select("*").order("starts_on", { ascending: false });
    setEvents(data ?? []);
    if (data?.length && !eventId) setEventId(data.find((e) => e.status === "live")?.id ?? data[0].id);
  }, [eventId]);

  const loadClasses = useCallback(async () => {
    if (!eventId) return;
    const { data } = await supabase
      .from("classes").select("*, entries(*)").eq("event_id", eventId).order("sort_order");
    if (data) {
      data.forEach((c) => c.entries.sort((a, b) => a.draw_order - b.draw_order));
      setClasses(data);
    }
  }, [eventId]);

  useEffect(() => { if (session) loadEvents(); }, [session, loadEvents]);
  useEffect(() => {
    if (!session || !eventId) return;
    loadClasses();
    const channel = supabase
      .channel(`coord-${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "entries" }, loadClasses)
      .on("postgres_changes", { event: "*", schema: "public", table: "classes" }, loadClasses)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, eventId, loadClasses]);

  const liveClass = classes.find((c) => c.status === "live");
  const current = liveClass ? firstPending(liveClass.entries) : null;
  const currentEvent = events.find((e) => e.id === eventId);

  // ---- scoring actions ----
  const saveScore = async () => {
    const val = parseFloat(scoreInput);
    if (isNaN(val) || !current || busy) return;
    setBusy(true);
    await supabase.from("entries").update({ score: val }).eq("id", current.id);
    const remaining = liveClass.entries.filter((e) => e.id !== current.id && e.score == null && !e.scratched);
    if (remaining.length === 0) {
      await completeClass(liveClass);
    } else {
      const next = remaining[0];
      triggerPush(`Now showing: #${next.back_number} ${next.horse}`, `Class ${liveClass.num} · ${liveClass.name}`, "now-showing");
    }
    setScoreInput("");
    setBusy(false);
  };

  const toggleScratch = async (entry) => {
    await supabase.from("entries").update({ scratched: !entry.scratched }).eq("id", entry.id);
    if (!entry.scratched) {
      triggerPush(`Scratch: #${entry.back_number} ${entry.horse}`, "This entry has been scratched.", "scratch");
      if (liveClass) {
        const remaining = liveClass.entries.filter((e) => e.id !== entry.id && e.score == null && !e.scratched);
        if (remaining.length === 0) await completeClass(liveClass);
      }
    }
  };

  const movePending = async (cls, entry, dir) => {
    const pending = cls.entries.filter((e) => e.score == null && !e.scratched);
    const pos = pending.findIndex((e) => e.id === entry.id);
    const other = pending[pos + dir];
    if (!other) return;
    await Promise.all([
      supabase.from("entries").update({ draw_order: other.draw_order }).eq("id", entry.id),
      supabase.from("entries").update({ draw_order: entry.draw_order }).eq("id", other.id),
    ]);
  };

  const startClass = async (cls) => {
    if (liveClass) await supabase.from("classes").update({ status: "completed" }).eq("id", liveClass.id);
    await supabase.from("classes").update({ status: "live" }).eq("id", cls.id);
    const next = firstPending(cls.entries);
    if (next) triggerPush(`Now showing: #${next.back_number} ${next.horse}`, `Class ${cls.num} · ${cls.name}`, "now-showing");
  };

  const completeClass = async (cls) => {
    await supabase.from("classes").update({ status: "completed" }).eq("id", cls.id);
    const placed = [...cls.entries].filter((e) => e.score != null && !e.scratched).sort((a, b) => b.score - a.score);
    if (placed.length > 0) {
      triggerPush(
        `Class ${cls.num} complete — ${cls.name}`,
        `1st: #${placed[0].back_number} ${placed[0].horse}${placed[0].score != null ? ` (${placed[0].score})` : ""}`,
        "results"
      );
    }
    const nextUp = classes.find((c) => c.status === "upcoming" && c.id !== cls.id);
    if (nextUp) {
      await supabase.from("classes").update({ status: "live" }).eq("id", nextUp.id);
      const nextEntry = firstPending(nextUp.entries);
      if (nextEntry) triggerPush(`Now showing: #${nextEntry.back_number} ${nextEntry.horse}`, `Class ${nextUp.num} · ${nextUp.name}`, "now-showing");
    }
  };

  const moveClass = async (cls, dir) => {
    const upcoming = classes.filter((c) => c.status === "upcoming");
    const pos = upcoming.findIndex((c) => c.id === cls.id);
    const other = upcoming[pos + dir];
    if (!other) return;
    await Promise.all([
      supabase.from("classes").update({ sort_order: other.sort_order }).eq("id", cls.id),
      supabase.from("classes").update({ sort_order: cls.sort_order }).eq("id", other.id),
    ]);
  };

  const endEvent = async () => {
    if (!window.confirm("Mark this event as completed? This cannot be undone.")) return;
    await supabase.from("events").update({ status: "completed" }).eq("id", eventId);
    await loadEvents();
  };

  // ---- modal ----
  const openModal = (type, extra = {}) => {
    let initialForm = {};
    if (type === "pattern" && extra.classId) {
      const cls = classes.find((c) => c.id === extra.classId);
      initialForm = { pattern_url: cls?.pattern_url ?? "" };
    }
    setModal({ type, ...extra });
    setForm(initialForm);
    setFormError("");
  };
  const closeModal = () => { setModal(null); setForm({}); setFormError(""); };
  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submitEvent = async () => {
    if (!form.name?.trim()) { setFormError("Event name is required"); return; }
    const { data, error } = await supabase.from("events")
      .insert({ name: form.name.trim(), location: form.location ?? "", starts_on: form.starts || null, ends_on: form.ends || form.starts || null, status: form.status ?? "live" })
      .select().single();
    if (error) { setFormError(error.message); return; }
    await loadEvents();
    if (data) setEventId(data.id);
    closeModal();
  };

  const submitClass = async () => {
    if (!form.num || !form.name?.trim()) { setFormError("Class number and name are required"); return; }
    const maxOrder = Math.max(0, ...classes.map((c) => c.sort_order));
    const { error } = await supabase.from("classes").insert({
      event_id: eventId,
      num: parseInt(form.num, 10),
      name: form.name.trim(),
      judge: form.judge ?? "",
      pattern_url: form.pattern_url?.trim() || null,
      sort_order: maxOrder + 1,
      day: parseInt(form.day ?? "1", 10) || 1,
    });
    if (error) {
      const msg = error.message?.includes("day") ? 'Database migration needed. Please run "schema-v2-horses.sql" in your Supabase SQL Editor first.' : error.message;
      setFormError(msg);
      return;
    }
    closeModal();
  };

  const submitEntry = async () => {
    if (!form.back || !form.horse?.trim() || !form.exhibitor?.trim()) {
      setFormError("Back number, horse, and exhibitor are required");
      return;
    }
    const cls = classes.find((c) => c.id === modal.classId);
    if (!cls) return;
    const maxDraw = Math.max(0, ...cls.entries.map((e) => e.draw_order));
    await supabase.from("entries").insert({
      class_id: cls.id,
      back_number: parseInt(form.back, 10),
      horse: form.horse.trim(),
      exhibitor: form.exhibitor.trim(),
      draw_order: maxDraw + 1,
    });
    closeModal();
  };

  const submitPattern = async () => {
    if (!form.pattern_url?.trim() && !form.patternFile) { setFormError("Provide a URL or upload a file"); return; }
    let url = form.pattern_url?.trim() || null;
    if (form.patternFile) {
      const file = form.patternFile;
      const path = `${eventId}/${modal.classId}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("patterns").upload(path, file, { upsert: true });
      if (upErr) {
        const msg = upErr.message?.toLowerCase() ?? "";
        setFormError(msg.includes("not found") || msg.includes("bucket")
          ? 'Storage not configured. Create a "patterns" bucket in Supabase Storage (Dashboard → Storage → New bucket, name: patterns, Public: on), or paste a URL instead.'
          : upErr.message);
        return;
      }
      const { data: urlData } = supabase.storage.from("patterns").getPublicUrl(path);
      url = urlData.publicUrl;
    }
    await supabase.from("classes").update({ pattern_url: url }).eq("id", modal.classId);
    closeModal();
  };

  // ---- export ----
  const exportResults = async () => {
    if (!currentEvent) return;
    setExporting(true);
    try {
      const XLSX = (await import("xlsx")).default;

      const { data: entries } = await supabase.from("entries")
        .select("*").in("class_id", classes.map((c) => c.id));
      const backNums = [...new Set((entries ?? []).map((e) => e.back_number))];
      const { data: horses } = backNums.length
        ? await supabase.from("horses").select("back_number, horse_registrations(club, registration_number)").in("back_number", backNums)
        : { data: [] };
      const horseMap = Object.fromEntries((horses ?? []).map((h) => [h.back_number, h]));

      const wb = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ["Event", currentEvent.name],
        ["Location", currentEvent.location ?? ""],
        ["Dates", `${currentEvent.starts_on ?? ""}${currentEvent.ends_on && currentEvent.ends_on !== currentEvent.starts_on ? " – " + currentEvent.ends_on : ""}`],
        ["Status", currentEvent.status],
        ["Exported", new Date().toLocaleString("en-AU")],
      ]), "Event");

      // Results sheet
      const resRows = [["Class #", "Class Name", "Judge", "Placing", "Back #", "Horse", "Exhibitor", "Score", "Entries in Class", "Registrations"]];
      classes.forEach((cls) => {
        const ce = (entries ?? []).filter((e) => e.class_id === cls.id);
        const competing = ce.filter((e) => !e.scratched).length;
        const placed = ce.filter((e) => e.score != null && !e.scratched).sort((a, b) => b.score - a.score);
        const scratched = ce.filter((e) => e.scratched);
        placed.forEach((e, i) => {
          const regs = (horseMap[e.back_number]?.horse_registrations ?? []).map((r) => `${r.club}${r.registration_number ? " " + r.registration_number : ""}`).join(", ");
          resRows.push([cls.num, cls.name, cls.judge ?? "", i + 1, e.back_number, e.horse, e.exhibitor, e.score, competing, regs]);
        });
        scratched.forEach((e) => resRows.push([cls.num, cls.name, cls.judge ?? "", "SCR", e.back_number, e.horse, e.exhibitor, "", competing, ""]));
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resRows), "Results");

      // Club Points sheet — one row per placing per club registration
      const ptRows = [["Class #", "Class Name", "Placing", "Back #", "Horse", "Exhibitor", "Score", "Entries in Class", "Points", "Club", "Registration #"]];
      classes.forEach((cls) => {
        const ce = (entries ?? []).filter((e) => e.class_id === cls.id);
        const competing = ce.filter((e) => !e.scratched).length;
        const placed = ce.filter((e) => e.score != null && !e.scratched).sort((a, b) => b.score - a.score);
        placed.forEach((e, i) => {
          const placing = i + 1;
          const pts = calcPoints(placing, competing);
          const regs = horseMap[e.back_number]?.horse_registrations ?? [];
          if (regs.length === 0) {
            ptRows.push([cls.num, cls.name, placing, e.back_number, e.horse, e.exhibitor, e.score, competing, pts, "", ""]);
          } else {
            regs.forEach((r) => ptRows.push([cls.num, cls.name, placing, e.back_number, e.horse, e.exhibitor, e.score, competing, pts, r.club, r.registration_number ?? ""]));
          }
        });
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ptRows), "Club Points");

      XLSX.writeFile(wb, `${(currentEvent.name ?? "results").replace(/[^a-z0-9]/gi, "-")}-results.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  // ---- render: login ----
  if (!session) {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <h1 className="display" style={{ fontWeight: 700, fontSize: 24 }}>Coordinator sign in</h1>
        <p style={{ fontSize: 13.5, color: "var(--quiet)" }}>Scoring and event management are restricted to show staff.</p>
        <input className="field" style={{ width: "100%", marginBottom: 8 }} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="field" style={{ width: "100%", marginBottom: 8 }} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && signIn()} />
        {authError && <div style={{ color: "var(--clay)", fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>{authError}</div>}
        <button className="btn" style={{ width: "100%", background: "var(--leather)" }} onClick={signIn}>Sign in</button>
        <p style={{ fontSize: 12, color: "var(--quiet)", marginTop: 14 }}>Accounts are created in the Supabase dashboard under Authentication → Users → Add user.</p>
        <Link href="/" style={{ fontSize: 13, color: "var(--brass)" }}>← Back to events</Link>
      </main>
    );
  }

  // ---- render: dashboard ----
  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>Coordinator dashboard</div>
            <select value={eventId ?? ""} onChange={(e) => setEventId(e.target.value)}
              className="display" style={{ fontWeight: 700, fontSize: 20, background: "transparent", color: "#F2EADB", border: "none", marginTop: 4 }}>
              {events.map((ev) => <option key={ev.id} value={ev.id} style={{ color: "#241A12" }}>{ev.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-ghost" style={{ borderColor: "var(--brass-soft)", color: "var(--brass-soft)", background: "transparent", padding: "6px 12px" }} onClick={() => openModal("event")}>+ New event</button>
            <button className="btn-ghost" style={{ borderColor: "var(--brass-soft)", color: "var(--brass-soft)", background: "transparent", padding: "6px 12px" }} onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>
      </header>

      <main className="wrap">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 13 }}>
            {eventId && <>
              Share: <Link href={`/event/${eventId}`} style={{ color: "var(--brass)" }}>Live view</Link>
              {" · "}<Link href={`/event/${eventId}/schedule`} style={{ color: "var(--brass)" }}>Schedule</Link>
            </>}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-ghost" onClick={() => openModal("import")} disabled={!eventId}>⇪ Import entries</button>
            <button className="btn-ghost" onClick={exportResults} disabled={exporting || !eventId}>{exporting ? "Exporting…" : "⇩ Export results"}</button>
            {currentEvent?.status !== "completed" && eventId && (
              <button className="btn-ghost danger" onClick={endEvent}>End event</button>
            )}
          </div>
        </div>

        {liveClass && current && (
          <section className="card" style={{ padding: 20, borderColor: "var(--brass)" }}>
            <div style={{ fontSize: 11.5, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--quiet)", fontWeight: 600, marginBottom: 10 }}>
              Class {liveClass.num} · Enter score — #{current.back_number} {current.horse}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input className="field display" style={{ flex: "1 1 140px", fontSize: 22, fontWeight: 600 }}
                type="number" step="0.5" inputMode="decimal" placeholder="e.g. 72.5"
                value={scoreInput} onChange={(e) => setScoreInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveScore()} />
              <button className="btn" style={{ flex: "1 1 180px" }} disabled={scoreInput === "" || busy} onClick={saveScore}>
                Save score & call next →
              </button>
              <button className="btn-ghost danger" style={{ padding: "10px 16px", fontSize: 14, borderRadius: 10 }} onClick={() => toggleScratch(current)}>
                Scratch this entry
              </button>
            </div>
          </section>
        )}

        {classes.map((cls) => {
          const placed = cls.entries.filter((e) => e.score != null && !e.scratched).sort((a, b) => b.score - a.score);
          const pending = cls.entries.filter((e) => e.score == null && !e.scratched);
          const scratchedRows = cls.entries.filter((e) => e.scratched);
          const isLive = cls.status === "live";
          return (
            <section key={cls.id} className="card" style={isLive ? { borderColor: "var(--brass)" } : {}}>
              <div className="card-head" style={isLive ? { background: "#FBF4E4" } : {}}>
                <div>
                  <div className="display" style={{ fontWeight: 600, fontSize: 16.5 }}>Class {cls.num} · {cls.name}</div>
                  {cls.judge && <div style={{ fontSize: 12, color: "var(--quiet)", marginTop: 1 }}>Judge: {cls.judge}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  {cls.status === "upcoming" && (
                    <>
                      <button className="btn-ghost" onClick={() => moveClass(cls, -1)} aria-label="Move earlier">▲</button>
                      <button className="btn-ghost" onClick={() => moveClass(cls, 1)} aria-label="Move later">▼</button>
                      <button className="btn-ghost" style={{ borderColor: "var(--green)", color: "var(--green)" }} onClick={() => startClass(cls)}>Start</button>
                    </>
                  )}
                  {isLive && <button className="btn-ghost" onClick={() => completeClass(cls)}>Complete</button>}
                  <button className="btn-ghost" style={cls.pattern_url ? { borderColor: "var(--brass)", color: "var(--brass)" } : {}} onClick={() => openModal("pattern", { classId: cls.id })}>
                    {cls.pattern_url ? "✓ Pattern" : "Pattern"}
                  </button>
                  <button className="btn-ghost" onClick={() => openModal("entry", { classId: cls.id })}>+ Entry</button>
                  <span className={`badge ${cls.status}`}>{cls.status}</span>
                </div>
              </div>
              <table>
                <tbody>
                  {placed.map((e, i) => (
                    <tr key={e.id}>
                      <td className="display" style={{ width: 50, fontWeight: 700, color: i === 0 ? "var(--brass)" : "var(--quiet)" }}>{i + 1}</td>
                      <td style={{ fontWeight: 600 }}>#{e.back_number} {e.horse} <span style={{ color: "var(--quiet)", fontWeight: 400 }}>· {e.exhibitor}</span></td>
                      <td className="display" style={{ textAlign: "right", fontWeight: 700, width: 70 }}>{e.score}</td>
                      <td style={{ width: 1 }}></td>
                    </tr>
                  ))}
                  {pending.map((e, i) => (
                    <tr key={e.id}>
                      <td style={{ width: 50, color: isLive && i === 0 ? "var(--clay)" : "var(--quiet)", fontWeight: 700, fontSize: isLive && i === 0 ? 11 : 13 }}>
                        {isLive && i === 0 ? "NOW" : placed.length + i + 1}
                      </td>
                      <td style={{ fontWeight: 600 }}>#{e.back_number} {e.horse} <span style={{ color: "var(--quiet)", fontWeight: 400 }}>· {e.exhibitor}</span></td>
                      <td colSpan={2} style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-flex", gap: 5 }}>
                          <button className="btn-ghost" onClick={() => movePending(cls, e, -1)} aria-label="Move earlier">▲</button>
                          <button className="btn-ghost" onClick={() => movePending(cls, e, 1)} aria-label="Move later">▼</button>
                          <button className="btn-ghost danger" onClick={() => toggleScratch(e)}>Scratch</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                  {scratchedRows.map((e) => (
                    <tr key={e.id} style={{ opacity: 0.6 }}>
                      <td style={{ width: 50, color: "var(--clay)", fontSize: 10.5, fontWeight: 700 }}>SCR</td>
                      <td style={{ fontWeight: 600, textDecoration: "line-through" }}>#{e.back_number} {e.horse}</td>
                      <td colSpan={2} style={{ textAlign: "right" }}>
                        {cls.status !== "completed" && <button className="btn-ghost" onClick={() => toggleScratch(e)}>Restore</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn" style={{ background: "var(--leather)" }} onClick={() => openModal("class")} disabled={!eventId}>+ Add class</button>
          <Link href="/registry" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", border: "1px solid var(--line)", background: "#fff", color: "var(--quiet)", borderRadius: 10, padding: "10px 18px", fontSize: 15, fontWeight: 700 }}>
            Horse registry →
          </Link>
        </div>
      </main>

      {/* ---- MODALS ---- */}
      {modal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="modal-sheet">

            {modal.type === "event" && (
              <>
                <h2 className="display modal-title">New event</h2>
                <label className="modal-label">Event name *</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.name ?? ""} onChange={setField("name")} placeholder="e.g. Hunter Valley Winter Circuit" autoFocus />
                <label className="modal-label">Venue / location</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.location ?? ""} onChange={setField("location")} placeholder="e.g. Tamworth Showground" />
                <label className="modal-label">Status</label>
                <select className="field" style={{ width: "100%", fontSize: 16 }} value={form.status ?? "live"} onChange={setField("status")}>
                  <option value="live">Live — happening now</option>
                  <option value="upcoming">Upcoming — future show</option>
                </select>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label className="modal-label">Start date</label>
                    <input className="field" type="date" style={{ width: "100%", fontSize: 15 }} value={form.starts ?? ""} onChange={setField("starts")} />
                  </div>
                  <div>
                    <label className="modal-label">End date</label>
                    <input className="field" type="date" style={{ width: "100%", fontSize: 15 }} value={form.ends ?? ""} onChange={setField("ends")} />
                  </div>
                </div>
                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={submitEvent}>Create event</button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                </div>
              </>
            )}

            {modal.type === "class" && (
              <>
                <h2 className="display modal-title">Add class</h2>
                <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 10 }}>
                  <div>
                    <label className="modal-label">Class # *</label>
                    <input className="field" type="number" style={{ width: "100%", fontSize: 16 }} value={form.num ?? ""} onChange={setField("num")} placeholder="14" autoFocus />
                  </div>
                  <div>
                    <label className="modal-label">Class name *</label>
                    <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.name ?? ""} onChange={setField("name")} placeholder="e.g. Senior Western Pleasure" />
                  </div>
                </div>
                <label className="modal-label">Judge</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.judge ?? ""} onChange={setField("judge")} placeholder="e.g. K. Maddox" />
                <label className="modal-label">Pattern URL (optional)</label>
                <input className="field" style={{ width: "100%", fontSize: 15 }} value={form.pattern_url ?? ""} onChange={setField("pattern_url")} placeholder="Link to pattern image or PDF" />
                <label className="modal-label">Show day (1 for single-day events)</label>
                <input className="field" type="number" min="1" max="10" style={{ width: 80, fontSize: 16 }} value={form.day ?? "1"} onChange={setField("day")} />
                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={submitClass}>Add class</button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                </div>
              </>
            )}

            {modal.type === "entry" && (
              <>
                <h2 className="display modal-title">Add entry</h2>
                {(() => { const cls = classes.find((c) => c.id === modal.classId); return cls && <p style={{ marginTop: 0, color: "var(--quiet)", fontSize: 13 }}>Class {cls.num} · {cls.name}</p>; })()}
                <label className="modal-label">Back number *</label>
                <input className="field" type="number" style={{ width: "100%", fontSize: 16 }} value={form.back ?? ""} onChange={setField("back")} placeholder="e.g. 301" autoFocus />
                <label className="modal-label">Horse name *</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.horse ?? ""} onChange={setField("horse")} placeholder="e.g. Machine Made Lady" />
                <label className="modal-label">Exhibitor *</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.exhibitor ?? ""} onChange={setField("exhibitor")} placeholder="e.g. P. Santos" />
                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={submitEntry}>Add entry</button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                </div>
              </>
            )}

            {modal.type === "pattern" && (
              <>
                <h2 className="display modal-title">Set class pattern</h2>
                {(() => { const cls = classes.find((c) => c.id === modal.classId); return cls && <p style={{ marginTop: 0, color: "var(--quiet)", fontSize: 13 }}>Class {cls.num} · {cls.name}</p>; })()}
                <label className="modal-label">Upload pattern file</label>
                <input type="file" accept="image/*,.pdf" style={{ marginBottom: 4 }}
                  onChange={(e) => setForm((f) => ({ ...f, patternFile: e.target.files?.[0] ?? null }))} />
                <p style={{ fontSize: 12, color: "var(--quiet)", marginTop: 0, marginBottom: 12 }}>
                  File upload requires the "patterns" storage bucket in Supabase (see setup notes).
                </p>
                <label className="modal-label">Or paste a URL</label>
                <input className="field" style={{ width: "100%", fontSize: 15 }} value={form.pattern_url ?? ""} onChange={setField("pattern_url")} placeholder="https://…" />
                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={submitPattern}>Save pattern</button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                </div>
              </>
            )}

            {modal.type === "import" && (
              <ImportEntries
                eventId={eventId}
                classes={classes}
                onDone={() => { closeModal(); loadClasses(); }}
              />
            )}

          </div>
        </div>
      )}
    </>
  );
}
