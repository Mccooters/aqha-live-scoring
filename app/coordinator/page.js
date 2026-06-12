"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

const firstPending = (entries) =>
  entries.find((e) => e.score == null && !e.scratched) ?? null;

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

  // ---- actions ----
  const saveScore = async () => {
    const val = parseFloat(scoreInput);
    if (isNaN(val) || !current || busy) return;
    setBusy(true);
    await supabase.from("entries").update({ score: val }).eq("id", current.id);
    // auto-complete class when that was the last pending entry
    const remaining = liveClass.entries.filter((e) => e.id !== current.id && e.score == null && !e.scratched);
    if (remaining.length === 0) await completeClass(liveClass);
    setScoreInput("");
    setBusy(false);
  };

  const toggleScratch = async (entry) => {
    await supabase.from("entries").update({ scratched: !entry.scratched }).eq("id", entry.id);
    if (!entry.scratched && liveClass) {
      const remaining = liveClass.entries.filter((e) => e.id !== entry.id && e.score == null && !e.scratched);
      if (remaining.length === 0) await completeClass(liveClass);
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
  };

  const completeClass = async (cls) => {
    await supabase.from("classes").update({ status: "completed" }).eq("id", cls.id);
    const nextUp = classes.find((c) => c.status === "upcoming" && c.id !== cls.id);
    if (nextUp) await supabase.from("classes").update({ status: "live" }).eq("id", nextUp.id);
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

  const addClass = async () => {
    const num = prompt("Class number?"); if (!num) return;
    const name = prompt("Class name?"); if (!name) return;
    const judge = prompt("Judge?") ?? "";
    const maxOrder = Math.max(0, ...classes.map((c) => c.sort_order));
    await supabase.from("classes").insert({ event_id: eventId, num: parseInt(num, 10), name, judge, sort_order: maxOrder + 1 });
  };

  const addEntry = async (cls) => {
    const back = prompt("Back number?"); if (!back) return;
    const horse = prompt("Horse name?"); if (!horse) return;
    const exhibitor = prompt("Exhibitor?"); if (!exhibitor) return;
    const maxDraw = Math.max(0, ...cls.entries.map((e) => e.draw_order));
    await supabase.from("entries").insert({
      class_id: cls.id, back_number: parseInt(back, 10), horse, exhibitor, draw_order: maxDraw + 1,
    });
  };

  const addEvent = async () => {
    const name = prompt("Event name?"); if (!name) return;
    const location = prompt("Venue / location?") ?? "";
    const starts = prompt("Start date (YYYY-MM-DD)?") ?? null;
    const { data } = await supabase
      .from("events").insert({ name, location, starts_on: starts, ends_on: starts, status: "live" })
      .select().single();
    await loadEvents();
    if (data) setEventId(data.id);
  };

  // ---- render ----
  if (!session) {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <h1 className="display" style={{ fontWeight: 700, fontSize: 24 }}>Coordinator sign in</h1>
        <p style={{ fontSize: 13.5, color: "var(--quiet)" }}>Scoring and event management are restricted to show staff.</p>
        <input className="field" style={{ width: "100%", marginBottom: 8 }} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="field" style={{ width: "100%", marginBottom: 8 }} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && signIn()} />
        {authError && <div style={{ color: "var(--clay)", fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>{authError}</div>}
        <button className="btn" style={{ width: "100%", background: "var(--leather)" }} onClick={signIn}>Sign in</button>
        <p style={{ fontSize: 12, color: "var(--quiet)", marginTop: 14 }}>
          Accounts are created by the administrator in the Supabase dashboard (Authentication → Users → Add user).
        </p>
        <Link href="/" style={{ fontSize: 13, color: "var(--brass)" }}>← Back to events</Link>
      </main>
    );
  }

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
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-ghost" style={{ borderColor: "var(--brass-soft)", color: "var(--brass-soft)", background: "transparent", padding: "6px 12px" }} onClick={addEvent}>+ New event</button>
            <button className="btn-ghost" style={{ borderColor: "var(--brass-soft)", color: "var(--brass-soft)", background: "transparent", padding: "6px 12px" }} onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>
      </header>

      <main className="wrap">
        {eventId && (
          <p style={{ fontSize: 13 }}>
            Spectator link to share: <Link href={`/event/${eventId}`} style={{ color: "var(--brass)" }}>open live view →</Link>
          </p>
        )}

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
                <div className="display" style={{ fontWeight: 600, fontSize: 16.5 }}>Class {cls.num} · {cls.name}</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  {cls.status === "upcoming" && (
                    <>
                      <button className="btn-ghost" onClick={() => moveClass(cls, -1)}>▲ earlier</button>
                      <button className="btn-ghost" onClick={() => moveClass(cls, 1)}>▼ later</button>
                      <button className="btn-ghost" style={{ borderColor: "var(--green)", color: "var(--green)" }} onClick={() => startClass(cls)}>Start class</button>
                    </>
                  )}
                  {isLive && <button className="btn-ghost" onClick={() => completeClass(cls)}>Mark complete</button>}
                  <button className="btn-ghost" onClick={() => addEntry(cls)}>+ Entry</button>
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

        <button className="btn" style={{ background: "var(--leather)" }} onClick={addClass}>+ Add class</button>
      </main>
    </>
  );
}
