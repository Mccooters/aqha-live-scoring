"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

const firstPending = (entries) =>
  entries.find((e) => e.score == null && !e.scratched) ?? null;

export default function EventPage() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [classes, setClasses] = useState([]);

  const load = useCallback(async () => {
    const [{ data: ev }, { data: cls }] = await Promise.all([
      supabase.from("events").select("*").eq("id", id).single(),
      supabase
        .from("classes")
        .select("*, entries(*)")
        .eq("event_id", id)
        .order("sort_order"),
    ]);
    if (ev) setEvent(ev);
    if (cls) {
      cls.forEach((c) => c.entries.sort((a, b) => a.draw_order - b.draw_order));
      setClasses(cls);
    }
  }, [id]);

  // Initial load + realtime: re-fetch whenever anything in this event changes
  useEffect(() => {
    load();
    const channel = supabase
      .channel(`event-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "entries" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "classes" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [id, load]);

  const liveClass = classes.find((c) => c.status === "live");
  const current = liveClass ? firstPending(liveClass.entries) : null;
  const active = liveClass ? liveClass.entries.filter((e) => !e.scratched) : [];
  const drawPos = current ? active.findIndex((e) => e.id === current.id) + 1 : 0;
  const scored = active.filter((e) => e.score != null).length;

  if (!event) return <main className="wrap"><p style={{ color: "var(--quiet)" }}>Loading…</p></main>;

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <Link href="/" style={{ color: "var(--brass-soft)", fontSize: 12.5, textDecoration: "none" }}>← All events</Link>
          <h1 className="display" style={{ fontWeight: 700, fontSize: "clamp(22px,4vw,30px)", margin: "4px 0" }}>{event.name}</h1>
          <div style={{ fontSize: 13, color: "#CBBFA9" }}>{event.location}</div>
        </div>
      </header>

      <main className="wrap">
        {liveClass && current ? (
          <section className="card" style={{ background: "var(--leather-deep)", color: "#F5EFE4", border: "1px solid var(--brass)", padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--clay)", animation: "pulse 1.6s infinite" }} />
              <span style={{ fontSize: 11.5, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--brass-soft)", fontWeight: 600 }}>
                Live · Class {liveClass.num} — {liveClass.name}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div className="display" style={{ fontWeight: 700, fontSize: "clamp(22px,5vw,32px)", lineHeight: 1.1 }}>
                  #{current.back_number} {current.horse}
                </div>
                <div style={{ fontSize: 14, color: "#CBBFA9", marginTop: 3 }}>
                  {current.exhibitor} · Judge {liveClass.judge}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="display" style={{ fontWeight: 700, fontSize: 30, color: "var(--brass-soft)" }}>
                  {drawPos}<span style={{ fontSize: 18, color: "#9c8a6e" }}> / {active.length}</span>
                </div>
                <div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "#9c8a6e" }}>draw order</div>
              </div>
            </div>
            <div style={{ height: 5, background: "rgba(255,255,255,.12)", borderRadius: 3, marginTop: 14, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(scored / Math.max(active.length, 1)) * 100}%`, background: "var(--brass)", transition: "width .5s ease" }} />
            </div>
          </section>
        ) : (
          <section className="card" style={{ background: "var(--sand)", border: "none", padding: 22, textAlign: "center" }}>
            <span className="display" style={{ fontSize: 18 }}>
              {classes.length ? "No class in the arena right now." : "Class list coming soon."}
            </span>
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
                <div className="display" style={{ fontWeight: 600, fontSize: 16.5 }}>
                  Class {cls.num} · {cls.name}
                  <span style={{ fontFamily: "Archivo, sans-serif", fontSize: 12, color: "var(--quiet)", fontWeight: 500 }}>
                    {" "}· {cls.entries.filter((e) => !e.scratched).length} entries
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {cls.pattern_url && (
                    <a href={cls.pattern_url} target="_blank" rel="noreferrer"
                      style={{ border: "1px solid var(--brass)", color: "var(--brass)", borderRadius: 20, padding: "4px 12px", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
                      ▦ View pattern
                    </a>
                  )}
                  <span className={`badge ${cls.status}`}>{cls.status}</span>
                </div>
              </div>
              <table>
                <thead>
                  <tr><th style={{ width: 50 }}>{cls.status === "upcoming" ? "Draw" : "Pl"}</th><th>Back · Horse</th><th>Exhibitor</th><th style={{ textAlign: "right" }}>Score</th></tr>
                </thead>
                <tbody>
                  {placed.map((e, i) => (
                    <tr key={e.id} style={i === 0 ? { background: "#FBF4E4" } : {}}>
                      <td className="display" style={{ fontWeight: 700, color: i === 0 ? "var(--brass)" : "var(--quiet)" }}>{i + 1}</td>
                      <td style={{ fontWeight: 600 }}>#{e.back_number} {e.horse}</td>
                      <td style={{ color: "var(--quiet)" }}>{e.exhibitor}</td>
                      <td className="display" style={{ textAlign: "right", fontWeight: 700 }}>{e.score}</td>
                    </tr>
                  ))}
                  {pending.map((e, i) => (
                    <tr key={e.id} style={{ opacity: isLive && i > 0 ? 0.7 : 1 }}>
                      <td style={isLive && i === 0 ? { color: "var(--clay)", fontSize: 11, fontWeight: 700 } : { color: "var(--quiet)" }}>
                        {isLive && i === 0 ? "NOW" : placed.length + i + 1}
                      </td>
                      <td style={{ fontWeight: 600 }}>#{e.back_number} {e.horse}</td>
                      <td style={{ color: "var(--quiet)" }}>{e.exhibitor}</td>
                      <td style={{ textAlign: "right", color: "var(--quiet)" }}>·</td>
                    </tr>
                  ))}
                  {scratchedRows.map((e) => (
                    <tr key={e.id} style={{ opacity: 0.55 }}>
                      <td style={{ color: "var(--clay)", fontSize: 10.5, fontWeight: 700 }}>SCR</td>
                      <td style={{ fontWeight: 600, textDecoration: "line-through" }}>#{e.back_number} {e.horse}</td>
                      <td style={{ color: "var(--quiet)", textDecoration: "line-through" }}>{e.exhibitor}</td>
                      <td style={{ textAlign: "right", color: "var(--quiet)" }}>·</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </main>
    </>
  );
}
