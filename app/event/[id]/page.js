"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import { normaliseBreakLabel, normaliseCategoryLabel, programDisplayRows, withoutHiddenClasses } from "../../../lib/classCategories";
import { scoreRank } from "../../../lib/showPrint";
import { championshipTitles } from "../../../lib/championship";

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

function classCategoryText(cls) {
  return normaliseCategoryLabel(cls?.program_category);
}

function LiveClassLabel({ cls }) {
  const category = classCategoryText(cls);
  return (
    <>
      Live
      {category ? ` · ${category}` : ""}
      {" · "}Class {cls.num} — {cls.name}
    </>
  );
}

function NextClassPreview({ cls, breaks = [] }) {
  if (!cls && !breaks.length) return null;
  const category = cls ? classCategoryText(cls) : "";
  return (
    <div style={{
      marginTop: 14,
      padding: "10px 12px",
      border: "1px solid rgba(201,169,97,.35)",
      borderRadius: 10,
      background: "rgba(255,255,255,.06)",
    }}>
      {breaks.map((label, i) => (
        <div key={i} style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "#F5D87B", marginBottom: cls || i < breaks.length - 1 ? 6 : 0 }}>
          ⏸ {label}
        </div>
      ))}
      {cls && (
        <>
          <div style={{ fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: "#9c8a6e", fontWeight: 700, marginBottom: 3 }}>
            {breaks.length ? "Then" : "Next up"}{category ? ` · ${category}` : ""}
          </div>
          <div style={{ fontSize: 13.5, color: "#F5EFE4", fontWeight: 700 }}>
            Class {cls.num} — {cls.name}
          </div>
        </>
      )}
    </div>
  );
}

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
  const [notifError, setNotifError] = useState("");
  // iPhone only allows notifications for sites added to the Home Screen, so we
  // detect that case and show install steps instead of a button that can't work.
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
    const isStandalone =
      window.navigator.standalone === true ||
      window.matchMedia?.("(display-mode: standalone)").matches;
    setIosNeedsInstall(isIos && !isStandalone);
  }, []);

  const load = useCallback(async () => {
    const [{ data: ev }, { data: cls }] = await Promise.all([
      supabase.from("events").select("*").eq("id", id).single(),
      supabase.from("classes").select("*, entries(*)").eq("event_id", id).order("sort_order"),
    ]);
    if (ev) setEvent(ev);
    if (cls) {
      // Hidden classes (schema-v38) never appear to the public — and a class
      // whose every entry is scratched is effectively not running, so it's
      // treated the same. Any program break attached carries onto the next
      // visible class either way. (Classes with no entries yet still show —
      // that's the pre-show program.)
      const marked = cls.map((c) =>
        (c.entries?.length > 0 && c.entries.every((e) => e.scratched)) ? { ...c, hidden: true } : c);
      const visible = withoutHiddenClasses(marked);
      visible.forEach((c) => c.entries.sort((a, b) => a.draw_order - b.draw_order));
      setClasses(visible);
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
    setNotifError("");
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setNotifError("This browser does not support web push notifications.");
      setNotifStatus("denied");
      return;
    }
    if (typeof Notification !== "undefined" && Notification.permission === "denied") {
      setNotifError("Notifications are blocked for this app. Re-enable them in iPhone Settings > Notifications > HCQHA Live.");
      setNotifStatus("denied");
      return;
    }
    setNotifStatus("loading");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      const json = sub.toJSON();
      // The push_subscriptions table is locked down — the server stores the
      // subscription (see /api/push/subscribe).
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth_key: json.keys.auth,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save this device for notifications.");
      setNotifStatus("subscribed");
    } catch (err) {
      setNotifError(err?.message ?? "Could not turn on notifications. Please try again from the Home Screen app.");
      setNotifStatus("denied");
    }
  };

  // Only treat a class as "live" on the public view when the event itself is
  // live — otherwise a class left in the live state after an event is ended or
  // reverted would keep showing the live banner over the final/closed view.
  // A class with status "live" IS in the arena, whatever the event's own
  // status says — the gate marshal can advance classes while the event sits
  // on "closed", and spectators must not be told nothing is running.
  const liveClass = classes.find((c) => c.status === "live") ?? null;
  const liveClassIndex = liveClass ? classes.findIndex((c) => c.id === liveClass.id) : -1;
  const nextClass = liveClass
    ? classes.slice(liveClassIndex + 1).find((c) => c.status === "upcoming")
      ?? classes.find((c) => c.status === "upcoming" && c.id !== liveClass.id)
      ?? null
    : null;
  // Program breaks sitting between the class in the ring and the next class —
  // the banner should say "break first", not jump straight to the next class.
  const breaksBeforeNext = [];
  if (liveClass) {
    const afterLive = normaliseBreakLabel(liveClass.program_break_after);
    if (afterLive) breaksBeforeNext.push(afterLive);
    const nextIdx = nextClass ? classes.findIndex((c) => c.id === nextClass.id) : -1;
    if (nextIdx > liveClassIndex) {
      for (let i = liveClassIndex + 1; i <= nextIdx; i++) {
        const between = normaliseBreakLabel(classes[i].program_break_before);
        if (between) breaksBeforeNext.push(between);
        if (i < nextIdx) {
          const after = normaliseBreakLabel(classes[i].program_break_after);
          if (after) breaksBeforeNext.push(after);
        }
      }
    }
  }
  const current = liveClass ? firstPending(liveClass.entries, liveClass.scoring_mode) : null;
  const active = liveClass ? liveClass.entries.filter((e) => !e.scratched) : [];
  // The horse on deck (second in the pending draw) for one-at-a-time classes.
  const livePending = liveClass
    ? liveClass.entries.filter((e) => !e.scratched && (liveClass.scoring_mode === "tbc" ? !e.called : e.score == null))
    : [];
  const nextEntry = current ? livePending[1] ?? null : null;
  const drawPos = current ? active.findIndex((e) => e.id === current.id) + 1 : 0;
  const scored = active.filter((e) => liveClass?.scoring_mode === "tbc" ? e.called : e.score != null).length;

  if (!event) return <main className="wrap"><p style={{ color: "var(--quiet)" }}>Loading…</p></main>;

  const isClinic = event.event_type === "clinic";
  const showClassStatusBadges = ["live", "completed", "archived", "cancelled"].includes(event.status);

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
          <div style={{ maxWidth: 1480, margin: "0 auto" }}>
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
                      {spotsRows.map(({ cls, taken, full, remaining }) => {
                        const fee = cls.fee_cents ?? event.entry_fee_cents ?? 0;
                        const dep = cls.deposit_cents ?? 0;
                        return (
                          <div key={cls.id} style={{ fontSize: 14, color: full ? "var(--clay)" : "var(--quiet)", marginBottom: 2 }}>
                            <strong>{cls.name}</strong>
                            {fee > 0 && ` — $${(fee / 100).toFixed(2).replace(/\.00$/, "")}`}
                            {dep > 0 && dep < fee && ` (or $${(dep / 100).toFixed(2).replace(/\.00$/, "")} deposit)`}
                            {remaining != null
                              ? full ? " — Full" : ` — ${remaining} spot${remaining === 1 ? "" : "s"} remaining`
                              : null}
                          </div>
                        );
                      })}
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
  // Tuck completed classes away while the show is still running — the live
  // action stays front and centre and finished scores are one tap away.
  // Once the event is completed/archived, everything shows in full.
  const showOver = event ? ["completed", "archived"].includes(event.status) : true;
  const completedClasses = classes.filter((c) => c.status === "completed");
  const tuckCompleted = !showOver && completedClasses.length > 0;
  const visibleClasses = tuckCompleted ? classes.filter((c) => c.status !== "completed") : classes;

  // One class card (or category/break heading) — shared by the main list
  // and the collapsed completed-classes section.
  const renderClassRow = (row) => {
            if (row.type === "break") {
              return (
                <div key={row.key} className="event-grid-break">
                  {row.label}
                </div>
              );
            }
            if (row.type === "category") {
              return (
                <div key={row.key} className="event-grid-category">
                  {row.label}
                </div>
              );
            }
            const cls = row.cls;
            const mode = cls.scoring_mode ?? "score";
            const isTbcDraw = mode === "tbc";
            const isPlacingMode = mode === "placing" || mode === "class_only" || mode === "tbc_class";
            const twoJudges = !!cls.judge2;
            // Championship classes (schema-v43): 1st/2nd read as Champion/Reserve
            // (a Supreme class's winner reads Supreme).
            const isChamp = Array.isArray(cls.champ_feeder_ids) && cls.champ_feeder_ids.length > 0;
            const champTitle = /supreme/i.test(cls.name ?? "") ? "Supreme" : "Champion";
            // Titles are per judge: each judge's 1st is a Champion, their 2nd
            // a Reserve — a two-judge class can have two Champions.
            const titles = isChamp ? championshipTitles(cls) : null;
            const placed = cls.entries
              .filter((e) => e.score != null && !e.scratched)
              .sort((a, b) => {
                const d = isPlacingMode
                  ? scoreRank(a.score, true) - scoreRank(b.score, true)
                  : scoreRank(b.score, false) - scoreRank(a.score, false);
                return d !== 0 ? d
                  : isPlacingMode
                    ? scoreRank(a.score2, true, 99) - scoreRank(b.score2, true, 99)
                    : scoreRank(b.score2, false, 0) - scoreRank(a.score2, false, 0);
              });
            const calledRows = isTbcDraw ? cls.entries.filter((e) => e.called && e.score == null && !e.scratched) : [];
            const pending = isTbcDraw
              ? cls.entries.filter((e) => !e.called && !e.scratched)
              : cls.entries.filter((e) => e.score == null && !e.scratched);
            const scratchedRows = cls.entries.filter((e) => e.scratched);
            const isLive = cls.status === "live";
            const isClassOnly = mode === "class_only";
            // NOW/NEXT only make sense when horses go in one at a time — in
            // class_only and tbc_class modes the whole class is in together.
            const oneByOne = isLive && !isClassOnly && mode !== "tbc_class";
            return (
              <section key={cls.id} className="card event-class-card" style={isLive ? { borderColor: "var(--brass)" } : {}}>
                <div className="card-head" style={isLive ? { background: "#FBF4E4" } : {}}>
                  <div>
                    <div className="display" style={{ fontWeight: 600, fontSize: 16.5 }}>
                      Class {cls.num} · {cls.name}
                      <span style={{ fontFamily: "Archivo, sans-serif", fontSize: 12, color: "var(--quiet)", fontWeight: 500 }}>
                        {" "}· {cls.entries.filter((e) => !e.scratched).length} entries
                      </span>
                    </div>
                    {(cls.judge || cls.judge2) && (
                      <div style={{ fontSize: 12, color: "var(--quiet)", marginTop: 2 }}>
                        {cls.judge2
                          ? `Judges: ${cls.judge || "—"} (J1) · ${cls.judge2} (J2)`
                          : `Judge: ${cls.judge}`}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {cls.pattern_url && (
                      <a href={cls.pattern_url} target="_blank" rel="noreferrer"
                        style={{ border: "1px solid var(--brass)", color: "var(--brass)", borderRadius: 20, padding: "4px 12px", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
                        ▦ View pattern
                      </a>
                    )}
                    {showClassStatusBadges && <span className={`badge ${cls.status}`}>{cls.status}</span>}
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
                        <td className="display" style={{ fontWeight: 700, color: isChamp ? (titles.champions.has(e.id) ? "var(--brass)" : "var(--quiet)") : i === 0 ? "var(--brass)" : "var(--quiet)", ...(isChamp && (titles.champions.has(e.id) || titles.reserves.has(e.id)) ? { fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" } : {}) }}>
                          {/* Championships award Champion & Reserve only — no
                              placings beyond those (a Supreme has no Reserve). */}
                          {isChamp
                            ? (titles.champions.has(e.id) ? champTitle
                              : titles.reserves.has(e.id) && champTitle !== "Supreme" ? "Reserve" : "·")
                            : i + 1}
                        </td>
                        <td style={{ fontWeight: 600 }}>#{fmtBack(e.back_number)} {e.horse}</td>
                        <td style={{ color: "var(--quiet)" }}>{e.exhibitor}</td>
                        <td className="display" style={{ textAlign: "right", fontWeight: 700 }}>
                          {(() => {
                            const sc = (v) => v == null ? "?" : v === -1 ? "DQ" : isPlacingMode ? ordinal(v) : v;
                            return twoJudges && (isPlacingMode || e.score2 != null)
                              ? `${sc(e.score)} / ${sc(e.score2)}`
                              : sc(e.score);
                          })()}
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
                      <tr key={e.id} style={{ opacity: oneByOne && !isTbcDraw && i > 1 ? 0.7 : 1 }}>
                        <td style={oneByOne && i === 0 ? { color: "var(--clay)", fontSize: 11, fontWeight: 700 }
                          : oneByOne && i === 1 ? { color: "#C77B21", fontSize: 11, fontWeight: 700 }
                          : { color: "var(--quiet)" }}>
                          {oneByOne && i === 0 ? "NOW" : oneByOne && i === 1 ? "NEXT" : placed.length + calledRows.length + i + 1}
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
                {/* Photographed judge's sheets (schema-v45) — one tap from the
                    scoreboard to the paper results. */}
                {Array.isArray(cls.result_sheets) && cls.result_sheets.length > 0 && (
                  <div style={{ padding: "8px 16px", borderTop: "1px solid var(--line)", fontSize: 12.5, color: "#7A5C10", background: "#FDFBF7" }}>
                    📄 Judge&apos;s sheets:{" "}
                    {cls.result_sheets.map((s, i) => (
                      <span key={i}>
                        {i > 0 && " · "}
                        <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "#7A5C10", fontWeight: 700 }}>
                          {s.label}{cls.result_sheets.filter((x) => x.label === s.label).length > 1 ? ` (${cls.result_sheets.slice(0, i + 1).filter((x) => x.label === s.label).length})` : ""}
                        </a>
                      </span>
                    ))}
                  </div>
                )}
              </section>
            );
          };

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 1480, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div className="event-resource-links">
                <Link href={`/event/${id}/schedule`} className="event-resource-link">Schedule</Link>
                <Link href={`/event/${id}/program`} className="event-resource-link prominent">Program</Link>
                <Link href={`/event/${id}/results`} className="event-resource-link prominent">Results</Link>
                <a href={`/api/events/${id}/patterns`} className="event-resource-link prominent">Patterns PDF</a>
              </div>
              <h1 className="display" style={{ fontWeight: 700, fontSize: "clamp(22px,4vw,30px)", margin: "0 0 2px" }}>{event.name}</h1>
              <div style={{ fontSize: 13, color: "#CBBFA9" }}>{event.location}</div>
            </div>
            {VAPID_PUBLIC_KEY && notifStatus !== "subscribed" && notifStatus !== "denied" && (
              iosNeedsInstall ? (
                <button onClick={() => setShowIosHint((v) => !v)}
                  style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.25)", color: "#F2EADB", borderRadius: 20, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", alignSelf: "flex-start", marginTop: 4 }}>
                  📲 Get alerts on your iPhone
                </button>
              ) : (
                <button onClick={subscribePush} disabled={notifStatus === "loading"}
                  style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.25)", color: "#F2EADB", borderRadius: 20, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", alignSelf: "flex-start", marginTop: 4 }}>
                  {notifStatus === "loading" ? "Subscribing…" : "🔔 Get notified"}
                </button>
              )
            )}
            {notifStatus === "subscribed" && (
              <span style={{ fontSize: 12.5, color: "var(--brass-soft)", alignSelf: "flex-start", marginTop: 8 }}>✓ Notifications on</span>
            )}
            {notifStatus === "denied" && iosNeedsInstall && (
              <button onClick={() => setShowIosHint((v) => !v)}
                style={{ background: "transparent", border: "none", color: "var(--brass-soft)", fontSize: 12.5, cursor: "pointer", alignSelf: "flex-start", marginTop: 8, padding: 0, textDecoration: "underline" }}>
                How to get alerts on iPhone
              </button>
            )}
            {notifStatus === "denied" && !iosNeedsInstall && notifError && (
              <span style={{ fontSize: 12.5, color: "var(--brass-soft)", alignSelf: "flex-start", marginTop: 8, maxWidth: 280 }}>
                {notifError}
              </span>
            )}
          </div>
        </div>
      </header>

      {showIosHint && (
        <div className="wrap event-page-wrap" style={{ paddingTop: 14, paddingBottom: 0 }}>
          <section className="card" style={{ border: "1px solid var(--brass)", background: "var(--sand)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div className="display" style={{ fontWeight: 700, fontSize: 15, color: "var(--leather)" }}>Get live alerts on your iPhone</div>
              <button onClick={() => setShowIosHint(false)}
                style={{ background: "transparent", border: "none", color: "var(--quiet)", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 0 }} aria-label="Close">×</button>
            </div>
            <p style={{ fontSize: 13, color: "var(--quiet)", margin: "0 0 10px" }}>
              Apple only lets a website send notifications once you&apos;ve added it to your Home Screen. It takes about 20 seconds:
            </p>
            <ol style={{ fontSize: 13.5, color: "var(--leather)", margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
              <li>Tap the <strong>Share</strong> button — the square with an up-arrow — at the bottom of Safari.</li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
              <li>Open <strong>HCQHA Live</strong> from your Home Screen (the new icon), not from Safari.</li>
              <li>Tap <strong>🔔 Get notified</strong> and choose <strong>Allow</strong>.</li>
            </ol>
            <p style={{ fontSize: 12, color: "var(--quiet)", margin: "10px 0 0" }}>
              Note: this only works on iPhones updated to iOS 16.4 or newer (most iPhones from the last few years).
            </p>
          </section>
        </div>
      )}

      <main className="wrap event-page-wrap">
        {/* ---- Live banner / completed summary / idle ---- */}
        {liveClass && liveClass.scoring_mode === "tbc_class" ? (
          <section className="card" style={{ background: "var(--leather-deep)", color: "#F5EFE4", border: "1px solid var(--brass)", padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--clay)", animation: "pulse 1.6s infinite" }} />
              <span style={{ fontSize: 11.5, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--brass-soft)", fontWeight: 600 }}>
                <LiveClassLabel cls={liveClass} />
              </span>
            </div>
            <div className="display" style={{ fontWeight: 700, fontSize: "clamp(20px,4vw,28px)", lineHeight: 1.2 }}>
              Class in progress
            </div>
            <div style={{ fontSize: 14, color: "#CBBFA9", marginTop: 4 }}>
              Results will be posted once the judge's paperwork is received.
            </div>
            <NextClassPreview cls={nextClass} breaks={breaksBeforeNext} />
          </section>
        ) : liveClass && liveClass.scoring_mode === "class_only" ? (
          <section className="card" style={{ background: "var(--leather-deep)", color: "#F5EFE4", border: "1px solid var(--brass)", padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--clay)", animation: "pulse 1.6s infinite" }} />
              <span style={{ fontSize: 11.5, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--brass-soft)", fontWeight: 600 }}>
                <LiveClassLabel cls={liveClass} />
              </span>
            </div>
            <div className="display" style={{ fontWeight: 700, fontSize: "clamp(20px,4vw,28px)", lineHeight: 1.2 }}>
              Class in progress
            </div>
            {liveClass.judge && (
              <div style={{ fontSize: 14, color: "#CBBFA9", marginTop: 4 }}>Judge: {liveClass.judge}</div>
            )}
            <NextClassPreview cls={nextClass} breaks={breaksBeforeNext} />
          </section>
        ) : liveClass && current ? (
          <section className="card" style={{ background: "var(--leather-deep)", color: "#F5EFE4", border: "1px solid var(--brass)", padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--clay)", animation: "pulse 1.6s infinite" }} />
              <span style={{ fontSize: 11.5, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--brass-soft)", fontWeight: 600 }}>
                <LiveClassLabel cls={liveClass} />
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
            {nextEntry && (
              <div style={{ fontSize: 13.5, color: "#CBBFA9", marginTop: 10 }}>
                <span style={{ fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: "#E8A857", fontWeight: 700, marginRight: 8 }}>Next in</span>
                <span style={{ color: "#F5EFE4", fontWeight: 700 }}>#{fmtBack(nextEntry.back_number)} {nextEntry.horse}</span>
                {nextEntry.exhibitor ? ` — ${nextEntry.exhibitor}` : ""}
              </div>
            )}
            {liveClass.scoring_mode !== "placing" && (
              <div style={{ height: 5, background: "rgba(255,255,255,.12)", borderRadius: 3, marginTop: 14, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(scored / Math.max(active.length, 1)) * 100}%`, background: "var(--brass)", transition: "width .5s ease" }} />
              </div>
            )}
            <NextClassPreview cls={nextClass} breaks={breaksBeforeNext} />
          </section>
        ) : liveClass ? (
          // Live class with no one left to go (e.g. a TBC class where every
          // horse has been through, waiting for the gate to finish it) — the
          // class is still in the arena; never claim nothing is running.
          <section className="card" style={{ background: "var(--leather-deep)", color: "#F5EFE4", border: "1px solid var(--brass)", padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--clay)", animation: "pulse 1.6s infinite" }} />
              <span style={{ fontSize: 11.5, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--brass-soft)", fontWeight: 600 }}>
                <LiveClassLabel cls={liveClass} />
              </span>
            </div>
            <div className="display" style={{ fontWeight: 700, fontSize: "clamp(18px,4vw,24px)", lineHeight: 1.15 }}>
              All horses have been through
            </div>
            <div style={{ fontSize: 14, color: "#CBBFA9", marginTop: 3 }}>
              {liveClass.scoring_mode === "tbc" || liveClass.scoring_mode === "tbc_class"
                ? "Results will be posted once received from the judge."
                : "Results are being finalised."}
            </div>
            <NextClassPreview cls={nextClass} breaks={breaksBeforeNext} />
          </section>
        ) : ["completed", "archived"].includes(event.status) ? (
          // No banner once the show is over — the full scoreboards are right
          // below, and the printable Results page is linked in the header.
          null
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
        <div className="event-class-grid">
          {tuckCompleted && (
            <details className="card" style={{ padding: "12px 16px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--quiet)", fontSize: 14 }}>
                Completed classes ({completedClasses.length}) — tap to see scores
              </summary>
              <div className="event-class-grid" style={{ marginTop: 10 }}>
                {programDisplayRows(completedClasses).map(renderClassRow)}
              </div>
            </details>
          )}
          {programDisplayRows(visibleClasses).map(renderClassRow)}
        </div>
      </main>
    </>
  );
}
