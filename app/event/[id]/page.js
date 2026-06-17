"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

const firstPending = (entries, mode) =>
  mode === "tbc"
    ? entries.find((e) => !e.called && !e.scratched) ?? null
    : entries.find((e) => e.score == null && !e.scratched) ?? null;

const fmtBack = (n) => String(n).padStart(3, "0");

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

function urlBase64ToUint8Array(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
}

export default function EventPage() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [classes, setClasses] = useState([]);
  const [notifStatus, setNotifStatus] = useState("idle"); // idle | loading | subscribed | denied

  const load = useCallback(async () => {
    const [{ data: ev }, { data: cls }] = await Promise.all([
      supabase.from("events").select("*").eq("id", id).single(),
      supabase.from("classes").select("*, entries(*)").eq("event_id", id).order("sort_order"),
    ]);
    if (ev) setEvent(ev);
    if (cls) {
      cls.forEach((c) => c.entries.sort((a, b) => a.draw_order - b.draw_order));
      setClasses(cls);
    }
  }, [id]);

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

  const subscribePush = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setNotifStatus("denied");
      return;
    }
    setNotifStatus("loading");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const json = sub.toJSON();
      await supabase.from("push_subscriptions").upsert(
        { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth_key: json.keys.auth },
        { onConflict: "endpoint" }
      );
      setNotifStatus("subscribed");
    } catch {
      setNotifStatus("denied");
    }
  };

  const liveClass = classes.find((c) => c.status === "live");
  const current = liveClass ? firstPending(liveClass.entries, liveClass.scoring_mode) : null;
  const active = liveClass ? liveClass.entries.filter((e) => !e.scratched) : [];
  const drawPos = current ? active.findIndex((e) => e.id === current.id) + 1 : 0;
  const scored = active.filter((e) => liveClass?.scoring_mode === "tbc" ? e.called : e.score != null).length;

  if (!event) return <main className="wrap"><p style={{ color: "var(--quiet)" }}>Loading…</p></main>;

  const isClinic = event.event_type === "clinic";

  // ---- Clinic view ----
  if (isClinic) {
    const isOpen = event.status === "open" || event.status === "upcoming";
    const isDone = event.status === "completed" || event.status === "archived";
    const spotsRows = classes.map((cls) => {
      const taken = cls.entries.filter((e) => !e.scratched).length;
      const full = cls.capacity != null && taken >= cls.capacity;
      const remaining = cls.capacity != null ? cls.capacity - taken : null;
      return { cls, taken, full, remaining };
    });
    const allFull = spotsRows.length > 0 && spotsRows.every((r) => r.full);
    return (
      <>
        <header className="header">
          <div style={{ maxWidth: 860, margin: "0 auto" }}>
            <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)", marginBottom: 4 }}>Clinic</div>
            <h1 className="display" style={{ fontWeight: 700, fontSize: "clamp(22px,4vw,30px)", margin: "0 0 2px" }}>{event.name}</h1>
            <div style={{ fontSize: 13, color: "#CBBFA9" }}>
              {event.location}{event.starts_on ? ` · ${event.starts_on}` : ""}{event.ends_on && event.ends_on !== event.starts_on ? ` – ${event.ends_on}` : ""}
            </div>
          </div>
        </header>
        <main className="wrap">
          {isDone ? (
            <section className="card" style={{ textAlign: "center", padding: "28px 20px" }}>
              <div className="display" style={{ fontSize: 20, fontWeight: 700 }}>This clinic has concluded.</div>
            </section>
          ) : allFull && !isOpen ? (
            <section className="card" style={{ textAlign: "center", padding: "28px 20px" }}>
              <div className="display" style={{ fontSize: 22, fontWeight: 700, color: "var(--clay)" }}>Sold out</div>
              <p style={{ color: "var(--quiet)", marginBottom: 0 }}>All spots for this clinic are now full. Please contact the organiser.</p>
            </section>
          ) : !isOpen ? (
            <section className="card" style={{ textAlign: "center", padding: "28px 20px" }}>
              <div className="display" style={{ fontSize: 20, fontWeight: 700 }}>
                {event.status === "pre_open" ? "Registrations opening soon." : "Registrations are closed."}
              </div>
            </section>
          ) : (
            <>
              {allFull ? (
                <section className="card" style={{ background: "var(--clay)", color: "#fff", padding: "18px 20px", textAlign: "center" }}>
                  <div className="display" style={{ fontWeight: 700, fontSize: 22 }}>Sold out</div>
                  <p style={{ margin: "4px 0 0", opacity: .85 }}>All spots are taken. Contact the organiser to be added to a waiting list.</p>
                </section>
              ) : (
                <section className="card" style={{ padding: "18px 20px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                    <div>
                      <div className="display" style={{ fontWeight: 700, fontSize: 20, marginBottom: 4 }}>Registrations open</div>
                      {spotsRows.map(({ cls, taken, full, remaining }) => (
                        <div key={cls.id} style={{ fontSize: 14, color: full ? "var(--clay)" : "var(--quiet)", marginBottom: 2 }}>
                          <strong>{cls.name}</strong>
                          {remaining != null
                            ? full ? " — Full" : ` — ${remaining} spot${remaining === 1 ? "" : "s"} remaining`
                            : null}
                        </div>
                      ))}
                    </div>
                    <Link href={`/event/${id}/register`} className="btn"
                      style={{ background: "var(--leather)", textDecoration: "none", fontSize: 15, whiteSpace: "nowrap" }}>
                      Register →
                    </Link>
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </>
    );
  }

  // ---- Show view ----
  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", gap: 12, marginBottom: 4 }}>
                <Link href={`/event/${id}/schedule`} style={{ color: "var(--brass-soft)", fontSize: 12.5, textDecoration: "none" }}>Schedule →</Link>
              </div>
              <h1 className="display" style={{ fontWeight: 700, fontSize: "clamp(22px,4vw,30px)", margin: "0 0 2px" }}>{event.name}</h1>
              <div style={{ fontSize: 13, color: "#CBBFA9" }}>{event.location}</div>
            </div>
            {VAPID_PUBLIC_KEY && notifStatus !== "subscribed" && notifStatus !== "denied" && (
              <button onClick={subscribePush} disabled={notifStatus === "loading"}
                style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.25)", color: "#F2EADB", borderRadius: 20, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", alignSelf: "flex-start", marginTop: 4 }}>
                {notifStatus === "loading" ? "Subscribing…" : "🔔 Get notified"}
              </button>
            )}
            {notifStatus === "subscribed" && (
              <span style={{ fontSize: 12.5, color: "var(--brass-soft)", alignSelf: "flex-start", marginTop: 8 }}>✓ Notifications on</span>
            )}
          </div>
        </div>
      </header>

      <main className="wrap">
        {/* ---- Live banner / completed summary / idle ---- */}
        {liveClass && liveClass.scoring_mode === "tbc_class" ? (
          <section className="card" style={{ background: "var(--leather-deep)", color: "#F5EFE4", border: "1px solid var(--brass)", padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--clay)", animation: "pulse 1.6s infinite" }} />
              <span style={{ fontSize: 11.5, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--brass-soft)", fontWeight: 600 }}>
                Live · Class {liveClass.num} — {liveClass.name}
              </span>
            </div>
            <div className="display" style={{ fontWeight: 700, fontSize: "clamp(20px,4vw,28px)", lineHeight: 1.2 }}>
              Class in progress
            </div>
            <div style={{ fontSize: 14, color: "#CBBFA9", marginTop: 4 }}>
              Results will be posted once the judge's paperwork is received.
            </div>
          </section>
        ) : liveClass && liveClass.scoring_mode === "class_only" ? (
          <section className="card" style={{ background: "var(--leather-deep)", color: "#F5EFE4", border: "1px solid var(--brass)", padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--clay)", animation: "pulse 1.6s infinite" }} />
              <span style={{ fontSize: 11.5, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--brass-soft)", fontWeight: 600 }}>
                Live · Class {liveClass.num} — {liveClass.name}
              </span>
            </div>
            <div className="display" style={{ fontWeight: 700, fontSize: "clamp(20px,4vw,28px)", lineHeight: 1.2 }}>
              Class in progress
            </div>
            {liveClass.judge && (
              <div style={{ fontSize: 14, color: "#CBBFA9", marginTop: 4 }}>Judge: {liveClass.judge}</div>
            )}
          </section>
        ) : liveClass && current ? (
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
                  #{fmtBack(current.back_number)} {current.horse}
                </div>
                <div style={{ fontSize: 14, color: "#CBBFA9", marginTop: 3 }}>
                  {current.exhibitor}
                  {liveClass.judge2
                    ? ` · Judges: ${liveClass.judge} · ${liveClass.judge2}`
                    : liveClass.judge ? ` · Judge ${liveClass.judge}` : ""}
                </div>
              </div>
              {liveClass.scoring_mode !== "placing" && (
                <div style={{ textAlign: "right" }}>
                  <div className="display" style={{ fontWeight: 700, fontSize: 30, color: "var(--brass-soft)" }}>
                    {drawPos}<span style={{ fontSize: 18, color: "#9c8a6e" }}> / {active.length}</span>
                  </div>
                  <div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "#9c8a6e" }}>draw order</div>
                </div>
              )}
            </div>
            {liveClass.scoring_mode !== "placing" && (
              <div style={{ height: 5, background: "rgba(255,255,255,.12)", borderRadius: 3, marginTop: 14, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(scored / Math.max(active.length, 1)) * 100}%`, background: "var(--brass)", transition: "width .5s ease" }} />
              </div>
            )}
          </section>
        ) : event.status === "completed" ? (
          <section className="card" style={{ background: "var(--sand)", border: "1px solid var(--line)", padding: "20px 22px" }}>
            <div className="display" style={{ fontWeight: 700, fontSize: 18, marginBottom: 14, color: "var(--leather)" }}>Final Results</div>
            {classes.filter((cls) => cls.entries.some((e) => e.score != null && !e.scratched)).map((cls) => {
              const champion = [...cls.entries].filter((e) => e.score != null && !e.scratched).sort((a, b) => b.score - a.score)[0];
              return (
                <div key={cls.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--line)", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>Class {cls.num} · {cls.name}</div>
                    <div style={{ fontSize: 13, color: "var(--quiet)" }}>1st: #{fmtBack(champion.back_number)} {champion.horse} · {champion.exhibitor}</div>
                  </div>
                  <div className="display" style={{ fontWeight: 700, color: "var(--brass)", fontSize: 20, whiteSpace: "nowrap" }}>{champion.score}</div>
                </div>
              );
            })}
            {!classes.some((cls) => cls.entries.some((e) => e.score != null && !e.scratched)) && (
              <p style={{ color: "var(--quiet)", margin: 0 }}>No scored results recorded.</p>
            )}
          </section>
        ) : (
          <section className="card" style={{ background: "var(--sand)", border: "none", padding: 22, textAlign: "center" }}>
            {event.status === "pre_open" ? (
              <>
                <span className="display" style={{ fontSize: 18 }}>Entries opening soon.</span>
                <p style={{ color: "var(--quiet)", fontSize: 14, marginBottom: 0 }}>
                  This event is being set up. Check back when entries open.
                </p>
              </>
            ) : (event.status === "open" || event.status === "upcoming") ? (
              <>
                <span className="display" style={{ fontSize: 18 }}>Entries are open.</span>
                <div style={{ marginTop: 16 }}>
                  <Link href={`/event/${id}/register`} className="btn"
                    style={{ display: "inline-block", background: "var(--leather)", textDecoration: "none", fontSize: 15 }}>
                    Register entries →
                  </Link>
                </div>
              </>
            ) : event.status === "closed" ? (
              <>
                <span className="display" style={{ fontSize: 18 }}>Draw being finalised.</span>
                <p style={{ color: "var(--quiet)", fontSize: 14, marginBottom: 0 }}>Entries are closed. The show starts soon.</p>
              </>
            ) : (
              <span className="display" style={{ fontSize: 18 }}>
                {classes.length ? "No class in the arena right now." : "Class list coming soon."}
              </span>
            )}
          </section>
        )}

        {/* ---- Per-class scoreboards ---- */}
        {classes.map((cls) => {
          const mode = cls.scoring_mode ?? "score";
          const isTbcDraw = mode === "tbc";
          const isPlacingMode = mode === "placing" || mode === "class_only" || mode === "tbc_class";
          const twoJudges = !!cls.judge2;
          const placed = cls.entries
            .filter((e) => e.score != null && !e.scratched)
            .sort((a, b) => {
              const d = isPlacingMode ? a.score - b.score : b.score - a.score;
              return d !== 0 ? d : isPlacingMode ? (a.score2 ?? 99) - (b.score2 ?? 99) : (b.score2 ?? 0) - (a.score2 ?? 0);
            });
          const calledRows = isTbcDraw ? cls.entries.filter((e) => e.called && e.score == null && !e.scratched) : [];
          const pending = isTbcDraw
            ? cls.entries.filter((e) => !e.called && !e.scratched)
            : cls.entries.filter((e) => e.score == null && !e.scratched);
          const scratchedRows = cls.entries.filter((e) => e.scratched);
          const isLive = cls.status === "live";
          const isClassOnly = mode === "class_only";
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
                  <tr>
                    <th style={{ width: 50 }}>{cls.status === "upcoming" ? "Draw" : "Pl"}</th>
                    <th>Back · Horse</th>
                    <th>Exhibitor</th>
                    <th style={{ textAlign: "right" }}>{isPlacingMode ? "Placing" : (twoJudges ? "J1 / J2" : "Score")}</th>
                  </tr>
                </thead>
                <tbody>
                  {placed.length === 0 && (mode === "tbc" || mode === "tbc_class") && cls.status !== "upcoming" && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center", color: "var(--quiet)", fontStyle: "italic", padding: "18px 0" }}>
                        Results pending — will be posted once received from the judge
                      </td>
                    </tr>
                  )}
                  {placed.map((e, i) => (
                    <tr key={e.id} style={i === 0 ? { background: "#FBF4E4" } : {}}>
                      <td className="display" style={{ fontWeight: 700, color: i === 0 ? "var(--brass)" : "var(--quiet)" }}>{i + 1}</td>
                      <td style={{ fontWeight: 600 }}>#{fmtBack(e.back_number)} {e.horse}</td>
                      <td style={{ color: "var(--quiet)" }}>{e.exhibitor}</td>
                      <td className="display" style={{ textAlign: "right", fontWeight: 700 }}>
                        {isPlacingMode
                          ? (twoJudges ? `${ordinal(e.score)} / ${ordinal(e.score2 ?? "?")}` : ordinal(e.score))
                          : (twoJudges && e.score2 != null ? `${e.score} / ${e.score2}` : e.score)}
                      </td>
                    </tr>
                  ))}
                  {calledRows.map((e) => (
                    <tr key={e.id} style={{ opacity: 0.75 }}>
                      <td style={{ color: "var(--quiet)", fontStyle: "italic", fontSize: 11, fontWeight: 600 }}>TBC</td>
                      <td style={{ fontWeight: 600 }}>#{fmtBack(e.back_number)} {e.horse}</td>
                      <td style={{ color: "var(--quiet)" }}>{e.exhibitor}</td>
                      <td style={{ textAlign: "right", color: "var(--quiet)", fontStyle: "italic", fontSize: 12 }}>result pending</td>
                    </tr>
                  ))}
                  {pending.map((e, i) => (
                    <tr key={e.id} style={{ opacity: isLive && !isClassOnly && !isTbcDraw && i > 0 ? 0.7 : 1 }}>
                      <td style={isLive && !isClassOnly && i === 0 ? { color: "var(--clay)", fontSize: 11, fontWeight: 700 } : { color: "var(--quiet)" }}>
                        {isLive && !isClassOnly && i === 0 ? "NOW" : placed.length + calledRows.length + i + 1}
                      </td>
                      <td style={{ fontWeight: 600 }}>#{fmtBack(e.back_number)} {e.horse}</td>
                      <td style={{ color: "var(--quiet)" }}>{e.exhibitor}</td>
                      <td style={{ textAlign: "right", color: "var(--quiet)" }}>·</td>
                    </tr>
                  ))}
                  {scratchedRows.map((e) => (
                    <tr key={e.id} style={{ opacity: 0.55 }}>
                      <td style={{ color: "var(--clay)", fontSize: 10.5, fontWeight: 700 }}>SCR</td>
                      <td style={{ fontWeight: 600, textDecoration: "line-through" }}>#{fmtBack(e.back_number)} {e.horse}</td>
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
