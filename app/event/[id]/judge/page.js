"use client";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { supabase } from "../../../../lib/supabaseClient";
import { storeGet, storeSet, deviceId, newId, precacheShell } from "../../../../lib/judgeStore";
import { fmtBack, ordinal } from "../../../../lib/showPrint";

// Judge's view (schema-v63, stage 1). Opened via the per-judge link the
// coordinator shares (…/judge?code=…). The whole show downloads to the
// device; every tap is saved on the device first; a finished card queues and
// sends itself when there is reception. One card per judge per class — the
// other judge's card only shows after this judge has finished the class.
//
// Stage 1 cards: PLACINGS (halter, rail, TBC and championship classes —
// back numbers in order, like the AQHA Judges Result Card) and SCORES (70-
// point classes — a score per horse, placings worked out from the scores,
// like the general score sheet). Pattern cards with manoeuvre boxes come in
// stage 2.

const POLL_MS = 25000;
const cardTypeFor = (cls) => ((cls?.scoring_mode ?? "score") === "score" ? "scores" : "placings");
const scoreTxt = (v) => (v == null ? "" : String(v));
const fmtTime = (iso) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch { return ""; }
};

// Order the horses the way the judge placed them. Placings cards: by the
// place the judge gave. Scores cards: highest score first, DQs last, ties
// in the order the judge set with ▲▼ (tie_rank), else draw order.
function placedOrder(cls, card) {
  const results = card?.results ?? {};
  const active = (cls?.entries ?? []).filter((e) => !e.scratched);
  if ((card?.card_type ?? cardTypeFor(cls)) === "placings") {
    return active
      .filter((e) => results[e.id]?.place != null && !results[e.id]?.dq)
      .sort((a, b) => results[a.id].place - results[b.id].place);
  }
  return active
    .filter((e) => results[e.id]?.score != null && !results[e.id]?.dq)
    .sort((a, b) => {
      const ra = results[a.id], rb = results[b.id];
      if (rb.score !== ra.score) return rb.score - ra.score;
      const ta = ra.tie_rank ?? Number.MAX_SAFE_INTEGER, tb = rb.tie_rank ?? Number.MAX_SAFE_INTEGER;
      if (ta !== tb) return ta - tb;
      return (a.draw_order ?? 0) - (b.draw_order ?? 0);
    });
}

// A score box that commits when the judge leaves it (blur / Enter / Done),
// so a row doesn't jump up the placings list while "72.5" is half typed.
function ScoreBox({ value, onCommit, placeholder }) {
  const [draft, setDraft] = useState(scoreTxt(value));
  useEffect(() => { setDraft(scoreTxt(value)); }, [value]);
  const commit = () => {
    const v = draft.trim() === "" ? null : Number(draft);
    if (v != null && !Number.isFinite(v)) { setDraft(scoreTxt(value)); return; }
    if (v !== (value ?? null)) onCommit(v);
  };
  return (
    <input className="field" type="number" step="0.5" inputMode="decimal" placeholder={placeholder}
      style={{ width: 84, fontSize: 18, textAlign: "center", padding: "8px 4px" }}
      value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }} />
  );
}

export default function JudgePage() {
  const { id } = useParams();
  const search = useSearchParams();
  const storageKey = `judge-code-${id}`;

  const [phase, setPhase] = useState("loading"); // loading | needs-code | ready
  const [codeVal, setCodeVal] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [judgeName, setJudgeName] = useState("");
  const [entryMode, setEntryMode] = useState("judge");
  const [snapshot, setSnapshot] = useState(null);
  const [cards, setCards] = useState({});   // class id -> local card
  const [queue, setQueue] = useState([]);   // class ids waiting to send
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState({ kind: "list" });
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [showPattern, setShowPattern] = useState(false);
  const [scribeName, setScribeName] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const flushing = useRef(false);
  const stateRef = useRef({ cards: {}, queue: [], codeVal: "", snapshot: null });
  stateRef.current = { cards, queue, codeVal, snapshot };

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  useEffect(() => { try { setScribeName(localStorage.getItem("judge-scribe-name") ?? ""); } catch {} }, []);

  // ---- persistence ----
  const persistCards = useCallback(async (next) => { setCards(next); await storeSet(`judge:${id}:cards`, next); }, [id]);
  const persistQueue = useCallback(async (next) => { setQueue(next); await storeSet(`judge:${id}:queue`, next); }, [id]);

  const post = useCallback(async (action, extra = {}) => {
    const res = await fetch("/api/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: id, code: stateRef.current.codeVal || extra.code, action, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }, [id]);

  // Merge the server's cards into the device's: a draft on the device always
  // wins (unsent work); a card the secretary UNLOCKED reopens as a draft; a
  // card this device never saw (reinstall, second device) is adopted as sent.
  const mergeServerCards = useCallback((local, serverCards, classes) => {
    const next = { ...local };
    for (const sc of serverCards ?? []) {
      const cls = classes.find((c) => c.id === sc.class_id);
      if (!cls || cls.judge_slot !== sc.judge_slot) continue;
      const cur = next[sc.class_id];
      const results = {};
      (sc.results ?? []).forEach((r) => { results[r.entry_id] = { place: r.place, score: r.score, dq: !!r.dq, note: r.note ?? "" }; });
      if (!cur) {
        next[sc.class_id] = {
          id: sc.id, class_id: sc.class_id, judge_slot: sc.judge_slot, card_type: sc.card_type ?? cardTypeFor(cls),
          status: sc.status === "unlocked" ? "draft" : "sent", results, notes: sc.notes ?? "", entered_by: sc.entered_by ?? "",
          version: sc.version ?? 1, signed_at: sc.signed_at, sent_at: sc.received_at, unlocked: sc.status === "unlocked",
        };
      } else if (cur.status === "sent" && sc.status === "unlocked" && sc.id === cur.id) {
        next[sc.class_id] = { ...cur, status: "draft", unlocked: true };
      } else if (cur.status === "signed" && sc.status === "signed" && sc.id === cur.id && (sc.version ?? 1) >= (cur.version ?? 1)) {
        next[sc.class_id] = { ...cur, status: "sent", sent_at: sc.received_at };
      }
    }
    return next;
  }, []);

  const refresh = useCallback(async () => {
    if (!stateRef.current.codeVal || (typeof navigator !== "undefined" && !navigator.onLine)) return false;
    setSyncing(true);
    try {
      const { status, data } = await post("snapshot");
      if (status === 403) { setError(data.error ?? "This judge link is no longer valid."); return false; }
      if (!data.ok) { setError(data.error ?? "Could not update the show from the server."); return false; }
      setError("");
      setSnapshot(data);
      setJudgeName(data.judge_name);
      setEntryMode(data.entry_mode ?? "judge");
      await storeSet(`judge:${id}:snapshot`, data);
      const merged = mergeServerCards(stateRef.current.cards, data.cards, data.classes);
      await persistCards(merged);
      return true;
    } catch {
      return false;
    } finally {
      setSyncing(false);
    }
  }, [id, post, mergeServerCards, persistCards]);

  // Send every finished card in the queue, oldest first. A card the server
  // refuses (class closed and locked) comes off the queue with the reason;
  // a dropped connection leaves the rest to try again next time.
  const flush = useCallback(async () => {
    if (flushing.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    flushing.current = true;
    try {
      let q = [...stateRef.current.queue];
      let c = { ...stateRef.current.cards };
      let changed = false;
      while (q.length) {
        const classId = q[0];
        const card = c[classId];
        if (!card || card.status !== "signed") { q.shift(); changed = true; continue; }
        const payload = {
          id: card.id, class_id: classId, judge_slot: card.judge_slot, card_type: card.card_type,
          results: Object.entries(card.results).map(([entry_id, r]) => ({ entry_id, place: r.place ?? null, score: r.score ?? null, dq: !!r.dq, note: r.note || null })),
          notes: card.notes || null, entered_by: card.entered_by || null, device_id: deviceId(), version: card.version, signed_at: card.signed_at,
        };
        let res;
        try { res = await post("submit", { card: payload }); } catch { break; }
        if (res.status >= 500) break; // server hiccup — keep it queued and try again later
        if (res.data?.ok) {
          c = { ...c, [classId]: { ...card, status: "sent", sent_at: new Date().toISOString(), error: "", unlocked: false, class_status: res.data.class_status, waiting: res.data.waiting_for_other_judge } };
        } else {
          c = { ...c, [classId]: { ...card, status: "rejected", error: res.data?.error ?? "The server would not accept this card." } };
        }
        q.shift();
        changed = true;
        await storeSet(`judge:${id}:cards`, c);
        await storeSet(`judge:${id}:queue`, q);
      }
      if (changed) { setCards(c); setQueue(q); }
    } finally {
      flushing.current = false;
    }
  }, [id, post]);

  const syncAll = useCallback(async () => { await flush(); await refresh(); }, [flush, refresh]);

  // ---- start-up: device copy first (works offline), then the server ----
  useEffect(() => {
    (async () => {
      const fromLink = search.get("code");
      let stored = null;
      try { stored = localStorage.getItem(storageKey); } catch {}
      const candidate = fromLink || stored;
      const [snap, localCards, localQueue] = await Promise.all([
        storeGet(`judge:${id}:snapshot`), storeGet(`judge:${id}:cards`), storeGet(`judge:${id}:queue`),
      ]);
      if (localCards) setCards(localCards);
      if (localQueue) setQueue(localQueue);
      if (snap && (!fromLink || fromLink === stored)) {
        setSnapshot(snap); setJudgeName(snap.judge_name); setEntryMode(snap.entry_mode ?? "judge");
      }
      if (!candidate) { setPhase("needs-code"); return; }
      setCodeVal(candidate);
      stateRef.current.codeVal = candidate;
      if (snap && (!fromLink || fromLink === stored)) setPhase("ready");
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        if (!snap) { setPhase("needs-code"); setError("No reception, and this event hasn't been downloaded to this device yet. Open the judge link once while you have a signal."); }
        return;
      }
      const { status, data } = await post("check", { code: candidate });
      if (data.ok) {
        try { localStorage.setItem(storageKey, candidate); } catch {}
        setJudgeName(data.judge_name); setEntryMode(data.entry_mode ?? "judge");
        await refresh();
        await flush();
        setPhase("ready");
      } else if (snap && status !== 403) {
        setPhase("ready"); // server hiccup — carry on with the device copy
      } else {
        setPhase("needs-code");
        setError(data.error ?? "That judge link didn't work.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verifyTyped = async () => {
    const candidate = codeInput.trim();
    if (!candidate) return;
    setError("");
    setCodeVal(candidate);
    stateRef.current.codeVal = candidate;
    const { data } = await post("check", { code: candidate });
    if (data.ok) {
      try { localStorage.setItem(storageKey, candidate); } catch {}
      setJudgeName(data.judge_name); setEntryMode(data.entry_mode ?? "judge");
      await refresh();
      setPhase("ready");
    } else {
      setError(data.error ?? "That code didn't work.");
    }
  };

  // ---- keep in step: live changes, reconnects, a timer, the SW shell ----
  useEffect(() => {
    if (phase !== "ready") return;
    let timer = null;
    const bump = () => { clearTimeout(timer); timer = setTimeout(syncAll, 800); };
    const channel = supabase
      .channel(`judge-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "entries" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "classes", filter: `event_id=eq.${id}` }, bump)
      .subscribe();
    const poll = setInterval(() => { if (document.visibilityState === "visible") syncAll(); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") syncAll(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", syncAll);
    window.addEventListener("pageshow", syncAll);
    return () => {
      clearTimeout(timer); clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", syncAll); window.removeEventListener("pageshow", syncAll);
      supabase.removeChannel(channel);
    };
  }, [phase, id, syncAll]);

  useEffect(() => {
    if (phase !== "ready" || !snapshot) return;
    (async () => {
      try {
        if ("serviceWorker" in navigator) { await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready; }
        await precacheShell(snapshot.classes.map((c) => c.pattern_url).filter(Boolean));
      } catch {}
    })();
  }, [phase, snapshot]);

  // ---- card editing (every change is written to the device at once) ----
  const classes = snapshot?.classes ?? [];
  const classById = useMemo(() => Object.fromEntries(classes.map((c) => [c.id, c])), [classes]);
  const liveClass = classes.find((c) => c.status === "live") ?? null;

  const ensureCard = (cls) => cards[cls.id] ?? {
    id: newId(), class_id: cls.id, judge_slot: cls.judge_slot, card_type: cardTypeFor(cls),
    status: "draft", results: {}, notes: "", entered_by: "", version: 0,
  };
  const updateCard = (cls, fn) => {
    const cur = ensureCard(cls);
    if (cur.status === "sent" || cur.status === "signed") return;
    const nextCard = fn({ ...cur, results: { ...cur.results } });
    persistCards({ ...cards, [cls.id]: nextCard });
  };
  const setResult = (cls, entryId, patch) => updateCard(cls, (c) => {
    c.results[entryId] = { ...(c.results[entryId] ?? {}), ...patch };
    return c;
  });
  const placeNext = (cls, entry) => {
    const card = ensureCard(cls);
    const max = Math.max(0, ...Object.values(card.results).map((r) => (r.dq ? 0 : r.place ?? 0)));
    setResult(cls, entry.id, { place: max + 1, dq: false });
  };
  const unplace = (cls, entry) => updateCard(cls, (c) => {
    const gone = c.results[entry.id]?.place;
    c.results[entry.id] = { ...(c.results[entry.id] ?? {}), place: null };
    if (gone != null) {
      Object.keys(c.results).forEach((k) => {
        const p = c.results[k].place;
        if (p != null && p > gone) c.results[k] = { ...c.results[k], place: p - 1 };
      });
    }
    return c;
  });
  const toggleDq = (cls, entry) => updateCard(cls, (c) => {
    const r = c.results[entry.id] ?? {};
    if (r.dq) { c.results[entry.id] = { ...r, dq: false }; return c; }
    const gone = r.place;
    c.results[entry.id] = { ...r, dq: true, place: null };
    if (gone != null) {
      Object.keys(c.results).forEach((k) => {
        const p = c.results[k].place;
        if (p != null && p > gone) c.results[k] = { ...c.results[k], place: p - 1 };
      });
    }
    return c;
  });
  // ▲▼ in the placings list. Placings cards swap the two places; scores
  // cards only reorder within a tie (equal scores) — the score decides the rest.
  const move = (cls, index, dir) => {
    const card = ensureCard(cls);
    const order = placedOrder(cls, card);
    const j = index + dir;
    if (j < 0 || j >= order.length) return;
    if (card.card_type === "placings") {
      updateCard(cls, (c) => {
        const a = order[index].id, b = order[j].id;
        const pa = c.results[a].place, pb = c.results[b].place;
        c.results[a] = { ...c.results[a], place: pb };
        c.results[b] = { ...c.results[b], place: pa };
        return c;
      });
    } else {
      if (card.results[order[index].id].score !== card.results[order[j].id].score) return;
      const swapped = [...order];
      [swapped[index], swapped[j]] = [swapped[j], swapped[index]];
      updateCard(cls, (c) => {
        swapped.forEach((e, i) => { c.results[e.id] = { ...c.results[e.id], tie_rank: i }; });
        return c;
      });
    }
  };

  const finishClass = (cls) => {
    const card = ensureCard(cls);
    const enteredBy = entryMode === "scribe" ? scribeName.trim() : "";
    const signed = {
      ...card, status: "signed", signed_at: new Date().toISOString(), version: (card.version ?? 0) + 1,
      entered_by: enteredBy, error: "", unlocked: false,
    };
    // Scores cards carry their worked-out placings too, for the record.
    if (signed.card_type === "scores") {
      placedOrder(cls, signed).forEach((e, i) => { signed.results[e.id] = { ...signed.results[e.id], place: i + 1 }; });
    }
    const nextCards = { ...cards, [cls.id]: signed };
    const nextQueue = queue.includes(cls.id) ? queue : [...queue, cls.id];
    setConfirmFinish(false);
    Promise.all([persistCards(nextCards), persistQueue(nextQueue)]).then(() => {
      stateRef.current = { ...stateRef.current, cards: nextCards, queue: nextQueue };
      syncAll();
    });
    setView({ kind: "list" });
    setNotice(`Class ${cls.num} finished. ${online ? "Sending…" : "No reception — it will send itself when you have a signal."}`);
  };

  // Reopen for a correction: allowed while the class is still open (the
  // other judge hasn't finished) or after the secretary unlocks the card.
  const reopenCard = (cls) => {
    const card = cards[cls.id];
    if (!card) return;
    const serverClosed = classById[cls.id]?.status === "completed";
    if (serverClosed && !card.unlocked && card.status !== "rejected") {
      window.alert(`Class ${cls.num} is closed. Ask the secretary to unlock your card if a correction is needed.`);
      return;
    }
    if (!window.confirm(`Reopen your card for Class ${cls.num}? You'll need to finish the class again afterwards.`)) return;
    persistCards({ ...cards, [cls.id]: { ...card, status: "draft", error: "" } });
    persistQueue(queue.filter((q) => q !== cls.id));
  };

  // ---- screens ----
  if (phase === "loading") return <main className="wrap"><p style={{ color: "var(--quiet)" }}>Loading…</p></main>;

  if (phase === "needs-code") {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <h1 className="display" style={{ fontWeight: 700, fontSize: 22 }}>Judge&apos;s cards</h1>
        <p style={{ fontSize: 13.5, color: "var(--quiet)" }}>
          Open the link the coordinator sent you — or paste its code here. Do this once while you have reception; after that it works without one.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="field" style={{ flex: 1, fontSize: 16 }} value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="Paste the judge code" />
          <button className="btn" style={{ background: "var(--leather)" }} disabled={!codeInput.trim()} onClick={verifyTyped}>Open</button>
        </div>
        {error && <p style={{ color: "var(--clay)", fontWeight: 700, fontSize: 13.5 }}>{error}</p>}
      </main>
    );
  }

  const event = snapshot?.event;
  const pendingCount = queue.length;
  const statusOf = (cls) => {
    const card = cards[cls.id];
    if (!card) return cls.status === "completed" ? { label: "Closed — no card from you", tone: "quiet" } : { label: "Not started", tone: "quiet" };
    if (card.status === "draft") return { label: card.unlocked ? "Unlocked for correction" : "In progress", tone: card.unlocked ? "warn" : "brass" };
    if (card.status === "signed") return { label: online ? "Sending…" : "Waiting for signal", tone: "warn" };
    if (card.status === "rejected") return { label: "Not accepted", tone: "clay" };
    if (card.waiting && cls.status !== "completed") return { label: "Sent · waiting for the other judge", tone: "green" };
    return { label: "Sent ✓", tone: "green" };
  };
  const toneColor = { quiet: "var(--quiet)", brass: "var(--brass)", warn: "#A05000", clay: "var(--clay)", green: "#2D7A52" };

  const ClassStatusLine = ({ cls }) => {
    const s = statusOf(cls);
    return <span style={{ fontSize: 12, fontWeight: 700, color: toneColor[s.tone] }}>{s.label}</span>;
  };

  const header = (
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--quiet)", fontWeight: 800 }}>Judge&apos;s cards</div>
        <h1 className="display" style={{ fontWeight: 700, fontSize: 21, margin: "2px 0 0" }}>{event?.name ?? "Show"}</h1>
        <div style={{ fontSize: 13.5, color: "var(--quiet)", marginTop: 2 }}>Judge: <b style={{ color: "var(--ink)" }}>{judgeName}</b></div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", padding: "3px 10px", borderRadius: 20, background: online ? "#E4F1E8" : "#F6E7D8", color: online ? "#2D7A52" : "#A05000" }}>
          {online ? (syncing ? "● SYNCING" : "● ONLINE") : "○ NO SIGNAL"}
        </span>
        {pendingCount > 0 && (
          <button className="btn-ghost" onClick={syncAll} style={{ borderColor: "#A05000", color: "#A05000" }}>
            {pendingCount} card{pendingCount === 1 ? "" : "s"} to send {online ? "· Send now" : ""}
          </button>
        )}
        {snapshot?.fetched_at && <span style={{ fontSize: 11, color: "var(--quiet)" }}>Show updated {fmtTime(snapshot.fetched_at)}</span>}
      </div>
    </header>
  );

  const scribeBox = entryMode === "scribe" && (
    <div className="card" style={{ padding: "10px 14px", marginBottom: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--quiet)" }}>Scribe entering for {judgeName}:</span>
      <input className="field" style={{ fontSize: 15, padding: "7px 10px", flex: 1, minWidth: 160 }} placeholder="Your name"
        value={scribeName} onChange={(e) => { setScribeName(e.target.value); try { localStorage.setItem("judge-scribe-name", e.target.value); } catch {} }} />
    </div>
  );

  // ---- card view ----
  if (view.kind === "card" && classById[view.classId]) {
    const cls = classById[view.classId];
    const card = ensureCard(cls);
    const locked = card.status === "sent" || card.status === "signed";
    const active = cls.entries.filter((e) => !e.scratched);
    const scratched = cls.entries.filter((e) => e.scratched);
    const order = placedOrder(cls, card);
    const placedIds = new Set(order.map((e) => e.id));
    const isScores = card.card_type === "scores";
    const otherCard = (snapshot?.cards ?? []).find((k) => k.class_id === cls.id && k.judge_slot !== cls.judge_slot);
    const canSeeOther = otherCard && (locked || cls.status === "completed");
    const otherName = cls.judge_slot === 1 ? cls.judge2 : cls.judge;
    const unplaced = active.filter((e) => !placedIds.has(e.id) && !card.results[e.id]?.dq);
    const dqs = active.filter((e) => card.results[e.id]?.dq);
    const scribeMissing = entryMode === "scribe" && !scribeName.trim();

    const row = (e, extra) => (
      <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderTop: "1px solid var(--line)" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="display" style={{ fontSize: 18, fontWeight: 700 }}>#{fmtBack(e.back_number)} <span style={{ fontWeight: 600 }}>{e.horse}</span></div>
          <div style={{ fontSize: 12.5, color: "var(--quiet)" }}>{e.exhibitor}</div>
          {!locked && (
            <input className="field" style={{ fontSize: 13, padding: "5px 8px", marginTop: 6, width: "100%", display: card.results[e.id]?.note || card.results[e.id]?.showNote ? "block" : "none" }}
              placeholder="Comment (optional)" value={card.results[e.id]?.note ?? ""} onChange={(ev) => setResult(cls, e.id, { note: ev.target.value })} />
          )}
          {locked && card.results[e.id]?.note && <div style={{ fontSize: 12.5, marginTop: 3, fontStyle: "italic" }}>{card.results[e.id].note}</div>}
        </div>
        {extra}
      </div>
    );

    return (
      <main className="wrap" style={{ maxWidth: 640 }}>
        <button className="btn-ghost" onClick={() => setView({ kind: "list" })} style={{ marginBottom: 10 }}>← All classes</button>
        <section className="card" style={{ borderColor: cls.status === "live" ? "var(--brass)" : undefined }}>
          <div className="card-head" style={{ alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}>
              <div className="display" style={{ fontWeight: 700, fontSize: 18 }}>Class {cls.num} · {cls.name}</div>
              <div style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 2 }}>
                {isScores ? "Score each horse — placings follow the scores" : "Tap the horses in placing order"} · {active.length} in class
                {cls.judge2 && <> · you are Judge {cls.judge_slot}</>}
              </div>
              <div style={{ marginTop: 4 }}><ClassStatusLine cls={cls} /></div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {cls.pattern_url && <button className="btn-ghost" onClick={() => setShowPattern(true)}>Pattern</button>}
              <span className={`badge ${cls.status}`}>{cls.status === "live" ? "In the ring" : cls.status}</span>
            </div>
          </div>

          {card.status === "rejected" && (
            <div style={{ padding: "10px 14px", background: "#FBE9E4", color: "var(--clay)", fontSize: 13.5, fontWeight: 700 }}>
              Not accepted: {card.error} <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={() => reopenCard(cls)}>Reopen</button>
            </div>
          )}
          {card.unlocked && card.status === "draft" && (
            <div style={{ padding: "10px 14px", background: "#FBF4E4", color: "#A05000", fontSize: 13.5, fontWeight: 700 }}>
              The secretary unlocked this card — make the correction and finish the class again.
            </div>
          )}

          {/* Placings so far */}
          <div style={{ padding: "10px 12px 4px", fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 800, color: "var(--quiet)" }}>
            Placings {order.length ? `(${order.length})` : ""}
          </div>
          {order.length === 0 && <div style={{ padding: "4px 12px 12px", fontSize: 13, color: "var(--quiet)" }}>{isScores ? "No scores yet." : "Nothing placed yet — tap “Place next” on a horse below."}</div>}
          {order.map((e, i) => {
            const r = card.results[e.id];
            const tie = isScores && ((order[i - 1] && card.results[order[i - 1].id].score === r.score) || (order[i + 1] && card.results[order[i + 1].id].score === r.score));
            return row(e, (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <div style={{ textAlign: "center", minWidth: 54 }}>
                  <div className="display" style={{ fontWeight: 800, fontSize: 20, color: "var(--clay)" }}>{ordinal(i + 1)}</div>
                  {isScores && <div style={{ fontSize: 12, fontWeight: 700, color: tie ? "#A05000" : "var(--quiet)" }}>{scoreTxt(r.score)}{tie ? " tie" : ""}</div>}
                </div>
                {!locked && (
                  <div style={{ display: "grid", gap: 4 }}>
                    <button className="btn-ghost" onClick={() => move(cls, i, -1)} disabled={i === 0 || (isScores && !(order[i - 1] && card.results[order[i - 1].id].score === r.score))} aria-label="Move up">▲</button>
                    <button className="btn-ghost" onClick={() => move(cls, i, 1)} disabled={i === order.length - 1 || (isScores && !(order[i + 1] && card.results[order[i + 1].id].score === r.score))} aria-label="Move down">▼</button>
                  </div>
                )}
                {!locked && !isScores && <button className="btn-ghost" onClick={() => unplace(cls, e)}>Remove</button>}
                {!locked && isScores && (
                  <ScoreBox value={r.score} onCommit={(v) => setResult(cls, e.id, { score: v })} />
                )}
              </div>
            ));
          })}

          {/* Still to place / score */}
          {unplaced.length > 0 && (
            <div style={{ padding: "12px 12px 4px", fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 800, color: "var(--quiet)", borderTop: "2px solid var(--line)" }}>
              {isScores ? "To score" : "Not placed"} ({unplaced.length}) · draw order
            </div>
          )}
          {unplaced.map((e) => row(e, (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              {!locked && (
                <button className="btn-ghost" style={{ padding: "6px 8px" }} onClick={() => setResult(cls, e.id, { showNote: !card.results[e.id]?.showNote })} aria-label="Comment">✎</button>
              )}
              {!locked && (isScores ? (
                <ScoreBox value={null} placeholder="Score" onCommit={(v) => { if (v != null) setResult(cls, e.id, { score: v, dq: false }); }} />
              ) : (
                <button className="btn" style={{ background: "var(--leather)", padding: "8px 12px", fontSize: 14 }} onClick={() => placeNext(cls, e)}>Place {ordinal(order.length + 1)}</button>
              ))}
              {!locked && <button className="btn-ghost" style={{ padding: "6px 8px", color: "var(--clay)", borderColor: "var(--clay)" }} onClick={() => toggleDq(cls, e)}>DQ</button>}
              {locked && <span style={{ fontSize: 12, color: "var(--quiet)", fontWeight: 700 }}>not placed</span>}
            </div>
          )))}
          {dqs.map((e) => row(e, (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: "var(--clay)" }}>DQ</span>
              {!locked && <button className="btn-ghost" onClick={() => toggleDq(cls, e)}>Undo</button>}
            </div>
          )))}
          {scratched.length > 0 && (
            <div style={{ padding: "8px 12px 10px", borderTop: "1px solid var(--line)", fontSize: 12.5, color: "var(--quiet)" }}>
              Scratched: {scratched.map((e) => `#${fmtBack(e.back_number)} ${e.horse}`).join(", ")}
            </div>
          )}

          <div style={{ padding: "10px 12px 14px", borderTop: "2px solid var(--line)" }}>
            {!locked && (
              <textarea className="field" rows={2} style={{ width: "100%", fontSize: 14, marginBottom: 10 }} placeholder="Notes for this class (optional — tie-breakers, remarks)"
                value={card.notes ?? ""} onChange={(ev) => updateCard(cls, (c) => ({ ...c, notes: ev.target.value }))} />
            )}
            {locked && card.notes && <p style={{ fontSize: 13.5, fontStyle: "italic", margin: "0 0 10px" }}>{card.notes}</p>}
            {!locked ? (
              <>
                {scribeMissing && <p style={{ color: "var(--clay)", fontSize: 13, fontWeight: 700, margin: "0 0 8px" }}>Type the scribe&apos;s name at the top before finishing the class.</p>}
                <button className="btn" style={{ width: "100%", fontSize: 17, padding: 14 }} disabled={order.length === 0 || scribeMissing} onClick={() => setConfirmFinish(true)}>
                  ✓ Finish class
                </button>
                <p style={{ fontSize: 12, color: "var(--quiet)", margin: "8px 0 0" }}>Finishing locks this card and closes the class{cls.judge2 ? " once both judges have finished" : ""}. {online ? "" : "No signal — it will send itself later."}</p>
              </>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Finished {fmtTime(card.signed_at)}{card.entered_by ? ` · entered by ${card.entered_by}` : ""}</span>
                {(cls.status !== "completed" || card.unlocked) && <button className="btn-ghost" onClick={() => reopenCard(cls)}>Reopen to correct</button>}
              </div>
            )}
          </div>
        </section>

        {canSeeOther && (
          <section className="card">
            <div className="card-head"><div className="display" style={{ fontWeight: 700 }}>{otherName}&apos;s card</div><span style={{ fontSize: 12, color: "var(--quiet)" }}>finished {fmtTime(otherCard.signed_at)}</span></div>
            {[...(otherCard.results ?? [])].filter((r) => !r.dq && (r.place != null || r.score != null)).sort((a, b) => (a.place ?? 99) - (b.place ?? 99) || (b.score ?? 0) - (a.score ?? 0)).map((r, i) => {
              const e = cls.entries.find((x) => x.id === r.entry_id);
              return (
                <div key={r.entry_id} style={{ display: "flex", gap: 10, padding: "8px 12px", borderTop: "1px solid var(--line)", fontSize: 14 }}>
                  <b style={{ color: "var(--clay)", minWidth: 36 }}>{ordinal(r.place ?? i + 1)}</b>
                  <span>#{fmtBack(e?.back_number ?? r.back_number)} {e?.horse ?? ""}</span>
                  {r.score != null && <span style={{ marginLeft: "auto", color: "var(--quiet)" }}>{r.score}</span>}
                </div>
              );
            })}
          </section>
        )}
        {otherCard && !canSeeOther && <p style={{ fontSize: 12.5, color: "var(--quiet)" }}>{otherName}&apos;s card will show here after you finish the class.</p>}

        {confirmFinish && (
          <div className="modal-overlay" onClick={() => setConfirmFinish(false)}>
            <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
              <h2 className="display modal-title">Finish Class {cls.num}?</h2>
              <ol style={{ paddingLeft: 22, margin: "0 0 12px", fontSize: 15 }}>
                {order.map((e) => <li key={e.id}><b>#{fmtBack(e.back_number)}</b> {e.horse}{isScores ? ` — ${scoreTxt(card.results[e.id].score)}` : ""}</li>)}
              </ol>
              {dqs.length > 0 && <p style={{ fontSize: 13.5, color: "var(--clay)", fontWeight: 700 }}>DQ: {dqs.map((e) => `#${fmtBack(e.back_number)}`).join(", ")}</p>}
              {unplaced.length > 0 && <p style={{ fontSize: 13.5, color: "var(--quiet)" }}>{unplaced.length} not placed.</p>}
              <p style={{ fontSize: 13, color: "var(--quiet)" }}>Like a paper card, there are no changes once it&apos;s in — the secretary can unlock it for a clerical correction.</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost" style={{ flex: 1, padding: 12, fontSize: 15 }} onClick={() => setConfirmFinish(false)}>Back</button>
                <button className="btn" style={{ flex: 2 }} onClick={() => finishClass(cls)}>✓ Finish and send</button>
              </div>
            </div>
          </div>
        )}
        {showPattern && cls.pattern_url && (
          <div className="modal-overlay" onClick={() => setShowPattern(false)}>
            <div className="modal-sheet" style={{ maxWidth: 760, height: "90vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <b>Pattern — Class {cls.num}</b>
                <button className="btn-ghost" onClick={() => setShowPattern(false)}>Close</button>
              </div>
              {/\.(png|jpe?g|gif|webp)(\?|$)/i.test(cls.pattern_url)
                ? <img src={cls.pattern_url} alt="Pattern" style={{ maxWidth: "100%", objectFit: "contain" }} />
                : <iframe src={cls.pattern_url} title="Pattern" style={{ flex: 1, border: 0, width: "100%" }} />}
            </div>
          </div>
        )}
      </main>
    );
  }

  // ---- class list ----
  const completed = classes.filter((c) => cards[c.id]?.status === "sent" || cards[c.id]?.status === "signed" || c.status === "completed");
  const todo = classes.filter((c) => !completed.includes(c));
  const firstOf = (cls) => placedOrder(cls, cards[cls.id])[0];

  return (
    <main className="wrap" style={{ maxWidth: 640 }}>
      {header}
      {error && <p style={{ color: "var(--clay)", fontWeight: 700, fontSize: 13.5 }}>{error}</p>}
      {notice && <p style={{ background: "#FBF4E4", padding: "8px 12px", borderRadius: 10, fontSize: 13.5, fontWeight: 600 }} onClick={() => setNotice("")}>{notice}</p>}
      {scribeBox}

      {completed.length > 0 && (
        <>
          <div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 800, color: "var(--quiet)", margin: "4px 0 6px" }}>Today so far · tap to look back</div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, marginBottom: 12, WebkitOverflowScrolling: "touch" }}>
            {completed.map((c) => {
              const s = statusOf(c);
              const first = firstOf(c);
              return (
                <button key={c.id} onClick={() => setView({ kind: "card", classId: c.id })}
                  style={{ flex: "0 0 150px", textAlign: "left", background: "#fff", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", fontFamily: "inherit" }}>
                  <div style={{ fontSize: 11, color: "var(--quiet)", fontWeight: 700 }}>Class {c.num}</div>
                  <div className="display" style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                  <div style={{ fontSize: 12.5, marginTop: 4 }}>{first ? <>1st <b>#{fmtBack(first.back_number)}</b></> : <span style={{ color: "var(--quiet)" }}>no card</span>}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: toneColor[s.tone], marginTop: 2 }}>{s.label}</div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {classes.length === 0 && (
        <section className="card" style={{ padding: 16 }}>
          <p style={{ margin: 0, fontSize: 14 }}>No classes list <b>{judgeName}</b> as a judge yet. The secretary adds judges on each class from the dashboard; this page updates on its own.</p>
        </section>
      )}

      {todo.map((c) => {
        const card = cards[c.id];
        const placedN = card ? placedOrder(c, card).length : 0;
        const isLive = c.status === "live";
        return (
          <button key={c.id} onClick={() => setView({ kind: "card", classId: c.id })} className="card"
            style={{ width: "100%", textAlign: "left", padding: "12px 14px", fontFamily: "inherit", cursor: "pointer", borderColor: isLive ? "var(--brass)" : undefined, background: isLive ? "#FBF4E4" : "#fff", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div className="display" style={{ fontWeight: 700, fontSize: 17 }}>Class {c.num} · {c.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 2 }}>
                  {c.entries.filter((e) => !e.scratched).length} in class · {cardTypeFor(c) === "scores" ? "scores" : "placings"}{c.judge2 ? ` · Judge ${c.judge_slot}` : ""}
                  {placedN > 0 && <> · <b style={{ color: "var(--brass)" }}>{placedN} placed</b></>}
                </div>
                <div style={{ marginTop: 3 }}><ClassStatusLine cls={c} /></div>
              </div>
              <span className={`badge ${c.status}`}>{isLive ? "In the ring" : c.status}</span>
            </div>
          </button>
        );
      })}
      <p style={{ fontSize: 12, color: "var(--quiet)", marginTop: 16 }}>
        Everything you tap is saved on this device straight away. Finished cards send themselves when there is a signal — leave this page open or come back to it to check that they have gone.
      </p>
    </main>
  );
}
