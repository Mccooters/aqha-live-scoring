"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabaseClient";

export default function SchedulePage() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [classes, setClasses] = useState([]);

  const load = useCallback(async () => {
    const [{ data: ev }, { data: cls }] = await Promise.all([
      supabase.from("events").select("*").eq("id", id).single(),
      supabase
        .from("classes")
        .select("*, entries(id, scratched, score)")
        .eq("event_id", id)
        .order("day")
        .order("sort_order"),
    ]);
    if (ev) setEvent(ev);
    if (cls) setClasses(cls);
  }, [id]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`schedule-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "classes" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "entries" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [id, load]);

  // Group classes by day
  const days = [];
  classes.forEach((cls) => {
    const day = cls.day ?? 1;
    let group = days.find((d) => d.day === day);
    if (!group) { group = { day, classes: [] }; days.push(group); }
    group.classes.push(cls);
  });
  days.sort((a, b) => a.day - b.day);

  const isMultiDay = days.length > 1 || (event?.starts_on && event?.ends_on && event.ends_on !== event.starts_on);

  const dayDate = (day) => {
    if (!event?.starts_on) return null;
    try {
      const d = new Date(event.starts_on + "T00:00:00");
      d.setDate(d.getDate() + day - 1);
      return d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
    } catch { return null; }
  };

  if (!event) return <main className="wrap"><p style={{ color: "var(--quiet)" }}>Loading…</p></main>;

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 14, marginBottom: 6 }}>
            <Link href={`/event/${id}`} style={{ color: "var(--brass-soft)", fontSize: 12.5, textDecoration: "none" }}>← Live scoring</Link>
            <Link href="/" style={{ color: "var(--brass-soft)", fontSize: 12.5, textDecoration: "none" }}>All events</Link>
          </div>
          <h1 className="display" style={{ fontWeight: 700, fontSize: "clamp(20px,4vw,28px)", margin: "0 0 2px" }}>{event.name}</h1>
          <div style={{ fontSize: 13, color: "#CBBFA9" }}>
            {event.location}
            {event.starts_on && ` · ${event.starts_on}${event.ends_on && event.ends_on !== event.starts_on ? ` – ${event.ends_on}` : ""}`}
          </div>
        </div>
      </header>

      <main className="wrap">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <h2 className="display" style={{ fontWeight: 700, fontSize: 20, margin: 0 }}>Class Schedule</h2>
          <span className={`badge ${event.status}`}>{event.status}</span>
        </div>

        {classes.length === 0 && (
          <div className="card" style={{ padding: 24, textAlign: "center" }}>
            <span className="display" style={{ fontSize: 17, color: "var(--quiet)" }}>No classes scheduled yet.</span>
          </div>
        )}

        {days.map(({ day, classes: dayCls }) => (
          <div key={day}>
            {isMultiDay && (
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--quiet)", margin: "24px 0 10px" }}>
                Day {day}{dayDate(day) ? ` · ${dayDate(day)}` : ""}
              </div>
            )}
            <section className="card" style={{ marginBottom: isMultiDay ? 8 : 18 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Class</th>
                    <th>Name</th>
                    <th style={{ display: "none" }} className="hide-mobile">Judge</th>
                    <th style={{ width: 70, textAlign: "center" }}>Entries</th>
                    <th style={{ width: 95, textAlign: "right" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dayCls.map((cls) => {
                    const competing = (cls.entries ?? []).filter((e) => !e.scratched).length;
                    const scored = (cls.entries ?? []).filter((e) => e.score != null && !e.scratched).length;
                    const isLive = cls.status === "live";
                    return (
                      <tr key={cls.id} style={isLive ? { background: "#FBF4E4" } : {}}>
                        <td className="display" style={{ fontWeight: 700, color: isLive ? "var(--clay)" : "var(--quiet)" }}>
                          {isLive && (
                            <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "var(--clay)", marginRight: 6, verticalAlign: "middle", animation: "pulse 1.6s infinite" }} />
                          )}
                          {cls.num}
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{cls.name}</div>
                          {cls.judge && <div style={{ fontSize: 12, color: "var(--quiet)" }}>Judge: {cls.judge}</div>}
                          {cls.pattern_url && (
                            <a href={cls.pattern_url} target="_blank" rel="noreferrer"
                              style={{ fontSize: 12, color: "var(--brass)", textDecoration: "none", fontWeight: 700 }}>▦ View pattern</a>
                          )}
                          {isLive && competing > 0 && (
                            <div style={{ fontSize: 11.5, color: "var(--clay)", marginTop: 2 }}>
                              {scored} of {competing} scored
                              <span style={{ display: "inline-block", marginLeft: 8, width: 60, height: 4, background: "var(--line)", borderRadius: 2, verticalAlign: "middle", overflow: "hidden" }}>
                                <span style={{ display: "block", height: "100%", width: `${(scored / competing) * 100}%`, background: "var(--clay)", transition: "width .5s" }} />
                              </span>
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: "center", color: "var(--quiet)" }}>{competing}</td>
                        <td style={{ textAlign: "right" }}>
                          <span className={`badge ${cls.status}`}>{cls.status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </div>
        ))}

        <p style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 4 }}>
          <Link href={`/event/${id}`} style={{ color: "var(--brass)" }}>← Back to live scoring</Link>
        </p>
      </main>
    </>
  );
}
