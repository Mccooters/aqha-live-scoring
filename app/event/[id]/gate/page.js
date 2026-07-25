"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { supabase } from "../../../../lib/supabaseClient";

// Gate marshal view (schema-v44). Opened via the link the coordinator shares
// (…/gate?code=123456). Shows the live class and the draw, with just the
// controls the gate needs: mark the current TBC-draw horse as gone in, and
// scratch/restore entries. Reading uses the normal public access; the two
// actions go through /api/gate with the event's code. No staff login.

const fmtBack = (n) => String(n ?? "").padStart(3, "0");
const firstPending = (entries, mode) =>
  mode === "tbc"
    ? entries.find((e) => !e.called && !e.scratched) ?? null
    : entries.find((e) => e.score == null && !e.scratched) ?? null;

export default function GatePage() {
  const { id } = useParams();
  const search = useSearchParams();
  const [event, setEvent] = useState(null);
  const [classes, setClasses] = useState([]);
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const storageKey = `gate-code-${id}`;

  const load = useCallback(async () => {
    const [{ data: ev }, { data: cls }] = await Promise.all([
      supabase.from("events").select("*").eq("id", id).single(),
      supabase.from("classes").select("*, entries(*)").eq("event_id", id).order("sort_order"),
    ]);
    if (ev) setEvent(ev);
    if (cls) {
      const visible = cls.filter((c) => !c.hidden);
      visible.forEach((c) => c.entries.sort((a, b) => (a.draw_order ?? 0) - (b.draw_order ?? 0)));
      setClasses(visible);
    }
  }, [id]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`gate-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "entries" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "classes" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [id, load]);

  const verify = useCallback(async (candidate) => {
    setChecking(true);
    setError("");
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: id, code: candidate, action: "check" }),
      });
      const data = await res.json();
      if (data.ok) {
        setCode(candidate);
        setVerified(true);
        try { localStorage.setItem(storageKey, candidate); } catch {}
      } else {
        setError(data.error ?? "That code didn't work.");
        setVerified(false);
      }
    } catch {
      setError("Could not connect — try again.");
    } finally {
      setChecking(false);
    }
  }, [id, storageKey]);

  useEffect(() => {
    const fromLink = search.get("code");
    let stored = null;
    try { stored = localStorage.getItem(storageKey); } catch {}
    const candidate = fromLink || stored;
    if (candidate) verify(candidate);
    else setChecking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (action, entryId, classId) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: id, code, action, entry_id: entryId, class_id: classId }),
      });
      const data = await res.json();
      if (!data.ok) setError(data.error ?? "That didn't work — try again.");
      await load();
    } catch {
      setError("Could not connect — try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!event) return <main className="wrap"><p style={{ color: "var(--quiet)" }}>Loading…</p></main>;

  if (!verified) {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <h1 className="display" style={{ fontWeight: 700, fontSize: 22 }}>Gate — {event.name}</h1>
        <p style={{ fontSize: 13.5, color: "var(--quiet)" }}>
          Open the link the coordinator shared — or paste its gate code here.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="field" style={{ flex: 1, fontSize: 16 }}
            value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste the gate code" />
          <button className="btn" style={{ background: "var(--leather)" }} disabled={checking || !code.trim()}
            onClick={() => verify(code.trim())}>
            {checking ? "Checking…" : "Open gate view"}
          </button>
        </div>
        {error && <p style={{ color: "var(--clay)", fontWeight: 700, fontSize: 13.5 }}>{error}</p>}
      </main>
    );
  }

  const liveClass = classes.find((c) => c.status === "live") ?? null;
  const upcoming = classes.filter((c) => c.status === "upcoming");
  const current = liveClass ? firstPending(liveClass.entries, liveClass.scoring_mode ?? "score") : null;
  const isTbc = (liveClass?.scoring_mode ?? "score") === "tbc";
  // How many are still to go through — with one horse left, the button must
  // not promise a "next horse" that doesn't exist.
  const stillToGo = isTbc && liveClass
    ? liveClass.entries.filter((e) => !e.called && !e.scratched).length
    : 0;

  const entryRow = (e, cls) => (
    <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "7px 0", borderBottom: "1px solid var(--line)", opacity: e.scratched ? 0.55 : 1 }}>
      <span style={{ fontSize: 14.5, fontWeight: 600, textDecoration: e.scratched ? "line-through" : "none" }}>
        #{fmtBack(e.back_number)} {e.horse} <span style={{ color: "var(--quiet)", fontWeight: 400 }}>· {e.exhibitor}</span>
      </span>
      {e.scratched ? (
        <button className="btn-ghost" style={{ fontSize: 12 }} disabled={busy} onClick={() => act("restore", e.id)}>Restore</button>
      ) : (e.score == null && !(cls.scoring_mode === "tbc" && e.called)) ? (
        <button className="btn-ghost" style={{ fontSize: 12, color: "var(--clay)", borderColor: "var(--clay)" }} disabled={busy} onClick={() => act("scratch", e.id)}>Scratch</button>
      ) : null}
    </div>
  );

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>Gate</div>
          <h1 className="display" style={{ fontWeight: 700, fontSize: "clamp(18px,4vw,26px)", margin: "2px 0", color: "#F2EADB" }}>{event.name}</h1>
        </div>
      </header>
      <main className="wrap">
        {error && <p style={{ color: "var(--clay)", fontWeight: 700, fontSize: 13.5 }}>{error}</p>}

        {liveClass ? (
          <section className="card" style={{ borderColor: "var(--brass)" }}>
            <div style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--clay)" }}>Now in the ring</div>
              <div className="display" style={{ fontWeight: 700, fontSize: 18, margin: "2px 0 8px" }}>
                Class {liveClass.num} · {liveClass.name}
              </div>
              {current ? (
                <>
                  <div className="display" style={{ fontWeight: 800, fontSize: 26, color: "var(--leather)" }}>
                    #{fmtBack(current.back_number)} {current.horse}
                  </div>
                  <div style={{ color: "var(--quiet)", marginBottom: 12 }}>{current.exhibitor}</div>
                  {isTbc ? (
                    <button className="btn" style={{ width: "100%", fontSize: 17, padding: 14, background: "var(--leather)" }}
                      disabled={busy} onClick={() => act("called", current.id)}>
                      {busy ? "Saving…" : stillToGo <= 1 ? "✓ Gone in — that's everyone" : "✓ Gone in — next horse"}
                    </button>
                  ) : (
                    <p style={{ fontSize: 12.5, color: "var(--quiet)", margin: 0 }}>
                      The coordinator advances this class as scores are entered — you can scratch from the lists below.
                    </p>
                  )}
                </>
              ) : (
                <p style={{ color: "var(--quiet)", margin: 0 }}>Everyone in this class has been through.</p>
              )}
              <div style={{ marginTop: 12 }}>
                {liveClass.entries.map((e) => entryRow(e, liveClass))}
              </div>
              {/* On paperwork (TBC) days classes never auto-complete from
                  scoring — and a championship fed by TBC classes can sit here
                  with an empty draw. This moves the show to the next class. */}
              <button className="btn"
                style={{ width: "100%", marginTop: 12, fontSize: 15, padding: 12, background: current ? "transparent" : "var(--leather)", color: current ? "var(--leather)" : "#fff", border: current ? "1px solid var(--line)" : "none" }}
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Finish Class ${liveClass.num} · ${liveClass.name} and start the next class?\n\nResults from the judge's paperwork are entered by the coordinator later.`)) {
                    act("advance_class", null, liveClass.id);
                  }
                }}>
                ✓ Class finished — start next class
              </button>
            </div>
          </section>
        ) : (
          <section className="card" style={{ padding: 20, textAlign: "center" }}>
            <p style={{ margin: 0, color: "var(--quiet)" }}>No class is live right now.</p>
          </section>
        )}

        {upcoming.slice(0, 5).map((cls) => (
          <section className="card" key={cls.id}>
            <div style={{ padding: "12px 16px" }}>
              <div className="display" style={{ fontWeight: 700, fontSize: 15 }}>Class {cls.num} · {cls.name}</div>
              <div style={{ marginTop: 6 }}>
                {cls.entries.length === 0
                  ? <p style={{ color: "var(--quiet)", fontSize: 13, margin: 0 }}>No entries yet.</p>
                  : cls.entries.map((e) => entryRow(e, cls))}
              </div>
            </div>
          </section>
        ))}
      </main>
    </>
  );
}
