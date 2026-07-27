"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import { categoryKey, programDisplayRows } from "../../lib/classCategories";
import { isChampionship, looksLikeChampionship, looksLikeSupreme, championshipQualifiers, suggestFeederIds } from "../../lib/championship";
import ImportEntries from "./ImportEntries";
import ImportClasses from "./ImportClasses";

const firstPending = (entries, mode) =>
  mode === "tbc"
    ? entries.find((e) => !e.called && !e.scratched) ?? null
    : entries.find((e) => e.score == null && !e.scratched) ?? null;

// All valid high-points categories in display order.
const HP_CATEGORIES = [
  "Overall Halter", "Overall 2YO", "Overall 3YO", "Junior Horse", "Senior Horse",
  "Amateur", "Novice Amateur", "Select", "Beginner", "EWD", "Youth", "Leadline",
];
const HP_HORSE_CATS = new Set(["Overall Halter", "Overall 2YO", "Overall 3YO", "Junior Horse", "Senior Horse"]);

// Feeder-class picker shown in the class form when the name looks like a
// championship ("Champ & Reserve…", "GRAND CHAMPION") or feeders are already
// saved. The app pre-ticks its best guess for the section; staff confirm.
function ChampionshipFields({ form, setForm, classes, currentClassId }) {
  const isChampName = looksLikeChampionship(form.name);
  const selected = Array.isArray(form.champ_feeder_ids) ? form.champ_feeder_ids : [];
  const day = parseInt(form.day ?? "1", 10) || 1;

  // Pre-tick the suggestion the first time the section appears — never after
  // staff have touched the list (undefined = untouched).
  const applySuggestion = () => {
    const current = currentClassId ? classes.find((c) => c.id === currentClassId) : null;
    const champLike = { id: currentClassId, name: form.name, day, sort_order: current?.sort_order ?? Infinity };
    setForm((f) => ({
      ...f,
      champ_feeder_ids: suggestFeederIds(champLike, classes),
      // Supreme takes the WINNERS of the grand championships by default.
      champ_take: looksLikeSupreme(form.name) ? "top1" : (f.champ_take ?? "top2"),
    }));
  };

  // Auto pre-tick only when the field has never been touched (undefined —
  // i.e. a brand-new class). Editing an existing class starts from what's
  // saved ([] when none), so a deliberately-cleared championship never
  // resurrects on a later unrelated edit.
  useEffect(() => {
    if (isChampName && form.champ_feeder_ids === undefined) applySuggestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChampName]);

  const candidates = classes
    .filter((c) => c.id !== currentClassId && (c.day ?? 1) === day)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  // Changing the day must never leave invisible selections from the old day —
  // prune anything that's no longer in the candidate list.
  useEffect(() => {
    if (!Array.isArray(form.champ_feeder_ids)) return;
    const valid = new Set(candidates.map((c) => c.id));
    const pruned = form.champ_feeder_ids.filter((id) => valid.has(id));
    if (pruned.length !== form.champ_feeder_ids.length) {
      setForm((f) => ({ ...f, champ_feeder_ids: pruned }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  if (!isChampName && selected.length === 0) return null;
  const toggle = (id) => setForm((f) => {
    const cur = new Set(Array.isArray(f.champ_feeder_ids) ? f.champ_feeder_ids : []);
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    return { ...f, champ_feeder_ids: [...cur] };
  });

  return (
    <div style={{ border: "1px solid var(--brass)", borderRadius: 10, padding: "10px 12px", marginTop: 12, background: "#FDFBF5" }}>
      <div style={{ fontWeight: 800, fontSize: 13, color: "var(--leather)" }}>🏆 Championship class</div>
      <p style={{ fontSize: 12, color: "var(--quiet)", margin: "4px 0 8px" }}>
        No one enters this class directly — its draw fills automatically with the place-getters from
        the ticked classes once they&apos;re all completed. The suggested classes are pre-ticked; adjust
        as needed. Untick everything to treat this as a normal class.
      </p>
      <label className="modal-label">Who qualifies from each class</label>
      <select className="field" style={{ width: "100%", fontSize: 15 }} value={form.champ_take ?? "top2"}
        onChange={(e) => setForm((f) => ({ ...f, champ_take: e.target.value }))}>
        <option value="top2">1st &amp; 2nd place-getters from each class</option>
        <option value="top1">Winners (1st) only</option>
      </select>
      <button type="button" className="btn-ghost" style={{ fontSize: 12.5, marginTop: 8 }} onClick={applySuggestion}>
        ✨ Use suggested classes for this section
      </button>
      <div style={{ maxHeight: 180, overflowY: "auto", marginTop: 8, border: "1px solid var(--line)", borderRadius: 8, background: "#fff", padding: "6px 10px" }}>
        {candidates.length === 0 && <p style={{ fontSize: 12.5, color: "var(--quiet)", margin: "4px 0" }}>No other classes on this day yet.</p>}
        {candidates.map((c) => (
          <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0", cursor: "pointer", fontSize: 13.5 }}>
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
            <span>{c.num}. {c.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

const PROGRAM_CATEGORIES = [
  "Quarter Horse Halter", "Paint Halter", "Paint Bred Halter", "Appaloosa Halter",
  "Other Breeds Halter", "Showmanship", "Lungeline", "Hunter in Hand", "Hack",
  "Hunter Under Saddle", "Hunt Seat Equitation", "Set Up Trail", "Trail",
  "Western Pleasure",
  "Horsemanship", "Ranch Riding", "Reining", "Finish",
];

const PROGRAM_BREAKS = ["SET UP TRAIL", "BREAK FOR GEAR CHANGE", "BREAK AND OPEN PEN", "FINISH"];

const SCORING_MODE_LABELS = {
  score: "Score",
  placing: "Placing",
  class_only: "Class Only",
  tbc: "TBC (draw)",
  tbc_class: "TBC (whole class)",
};

function ProgramCategoryDatalist() {
  return (
    <>
      <datalist id="program-categories">
        {PROGRAM_CATEGORIES.map((cat) => <option key={cat} value={cat} />)}
      </datalist>
      <datalist id="program-breaks">
        {PROGRAM_BREAKS.map((label) => <option key={label} value={label} />)}
      </datalist>
    </>
  );
}

// Points scale: 1st=3, 2nd=2, 3rd=1 with 3+ entries; 1st=2, 2nd=1 with 2 entries; 1st=1 with 1 entry.
function calcPoints(placing, competingEntries) {
  if (competingEntries < 1) return 0;
  return Math.max(0, Math.min(competingEntries, 3) - placing + 1);
}

const fmtBack = (n) => String(n).padStart(3, "0");
const ordinal = (n) => { const s = ["th","st","nd","rd"]; const v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); };
const cleanFilename = (value, fallback = "classes") =>
  (String(value ?? fallback).replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || fallback);
const isPdfFile = (value) => {
  const text = String(value ?? "").toLowerCase();
  return text.endsWith(".pdf") || text.includes(".pdf?");
};

// Snapshot of a live class for the iPhone Live Activity (Lock Screen card).
// Keys must match the app's ScoringAttributes.ContentState exactly.
function liveActivityState(cls) {
  const mode = cls.scoring_mode ?? "score";
  const active = (cls.entries ?? []).filter((e) => !e.scratched).sort((a, b) => a.draw_order - b.draw_order);
  const cur = mode === "tbc" ? active.find((e) => !e.called) : active.find((e) => e.score == null);
  const pos = cur ? active.findIndex((e) => e.id === cur.id) + 1 : active.length;
  const lastScored = [...active].reverse().find((e) => e.score != null);
  return {
    className: cls.name,
    classNumber: cls.num,
    backNumber: cur?.back_number != null ? fmtBack(cur.back_number) : "",
    horse: cur?.horse ?? "Class complete",
    exhibitor: cur?.exhibitor ?? "",
    drawPosition: pos,
    drawTotal: active.length,
    latestScore: lastScored?.score != null ? String(lastScored.score) : "",
    status: cls.status ?? "live",
  };
}

async function triggerPush(title, body, tag) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return { ok: false, error: "Staff sign-in required." };

    const res = await fetch("/api/push/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, body, tag }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? "Push notification failed." };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err?.message ?? "Could not contact the push notification service." };
  }
}

// Push a live update to any iPhones showing this event's Lock Screen activity.
// Fire-and-forget, like triggerPush — never blocks or breaks scoring.
async function triggerLiveActivity(eventId, contentState, { event = "update" } = {}) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;
    await fetch("/api/live-activity/push", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: eventId, content_state: contentState, event }),
    });
  } catch {
    /* ignore — Lock Screen updates are best-effort */
  }
}

function eventStatusPush(event, status) {
  if (!event) return null;
  const name = event.name ?? "This event";
  const isClinic = event.event_type === "clinic";
  const tag = `event-${String(event.id ?? "status").slice(0, 8)}-${status}`;

  if (status === "open") {
    return {
      title: `${name}: registrations are open`,
      body: isClinic ? "Clinic registrations are open now." : "Entries are open now.",
      tag,
    };
  }
  if (status === "closed") {
    return {
      title: `${name}: registrations closed`,
      body: isClinic ? "Clinic registrations have closed." : "Entries have closed and the draw is being finalised.",
      tag,
    };
  }
  if (status === "live") {
    return {
      title: `${name} is running`,
      body: isClinic ? "The clinic is running now." : "Live scoring is running now.",
      tag,
    };
  }
  if (status === "completed") {
    return {
      title: `${name} has ended`,
      body: isClinic ? "The clinic has ended." : "The event has ended. Final results are available.",
      tag,
    };
  }
  return null;
}

export default function Coordinator() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState(null);
  const [classes, setClasses] = useState([]);
  const [selectedClassIds, setSelectedClassIds] = useState(new Set());
  const [classMenu, setClassMenu] = useState(null); // class id whose "⋯" menu is open

  const [scoreInput, setScoreInput] = useState("");
  const [scoreInput2, setScoreInput2] = useState("");
  const [busy, setBusy] = useState(false);

  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [formError, setFormError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportingClasses, setExportingClasses] = useState(false);
  const [pushingAllHp, setPushingAllHp] = useState(false);
  const [horseSuggestion, setHorseSuggestion] = useState(null);
  const [patternFiles, setPatternFiles] = useState([]);
  const [loadingPatternFiles, setLoadingPatternFiles] = useState(false);
  const [uploadingPatternFiles, setUploadingPatternFiles] = useState(false);

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

  // Run a Supabase write and shout if it fails. postgrest-js returns network
  // and database errors as { error } rather than throwing, so an unchecked
  // write silently "succeeds" on a dropped connection — at an arena on flaky
  // Wi-Fi that means a lost score displayed as saved. Every write on the live
  // scoring path goes through this so the coordinator is never misled.
  const saveOrWarn = useCallback(async (promise, whatFailed) => {
    let error;
    try {
      ({ error } = await promise);
    } catch (e) {
      error = e;
    }
    if (error) {
      window.alert(`${whatFailed}\n\nIt was NOT saved — check your internet connection and try again.\n\n(${error.message ?? "connection error"})`);
      return false;
    }
    return true;
  }, []);

  useEffect(() => { if (session) loadEvents(); }, [session, loadEvents]);
  useEffect(() => { setSelectedClassIds(new Set()); }, [eventId]);
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
  const current = liveClass ? firstPending(liveClass.entries, liveClass.scoring_mode) : null;
  const currentEvent = events.find((e) => e.id === eventId);
  const isClinic = currentEvent?.event_type === "clinic";
  const uploadedPdfFiles = patternFiles.filter((file) => isPdfFile(file.name) || isPdfFile(file.url));

  const loadPatternFiles = useCallback(async () => {
    if (!eventId) return;
    setLoadingPatternFiles(true);
    try {
      const { data, error } = await supabase.storage
        .from("patterns")
        .list(eventId, { limit: 300, sortBy: { column: "name", order: "asc" } });
      if (error) {
        setPatternFiles([]);
        return;
      }
      setPatternFiles((data ?? [])
        .filter((item) => item.name && !item.name.endsWith("/"))
        .map((item) => {
          const path = `${eventId}/${item.name}`;
          const { data: urlData } = supabase.storage.from("patterns").getPublicUrl(path);
          return { name: item.name, url: urlData.publicUrl };
        }));
    } finally {
      setLoadingPatternFiles(false);
    }
  }, [eventId]);

  // Clear score inputs whenever the live class changes (auto-advance after last entry)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setScoreInput(""); setScoreInput2(""); }, [liveClass?.id]);

  // Keep iPhone Lock Screen activities in sync. Because the dashboard re-fetches
  // on every realtime change, this fires whenever the "now showing" horse, draw,
  // or score changes — covering scoring, scratches, reorders and class changes.
  const liveStateKey = (liveClass && currentEvent?.status === "live") ? JSON.stringify(liveActivityState(liveClass)) : null;
  useEffect(() => {
    if (!eventId || !liveStateKey) return;
    triggerLiveActivity(eventId, JSON.parse(liveStateKey));
  }, [eventId, liveStateKey]);

  // End the Lock Screen activity when the event finishes.
  useEffect(() => {
    if (eventId && currentEvent?.status === "completed") {
      triggerLiveActivity(eventId, {
        className: "Show complete", classNumber: 0, backNumber: "", horse: "Results are final",
        exhibitor: "", drawPosition: 0, drawTotal: 0, latestScore: "", status: "completed",
      }, { event: "end" });
    }
  }, [eventId, currentEvent?.status]);

  // ---- scoring actions ----
  const saveScore = async () => {
    const val = parseFloat(scoreInput);
    if (isNaN(val) || !current || busy) return;
    const updateData = { score: val };
    if (liveClass?.judge2) {
      const val2 = parseFloat(scoreInput2);
      if (isNaN(val2)) return;
      updateData.score2 = val2;
    }
    setBusy(true);
    try {
      // Guard on score == null so two devices scoring the same horse can't
      // silently overwrite each other — the second save updates zero rows.
      let updated, error;
      try {
        ({ data: updated, error } = await supabase
          .from("entries").update(updateData).eq("id", current.id).is("score", null).select("id"));
      } catch (e) {
        error = e;
      }
      if (error) {
        window.alert(`That score could not be saved.\n\nIt was NOT saved — check your internet connection and try again.\n\n(${error.message ?? "connection error"})`);
        return; // keep the inputs populated; do not advance, complete, or notify
      }
      if (!updated?.length) {
        window.alert("This horse was just scored on another device — refreshing the draw.");
        await loadClasses();
        setScoreInput("");
        setScoreInput2("");
        return;
      }
      const remaining = liveClass.entries.filter((e) => e.id !== current.id && e.score == null && !e.scratched);
      if (remaining.length === 0) {
        await completeClass(liveClass);
      } else {
        const next = remaining[0];
        triggerPush(`Now showing: #${fmtBack(next.back_number)} ${next.horse}`, `Class ${liveClass.num} · ${liveClass.name}`, "now-showing");
      }
      setScoreInput("");
      setScoreInput2("");
      await loadClasses();
    } finally {
      setBusy(false);
    }
  };

  const callNext = async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const ok = await saveOrWarn(
        supabase.from("entries").update({ called: true }).eq("id", current.id),
        "That horse could not be marked as shown."
      );
      if (!ok) return; // do not advance, complete, or notify on a failed write
      const remaining = liveClass.entries.filter((e) => e.id !== current.id && !e.called && !e.scratched);
      if (remaining.length === 0) {
        await completeClass(liveClass);
      } else {
        triggerPush(`Now showing: #${fmtBack(remaining[0].back_number)} ${remaining[0].horse}`, `Class ${liveClass.num} · ${liveClass.name}`, "now-showing");
      }
      await loadClasses();
    } finally {
      setBusy(false);
    }
  };

  const toggleScratch = async (entry) => {
    const scratching = !entry.scratched;
    const ok = await saveOrWarn(
      supabase.from("entries").update({ scratched: scratching }).eq("id", entry.id),
      scratching ? "That scratch could not be saved." : "Restoring that entry could not be saved."
    );
    if (!ok) return; // do not notify or complete the class on a failed write
    if (scratching) {
      triggerPush(`Scratch: #${entry.back_number} ${entry.horse}`, "This entry has been scratched.", "scratch");
      if (liveClass) {
        const liveMode = liveClass.scoring_mode ?? "score";
        const remaining = liveMode === "tbc"
          ? liveClass.entries.filter((e) => e.id !== entry.id && !e.called && !e.scratched)
          : liveClass.entries.filter((e) => e.id !== entry.id && e.score == null && !e.scratched);
        if (remaining.length === 0) await completeClass(liveClass);
      }
    }
    await loadClasses();
  };

  const movePending = async (cls, entry, dir) => {
    const clsMode = cls.scoring_mode ?? "score";
    const pending = clsMode === "tbc"
      ? cls.entries.filter((e) => !e.called && !e.scratched)
      : cls.entries.filter((e) => e.score == null && !e.scratched);
    const pos = pending.findIndex((e) => e.id === entry.id);
    const other = pending[pos + dir];
    if (!other) return;
    // Two separate updates: if one fails, the two draw orders collide, so
    // check both and refetch the true order on any failure.
    let error;
    try {
      const [a, b] = await Promise.all([
        supabase.from("entries").update({ draw_order: other.draw_order }).eq("id", entry.id),
        supabase.from("entries").update({ draw_order: entry.draw_order }).eq("id", other.id),
      ]);
      error = a.error || b.error;
    } catch (e) {
      error = e;
    }
    if (error) {
      window.alert(`The draw order could not be changed.\n\nPlease check your internet connection and try again.\n\n(${error.message ?? "connection error"})`);
    }
    await loadClasses();
  };

  const startClass = async (cls) => {
    if (busy) return;
    // A class can only be live while the event is live.
    if (currentEvent?.status !== "live") {
      window.alert("Set the event to Live (“Go live”) before starting a class.");
      return;
    }
    // Starting a class while another is still live will complete that one —
    // warn if it has entries that haven't been scored yet.
    if (liveClass && liveClass.id !== cls.id) {
      const mode = liveClass.scoring_mode ?? "score";
      const unscored = liveClass.entries.filter((e) => !e.scratched && (mode === "tbc" ? !e.called : e.score == null)).length;
      const msg = unscored > 0
        ? `Class ${liveClass.num} (${liveClass.name}) is still live with ${unscored} ${unscored === 1 ? "entry" : "entries"} not yet ${mode === "tbc" ? "shown" : "scored"}.\n\nStarting "${cls.name}" will mark that class complete. Continue?`
        : `Class ${liveClass.num} is still live and will be marked complete. Continue?`;
      if (!window.confirm(msg)) return;
    }
    setBusy(true);
    try {
      if (liveClass && liveClass.id !== cls.id) {
        const ok = await saveOrWarn(
          supabase.from("classes").update({ status: "completed" }).eq("id", liveClass.id),
          `Completing Class ${liveClass.num} could not be saved.`
        );
        if (!ok) return;
        await pushToHighPoints(liveClass);
        await fillChampionshipsFedBy(liveClass.id);
      }
      const ok = await saveOrWarn(
        supabase.from("classes").update({ status: "live" }).eq("id", cls.id),
        `Starting Class ${cls.num} could not be saved.`
      );
      if (!ok) return;
      const next = firstPending(cls.entries, cls.scoring_mode);
      if (next) triggerPush(`Now showing: #${fmtBack(next.back_number)} ${next.horse}`, `Class ${cls.num} · ${cls.name}`, "now-showing");
      await loadClasses();
    } finally {
      setBusy(false);
    }
  };

  const completeClass = async (cls) => {
    const ok = await saveOrWarn(
      supabase.from("classes").update({ status: "completed" }).eq("id", cls.id),
      `Completing Class ${cls.num} could not be saved.`
    );
    if (!ok) return; // don't push high points, notify, or advance on a failed write
    const isPlacingMode = cls.scoring_mode === "placing" || cls.scoring_mode === "class_only" || cls.scoring_mode === "tbc_class";
    const placed = [...cls.entries].filter((e) => e.score != null && !e.scratched)
      .sort((a, b) => isPlacingMode ? a.score - b.score : b.score - a.score);
    if (placed.length > 0) {
      triggerPush(
        `Class ${cls.num} complete — ${cls.name}`,
        `1st: #${fmtBack(placed[0].back_number)} ${placed[0].horse}${placed[0].score != null ? ` (${placed[0].score})` : ""}`,
        "results"
      );
    }
    await pushToHighPoints(cls);
    await fillChampionshipsFedBy(cls.id);
    // Auto-advance only while the event is live, and to the next class AFTER
    // this one in running order (not the earliest upcoming, which could jump
    // backwards over classes you've deliberately skipped).
    if (currentEvent?.status === "live") {
      const nextUp = classes
        .filter((c) => c.status === "upcoming" && !c.hidden && c.id !== cls.id && (c.sort_order ?? 0) > (cls.sort_order ?? 0))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0];
      if (nextUp) {
        const ok = await saveOrWarn(
          supabase.from("classes").update({ status: "live" }).eq("id", nextUp.id),
          `Class ${cls.num} was completed, but starting the next class could not be saved.`
        );
        if (ok) {
          const nextEntry = firstPending(nextUp.entries, nextUp.scoring_mode);
          if (nextEntry) triggerPush(`Now showing: #${fmtBack(nextEntry.back_number)} ${nextEntry.horse}`, `Class ${nextUp.num} · ${nextUp.name}`, "now-showing");
        }
      }
    }
    await loadClasses();
  };

  // Wrapper for the manual "Complete" button so a double-tap can't fire twice
  // (the score-flow callers already hold `busy` while they call completeClass).
  const completeClassManual = async (cls) => {
    if (busy) return;
    setBusy(true);
    try { await completeClass(cls); } finally { setBusy(false); }
  };

  // ---- Championship auto-fill (schema-v43) ----
  // Builds a championship class's draw from its feeders' place-getters.
  // Only runs once every feeder is completed. Never touches scored or
  // scratched entries; replace=true (the Refresh button) also removes
  // unscored horses that no longer qualify after a result correction.
  const fillChampionshipDraw = async (champCls, allClasses, { replace = false } = {}) => {
    const byId = Object.fromEntries(allClasses.map((c) => [c.id, c]));
    const feeders = (champCls.champ_feeder_ids ?? []).map((id) => byId[id]).filter(Boolean);
    if (!feeders.length) return { done: false };
    if (!feeders.every((f) => f.status === "completed")) return { waiting: true };
    const qualifiers = championshipQualifiers(champCls, byId);
    const qualBacks = new Set(qualifiers.map((q) => q.back_number));
    let existing = champCls.entries ?? [];
    if (replace) {
      const removable = existing.filter((e) => e.score == null && e.score2 == null && !e.scratched && !qualBacks.has(e.back_number));
      if (removable.length) {
        const { error } = await supabase.from("entries").delete().in("id", removable.map((e) => e.id));
        if (error) { window.alert("Could not update the championship draw: " + error.message); return { done: false }; }
        const removedIds = new Set(removable.map((e) => e.id));
        existing = existing.filter((e) => !removedIds.has(e.id));
      }
    }
    const existingBacks = new Set(existing.map((e) => e.back_number));
    let maxDraw = Math.max(0, ...existing.map((e) => e.draw_order ?? 0));
    const toInsert = qualifiers
      .filter((q) => !existingBacks.has(q.back_number))
      .map((q) => ({ class_id: champCls.id, back_number: q.back_number, horse: q.horse, exhibitor: q.exhibitor, draw_order: ++maxDraw }));
    if (toInsert.length) {
      const { error } = await supabase.from("entries").insert(toInsert);
      if (error) { window.alert("Could not fill the championship draw: " + error.message); return { done: false }; }
    }
    return { done: true, added: toInsert.length };
  };

  // Runs whenever a class completes: fills any championship it feeds, using
  // freshly-loaded data (its scores were written moments ago).
  const fillChampionshipsFedBy = async (completedClassId) => {
    try {
      const { data: fresh } = await supabase
        .from("classes").select("*, entries(*)").eq("event_id", eventId).order("sort_order");
      const champs = (fresh ?? []).filter((c) =>
        Array.isArray(c.champ_feeder_ids) && c.champ_feeder_ids.includes(completedClassId) && c.status !== "completed");
      for (const champ of champs) {
        const res = await fillChampionshipDraw(champ, fresh ?? []);
        if (res.done && res.added > 0) {
          triggerPush(`${champ.name} — draw ready`, `${res.added} qualifier${res.added === 1 ? "" : "s"} added from the completed classes.`, "results");
        }
      }
    } catch (err) {
      console.error("Championship auto-fill failed:", err);
    }
  };

  // ---- judges' result sheet photos (schema-v45) ----
  // Photographed paper results, stored in the public "patterns" bucket under
  // results/… and listed on the class as { url, label } entries.
  // One paper sheet per judge — each judge has their own upload slot in the
  // modal, and the photo uploads as soon as it's chosen.
  const uploadResultSheet = async (cls, label, file) => {
    if (!cls || !file) return;
    setBusy(true);
    try {
      const path = `results/${eventId}/${cls.id}-${label.replace(/[^a-z0-9]/gi, "-")}-${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, "-")}`;
      const { error: upErr } = await supabase.storage.from("patterns").upload(path, file, { upsert: true });
      if (upErr) {
        const msg = upErr.message?.toLowerCase() ?? "";
        setFormError(msg.includes("not found") || msg.includes("bucket")
          ? 'Storage not configured. Create a "patterns" bucket in Supabase Storage (Dashboard → Storage → New bucket, name: patterns, Public: on).'
          : upErr.message);
        return;
      }
      const { data: urlData } = supabase.storage.from("patterns").getPublicUrl(path);
      const next = [...(Array.isArray(cls.result_sheets) ? cls.result_sheets : []), { url: urlData.publicUrl, label }];
      const { error } = await supabase.from("classes").update({ result_sheets: next }).eq("id", cls.id);
      if (error) {
        setFormError(/result_sheets/i.test(error.message ?? "")
          ? 'Result sheets need a database update — run "schema-v45-result-sheets.sql" in the Supabase SQL Editor first.'
          : error.message);
        return;
      }
      setFormError("");
      setForm((f) => ({ ...f, sheetFileKey: (f.sheetFileKey ?? 0) + 1 }));
      await loadClasses();
    } finally {
      setBusy(false);
    }
  };

  const removeResultSheet = async (cls, idx) => {
    const sheets = Array.isArray(cls.result_sheets) ? cls.result_sheets : [];
    const sheet = sheets[idx];
    if (!sheet) return;
    if (!window.confirm(`Remove this ${sheet.label} sheet photo from Class ${cls.num}?`)) return;
    const next = sheets.filter((_, i) => i !== idx);
    const { error } = await supabase.from("classes").update({ result_sheets: next.length ? next : null }).eq("id", cls.id);
    if (error) { window.alert(error.message); return; }
    await loadClasses();
  };

  const refreshChampionship = async (cls) => {
    const feederNums = (cls.champ_feeder_ids ?? [])
      .map((id) => classes.find((c) => c.id === id)?.num)
      .filter((n) => n != null);
    if (!window.confirm(`Rebuild the draw for Class ${cls.num} · ${cls.name} from its qualifying classes (${feederNums.join(", ") || "none"})?\n\nAdds missing qualifiers and removes unscored horses that no longer qualify. Scored or scratched entries are kept.`)) return;
    const res = await fillChampionshipDraw(cls, classes, { replace: true });
    if (res.waiting) window.alert("Not all qualifying classes are completed yet — the draw fills automatically the moment the last one finishes.");
    await loadClasses();
  };

  const pushToHighPoints = async (cls) => {
    if (!cls.hp_category || !currentEvent?.starts_on) return;

    const [y, mo] = currentEvent.starts_on.split("-").map(Number);
    const season = mo >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
    const showName = currentEvent.name;
    const category = cls.hp_category;
    const isHorseCat = HP_HORSE_CATS.has(category);

    // Recalculate from ALL completed classes in this category so that:
    // (a) multiple classes sharing a category accumulate correctly, and
    // (b) pushing twice after a scratch/score change always reflects current reality.
    // When called from completeClass, React state may still say the passed-in
    // class is "live" (the DB update hasn't round-tripped yet) — count it as
    // completed so the class that just finished isn't skipped.
    const categoryClasses = classes.filter(
      (c) => c.hp_category === category && !c.hidden && (c.status === "completed" || c.id === cls.id)
    );
    const pointsMap = {};

    for (const c of categoryClasses) {
      // Fetch fresh — when called from saveScore the last score isn't in React state yet.
      const { data: fresh } = await supabase.from("entries").select("*").eq("class_id", c.id);
      const active = (fresh ?? []).filter((e) => !e.scratched);
      const entries = active.filter((e) => e.score != null);
      // A class can hold judge-2-only results (paperwork typed in for judge 2
      // first, or the judges disagreed) — don't skip it just because judge 1
      // has nothing yet.
      if (!entries.length && !(c.judge2 && active.some((e) => e.score2 != null))) continue;

      const isPlacing = ["placing", "class_only", "tbc_class"].includes(c.scoring_mode);
      const applyJudge = (sorted, getScore) => {
        const n = sorted.length;
        sorted.forEach((e, i) => {
          const placing = isPlacing ? Math.round(getScore(e)) : i + 1;
          const pts = calcPoints(placing, n);
          if (!pts) return;
          const name = isHorseCat ? e.horse : e.exhibitor;
          pointsMap[name] = (pointsMap[name] ?? 0) + pts;
        });
      };

      applyJudge(
        [...entries].sort((a, b) => isPlacing ? a.score - b.score : b.score - a.score),
        (e) => e.score
      );
      if (c.judge2) {
        // From ALL active entries — judge 2 may have placed a horse judge 1 didn't.
        const j2 = active.filter((e) => e.score2 != null);
        applyJudge(
          [...j2].sort((a, b) => isPlacing ? a.score2 - b.score2 : b.score2 - a.score2),
          (e) => e.score2
        );
      }
    }

    // Scores pushed from a show go to the AQHA leaderboard — other breeds'
    // leaderboards (Paint, Appaloosa, ...) are maintained on the High Points
    // page and must not be touched here. On a database without the breed
    // column yet (schema-v24 not run), fall back to the no-breed behaviour.
    //
    // Order matters for safety: write the fresh points FIRST (upsert on the
    // unique key), THEN remove only the rows that dropped out. The old code
    // deleted first and could leave the category wiped if the insert then
    // failed on a dropped connection — this way the leaderboard never ends up
    // with the data nowhere, even if one request fails mid-push.
    const toInsert = Object.entries(pointsMap).map(([name, pts]) => ({
      season, category, breed: "AQHA",
      entity_type: isHorseCat ? "horse" : "rider",
      entity_name: name, show_name: showName, show_date: currentEvent.starts_on, points: pts,
    }));

    let upsertErr = null;
    if (toInsert.length) {
      let res = await supabase.from("high_points")
        .upsert(toInsert, { onConflict: "season,category,entity_name,show_name,breed" });
      if (res.error?.message?.includes("breed")) {
        res = await supabase.from("high_points")
          .upsert(toInsert.map(({ breed: _breed, ...row }) => row),
            { onConflict: "season,category,entity_name,show_name" });
      }
      upsertErr = res.error;
    }

    // Remove stale rows (entries that dropped out of the top placings since the
    // last push) by id — so nothing depends on quoting names — and only after
    // the fresh points are safely in.
    const keepNames = new Set(toInsert.map((r) => r.entity_name));
    let existing = await supabase.from("high_points")
      .select("id, entity_name")
      .eq("season", season).eq("category", category).eq("show_name", showName).eq("breed", "AQHA");
    if (existing.error?.message?.includes("breed")) {
      existing = await supabase.from("high_points")
        .select("id, entity_name")
        .eq("season", season).eq("category", category).eq("show_name", showName);
    }
    const staleIds = (existing.data ?? []).filter((r) => !keepNames.has(r.entity_name)).map((r) => r.id);
    let delErr = null;
    if (staleIds.length) {
      const res = await supabase.from("high_points").delete().in("id", staleIds);
      delErr = res.error;
    }

    const error = upsertErr || existing.error || delErr;
    if (error) console.error("High points push failed:", error);
    return { ok: !error, error };
  };

  // Share the gate marshal link (schema-v44): a per-event code that unlocks
  // gate controls only — advance the TBC draw and scratch/restore — with no
  // staff access at all. Generated once and reused; regenerating would cut
  // off anyone holding the old link.
  const gateAccess = async () => {
    if (!currentEvent) return;
    const migrationHint = 'Gate access needs a database update — run "schema-v44-gate-access.sql" in the Supabase SQL Editor first.';
    const { data: existing, error: readErr } = await supabase
      .from("gate_codes").select("code").eq("event_id", currentEvent.id).maybeSingle();
    if (readErr) {
      window.alert(/gate_codes|does not exist|schema cache/i.test(readErr.message ?? "") ? migrationHint : readErr.message);
      return;
    }
    let codeVal = existing?.code ?? null;
    if (!codeVal) {
      // Long random token (crypto-strength) — the link is the key, and it
      // can't be guessed the way a short PIN could.
      const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      codeVal = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
      const { error } = await supabase.from("gate_codes").insert({ event_id: currentEvent.id, code: codeVal });
      if (error) {
        window.alert(/gate_codes|does not exist|schema cache/i.test(error.message ?? "") ? migrationHint : error.message);
        return;
      }
    }
    const url = `${window.location.origin}/event/${currentEvent.id}/gate?code=${codeVal}`;
    window.prompt(
      "Send this link to the gate marshal. It opens the gate view for this event only — advance the draw and scratch at the gate. It is NOT a staff login.",
      url
    );
  };

  // One-tap default order: re-sequence every class (hidden ones included, so
  // they reactivate into the right spot) into day order then class-number
  // order. The ▲▼ buttons still override individual positions afterwards.
  const sortByClassNumber = async () => {
    const sorted = [...classes].sort((a, b) =>
      (a.day ?? 1) - (b.day ?? 1) || (a.num ?? 0) - (b.num ?? 0) || (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const updates = sorted
      .map((c, i) => ({ id: c.id, sort_order: i + 1, changed: (c.sort_order ?? 0) !== i + 1 }))
      .filter((u) => u.changed);
    if (!updates.length) { window.alert("The classes are already in class-number order."); return; }
    if (!window.confirm(`Put all ${sorted.length} classes into class-number order (day by day)?\n\nAny manual running-order changes are overridden — you can still move individual classes afterwards with the ▲▼ buttons.`)) return;
    setBusy(true);
    try {
      for (const u of updates) {
        const { error } = await supabase.from("classes").update({ sort_order: u.sort_order }).eq("id", u.id);
        if (error) { window.alert("Could not finish re-ordering: " + error.message); break; }
      }
      await loadClasses();
    } finally {
      setBusy(false);
    }
  };

  const moveClass = async (cls, dir) => {
    if (busy) return;
    const upcoming = classes.filter((c) => c.status === "upcoming" && !c.hidden);
    const pos = upcoming.findIndex((c) => c.id === cls.id);
    const other = upcoming[pos + dir];
    if (!other) return;
    // Check both writes — a half-completed swap on flaky arena Wi-Fi leaves
    // two classes tied on sort_order, which makes the arrows look dead.
    const [a, b] = await Promise.all([
      supabase.from("classes").update({ sort_order: other.sort_order }).eq("id", cls.id),
      supabase.from("classes").update({ sort_order: cls.sort_order }).eq("id", other.id),
    ]);
    if (a.error || b.error) {
      window.alert("That move could not be fully saved — check your connection. If the arrows stop responding for these classes, tap \"↕ Sort by number\" to repair the order.");
      await loadClasses();
    }
  };

  const setEventStatus = async (newStatus) => {
    const previousStatus = currentEvent?.status;
    const { error } = await supabase.from("events").update({ status: newStatus }).eq("id", eventId);
    if (error) {
      window.alert(error.message);
      return;
    }
    if (previousStatus !== newStatus) {
      const push = eventStatusPush(currentEvent, newStatus);
      if (push) {
        const result = await triggerPush(push.title, push.body, push.tag);
        if (!result.ok) window.alert(`Event status saved, but the notification did not send.\n\n${result.error}`);
      }
    }
    await loadEvents();
  };

  const testPush = async () => {
    const result = await triggerPush(
      "HCQHA test notification",
      currentEvent ? `${currentEvent.name}: push notifications are working.` : "Push notifications are working.",
      "test-push"
    );
    if (!result.ok) {
      window.alert(`Test notification failed.\n\n${result.error}`);
      return;
    }
    const sent = result.data?.sent ?? 0;
    if (sent === 0) {
      window.alert("Test ran, but there are no subscribed devices yet.\n\nOn iPhone: open the site from the Home Screen app, tap Get notified, and choose Allow.");
      return;
    }
    window.alert(`Test notification sent to ${sent} subscribed device${sent === 1 ? "" : "s"}.`);
  };

  const endEvent = async () => {
    if (!window.confirm("Mark this event as completed? This cannot be undone.")) return;
    // Don't leave a class stuck 'live' — complete it (and push its High Points)
    // before the event is marked completed.
    if (liveClass) {
      await supabase.from("classes").update({ status: "completed" }).eq("id", liveClass.id);
      await pushToHighPoints(liveClass);
      await fillChampionshipsFedBy(liveClass.id);
    }
    await setEventStatus("completed");
    await loadClasses();
  };

  const revertToClosed = async () => {
    if (!window.confirm("Revert to closed? The event goes back to the 'Entries closed' state, and any class currently being scored is set back to upcoming (scores are kept).")) return;
    // Clear the live class so the public view and Lock Screen don't keep
    // showing a class as live while the event is closed.
    if (liveClass) {
      await supabase.from("classes").update({ status: "upcoming" }).eq("id", liveClass.id);
    }
    await setEventStatus("closed");
    await loadClasses();
  };

  const cancelEvent = () => {
    openModal("cancelEvent");
  };

  const submitCancelEvent = async () => {
    const { error } = await supabase.from("events").update({ status: "cancelled", cancellation_reason: form.reason?.trim() || null }).eq("id", eventId);
    if (error) { setFormError(error.message); return; }
    await loadEvents();
    closeModal();
  };

  const deleteEvent = async () => {
    if (!currentEvent) return;
    const classCount = classes.length;
    const entryCount = classes.reduce((sum, c) => sum + c.entries.length, 0);
    const detail = classCount > 0
      ? `\n\nThis will also delete ${classCount} class${classCount === 1 ? "" : "es"} and ${entryCount} entr${entryCount === 1 ? "y" : "ies"}, plus any online registrations for it.`
      : "";
    if (!window.confirm(`Delete "${currentEvent.name}"?${detail}\n\nThis cannot be undone.`)) return;
    setBusy(true);
    try {
      const classIds = classes.map((c) => c.id);
      if (classIds.length) {
        await supabase.from("registration_entries").delete().in("class_id", classIds);
        await supabase.from("entries").delete().in("class_id", classIds);
      }
      await supabase.from("registrations").delete().eq("event_id", currentEvent.id);
      await supabase.from("classes").delete().eq("event_id", currentEvent.id);
      const { error } = await supabase.from("events").delete().eq("id", currentEvent.id);
      if (error) { window.alert(error.message); return; }
      setEventId(events.find((e) => e.id !== currentEvent.id)?.id ?? null);
      await loadEvents();
    } finally {
      setBusy(false);
    }
  };

  const closeEntries = () => {
    // Ask what to do with empty classes rather than always deleting them.
    openModal("closeEntries");
  };

  const submitCloseEntries = async () => {
    setBusy(true);
    try {
      const emptyClasses = classes.filter((c) => c.entries.length === 0);
      const action = emptyClasses.length > 0 ? (form.emptyAction ?? "hide") : "leave";
      if (action === "hide") {
        const { error } = await supabase.from("classes").update({ hidden: true }).in("id", emptyClasses.map((c) => c.id));
        if (error) {
          setFormError(/hidden/i.test(error.message ?? "") ? HIDE_MIGRATION_HINT : error.message);
          setBusy(false);
          return;
        }
      }
      const doDelete = action === "delete";
      if (doDelete) {
        await supabase.from("classes").delete().in("id", emptyClasses.map((c) => c.id));
      }
      if (doDelete && form.renumber) {
        // Re-sequence the remaining classes 1..N in running order (day, then
        // sort_order) so deleting empties doesn't leave gaps in the numbers.
        const emptyIds = new Set(emptyClasses.map((c) => c.id));
        const remaining = classes
          .filter((c) => !emptyIds.has(c.id))
          .sort((a, b) => (a.day ?? 1) - (b.day ?? 1) || (a.sort_order ?? 0) - (b.sort_order ?? 0));
        await Promise.all(
          remaining
            .map((c, i) => ({ id: c.id, num: i + 1, was: c.num }))
            .filter((u) => u.num !== u.was)
            .map((u) => supabase.from("classes").update({ num: u.num }).eq("id", u.id))
        );
      }
      await setEventStatus("closed");
      await loadClasses();
      closeModal();
    } finally {
      setBusy(false);
    }
  };

  const randomiseDraw = async () => {
    const pending = classes.flatMap((c) => {
      const m = c.scoring_mode ?? "score";
      return c.entries.filter((e) => !e.scratched && (m === "tbc" ? !e.called : e.score == null));
    });
    if (!pending.length) { window.alert("No pending entries to randomise."); return; }
    if (!window.confirm(
      `Randomise the draw order for all classes in this event?\n\n${pending.length} pending ${pending.length === 1 ? "entry" : "entries"} across ${classes.length} ${classes.length === 1 ? "class" : "classes"} will be shuffled into a random order.`
    )) return;
    setBusy(true);
    try {
      for (const cls of classes) {
        const m = cls.scoring_mode ?? "score";
        const pendingInClass = cls.entries.filter((e) => !e.scratched && (m === "tbc" ? !e.called : e.score == null));
        if (pendingInClass.length < 2) continue;
        const orders = pendingInClass.map((e) => e.draw_order);
        for (let i = orders.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [orders[i], orders[j]] = [orders[j], orders[i]];
        }
        await Promise.all(pendingInClass.map((e, i) =>
          supabase.from("entries").update({ draw_order: orders[i] }).eq("id", e.id)
        ));
      }
      await loadClasses();
    } finally {
      setBusy(false);
    }
  };

  const deleteClass = async (cls) => {
    const n = cls.entries.length;
    const msg = n > 0
      ? `Delete Class ${cls.num} · ${cls.name}?\n\nThis will also delete ${n} entr${n === 1 ? "y" : "ies"}. This cannot be undone.`
      : `Delete Class ${cls.num} · ${cls.name}? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    // Clean up registration_entries referencing this class (cascade handles it in DB too)
    await supabase.from("registration_entries").delete().eq("class_id", cls.id);
    if (n > 0) await supabase.from("entries").delete().in("id", cls.entries.map((e) => e.id));
    await supabase.from("classes").delete().eq("id", cls.id);
  };

  const HIDE_MIGRATION_HINT = 'Hiding classes needs a database update — run "schema-v38-hide-classes.sql" in the Supabase SQL Editor first (see supabase/MIGRATIONS.md).';

  const hideClass = async (cls) => {
    const n = cls.entries.length;
    const msg = n > 0
      ? `Hide Class ${cls.num} · ${cls.name}?\n\nIt's removed from the public schedule, program and results but kept (with its ${n} entr${n === 1 ? "y" : "ies"}) — reactivate it any time.`
      : `Hide Class ${cls.num} · ${cls.name}?\n\nIt's removed from the public schedule and program but kept, so you can reactivate it in one click if someone enters on the day.`;
    if (!window.confirm(msg)) return;
    const { error } = await supabase.from("classes").update({ hidden: true }).eq("id", cls.id);
    if (error) { window.alert(/hidden/i.test(error.message ?? "") ? HIDE_MIGRATION_HINT : error.message); return; }
    await loadClasses();
  };

  const unhideClass = async (cls) => {
    const { error } = await supabase.from("classes").update({ hidden: false }).eq("id", cls.id);
    if (error) { window.alert(/hidden/i.test(error.message ?? "") ? HIDE_MIGRATION_HINT : error.message); return; }
    await loadClasses();
  };

  const unhideAllClasses = async () => {
    const hidden = classes.filter((c) => c.hidden);
    if (hidden.length === 0) return;
    if (!window.confirm(`Reactivate all ${hidden.length} hidden ${isClinic ? "spot types" : "classes"}?\n\nThey'll go back on the public schedule, program and results.`)) return;
    const { error } = await supabase.from("classes").update({ hidden: false }).in("id", hidden.map((c) => c.id));
    if (error) { window.alert(/hidden/i.test(error.message ?? "") ? HIDE_MIGRATION_HINT : error.message); return; }
    await loadClasses();
  };

  const toggleClassSelect = (id) => {
    setSelectedClassIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const deleteSelectedClasses = async () => {
    const selected = classes.filter((c) => selectedClassIds.has(c.id));
    if (selected.length === 0) return;
    const totalEntries = selected.reduce((sum, c) => sum + c.entries.length, 0);
    const names = selected.map((c) => (isClinic ? c.name : `Class ${c.num} · ${c.name}`)).join("\n");
    const msg = totalEntries > 0
      ? `Delete ${selected.length} classes?\n\n${names}\n\nThis will also delete ${totalEntries} entr${totalEntries === 1 ? "y" : "ies"}. This cannot be undone.`
      : `Delete ${selected.length} classes?\n\n${names}\n\nThis cannot be undone.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const classIds = selected.map((c) => c.id);
      const entryIds = selected.flatMap((c) => c.entries.map((e) => e.id));
      await supabase.from("registration_entries").delete().in("class_id", classIds);
      if (entryIds.length > 0) await supabase.from("entries").delete().in("id", entryIds);
      await supabase.from("classes").delete().in("id", classIds);
      setSelectedClassIds(new Set());
    } finally {
      setBusy(false);
    }
  };

  const deleteEntry = async (entry) => {
    const msg = entry.score != null
      ? `Remove #${fmtBack(entry.back_number)} ${entry.horse}?\n\nThis entry has a score of ${entry.score} recorded. Deleting it is permanent.`
      : `Remove #${fmtBack(entry.back_number)} ${entry.horse} from the draw?`;
    if (!window.confirm(msg)) return;
    await supabase.from("entries").delete().eq("id", entry.id);
  };

  // ---- modal ----
  const openModal = (type, extra = {}) => {
    let initialForm = {};
    if (type === "pattern" && extra.classId) {
      const cls = classes.find((c) => c.id === extra.classId);
      const linkedClassIds = cls?.pattern_url
        ? classes.filter((c) => c.pattern_url === cls.pattern_url).map((c) => c.id)
        : [];
      initialForm = {
        pattern_url: cls?.pattern_url ?? "",
        applyClassIds: linkedClassIds.length ? linkedClassIds : [extra.classId],
      };
    }
    if (type === "bulkPatterns") {
      initialForm = {
        patterns_pdf_url: currentEvent?.patterns_pdf_url ?? "",
      };
    }
    if (type === "pattern" || type === "bulkPatterns") loadPatternFiles();
    if (type === "editEntry" && extra.entry) {
      const e = extra.entry;
      initialForm = {
        back: String(e.back_number), origBack: String(e.back_number),
        horse: e.horse, exhibitor: e.exhibitor,
        score: e.score != null ? String(e.score) : "",
        score2: e.score2 != null ? String(e.score2) : "",
      };
    }
    if (type === "dayEntry") {
      initialForm = { dayClassIds: [] };
    }
    if (type === "editClass" && extra.cls) {
      const c = extra.cls;
      // champ_feeder_ids: [] (not undefined) when nothing is saved, so a class
      // staff deliberately made normal is never silently re-suggested back into
      // a championship on a later edit — the "Use suggested" button is explicit.
      initialForm = { num: String(c.num), name: c.name, program_category: c.program_category ?? "", program_break_before: c.program_break_before ?? "", program_break_after: c.program_break_after ?? "", judge: c.judge ?? "", judge2: c.judge2 ?? "", day: String(c.day ?? 1), scoring_mode: c.scoring_mode ?? "score", capacity: c.capacity != null ? String(c.capacity) : "", hp_category: c.hp_category ?? "", champ_feeder_ids: Array.isArray(c.champ_feeder_ids) && c.champ_feeder_ids.length ? c.champ_feeder_ids : [], champ_take: c.champ_take ?? "top2" };
    }
    if (type === "editEvent" && extra.event) {
      const ev = extra.event;
      initialForm = {
        name: ev.name, location: ev.location ?? "",
        starts: ev.starts_on ?? "", ends: ev.ends_on ?? "",
        fee: ev.entry_fee_cents ? (ev.entry_fee_cents / 100).toFixed(2) : "",
        ground_fee: ev.ground_fee_cents ? (ev.ground_fee_cents / 100).toFixed(2) : "",
        admin_fee: ev.admin_fee_cents ? (ev.admin_fee_cents / 100).toFixed(2) : "",
      };
    }
    setModal({ type, ...extra });
    setForm(initialForm);
    setFormError("");
    setHorseSuggestion(null);
    // Show the registry match (name + club) straight away when editing an
    // existing show entry, without overwriting its stored details.
    if (type === "editEntry" && extra.entry && !isClinic && extra.entry.back_number != null) {
      lookupHorse(String(extra.entry.back_number));
    }
  };
  const closeModal = () => { setModal(null); setForm({}); setFormError(""); setHorseSuggestion(null); };
  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const setPatternApplyClassIds = (ids) => {
    const requiredId = modal?.classId;
    setForm((f) => ({
      ...f,
      applyClassIds: [...new Set([requiredId, ...ids].filter(Boolean))],
    }));
  };

  const togglePatternApplyClass = (classId) => {
    if (classId === modal?.classId) return;
    setForm((f) => {
      const selected = new Set([modal?.classId, ...(f.applyClassIds ?? [])].filter(Boolean));
      if (selected.has(classId)) selected.delete(classId); else selected.add(classId);
      return { ...f, applyClassIds: [...selected] };
    });
  };

  // Registry club registrations as "AQHA 12345, PHAA 678" for the suggestion line.
  const registryClubs = (h) => (h?.horse_registrations ?? [])
    .map((r) => `${r.club}${r.registration_number ? " " + r.registration_number : ""}`.trim())
    .filter(Boolean)
    .join(", ");

  // Look up a horse in the permanent registry by back number and surface its
  // name, owner and club registrations. force=true adopts the registry name and
  // owner outright (used when the back number is CHANGED on an existing entry, so
  // it re-points to the new horse); otherwise only empty fields are filled in so
  // a coordinator's manual edits are never clobbered.
  const lookupHorse = async (backNum, { force = false } = {}) => {
    if (!backNum) { setHorseSuggestion(null); return; }
    try {
      const { data } = await supabase
        .from("horses")
        .select("name, owner, horse_registrations(club, registration_number)")
        .eq("back_number", parseInt(backNum, 10))
        .maybeSingle();
      setHorseSuggestion(data ?? false);
      if (data) {
        setForm((f) => ({
          ...f,
          horse: force ? data.name : (f.horse || data.name),
          exhibitor: force ? (data.owner ?? f.exhibitor ?? "") : (f.exhibitor || (data.owner ?? "")),
        }));
      }
    } catch { setHorseSuggestion(null); }
  };

  // Parses the three money fields; the one-off fee columns arrive with
  // schema-v34, so on an older database we retry without them when no value
  // was typed (and surface the run-the-migration message if one was).
  const eventFeeColumns = () => ({
    entry_fee_cents: form.fee ? Math.round(parseFloat(form.fee) * 100) : 0,
    ground_fee_cents: form.ground_fee ? Math.round(parseFloat(form.ground_fee) * 100) : 0,
    admin_fee_cents: form.admin_fee ? Math.round(parseFloat(form.admin_fee) * 100) : 0,
  });
  const isMissingFeeColumns = (error) =>
    Boolean(error?.message?.includes("ground_fee_cents") || error?.message?.includes("admin_fee_cents"));
  const FEE_MIGRATION_HINT = 'Ground/admin fees need a database update — run "schema-v34-event-fees.sql" in the Supabase SQL Editor first (see supabase/MIGRATIONS.md).';

  const submitEvent = async () => {
    if (!form.name?.trim()) { setFormError("Event name is required"); return; }
    const fees = eventFeeColumns();
    const base = { name: form.name.trim(), location: form.location ?? "", starts_on: form.starts || null, ends_on: form.ends || form.starts || null, status: form.status ?? "pre_open", event_type: form.event_type ?? "show" };
    let { data, error } = await supabase.from("events").insert({ ...base, ...fees }).select().single();
    if (error && isMissingFeeColumns(error)) {
      if (fees.ground_fee_cents || fees.admin_fee_cents) { setFormError(FEE_MIGRATION_HINT); return; }
      ({ data, error } = await supabase.from("events")
        .insert({ ...base, entry_fee_cents: fees.entry_fee_cents }).select().single());
    }
    if (error) { setFormError(error.message); return; }
    await loadEvents();
    if (data) setEventId(data.id);
    closeModal();
  };

  const submitEditEvent = async () => {
    if (!modal?.event) return;
    if (!form.name?.trim()) { setFormError("Event name is required"); return; }
    const fees = eventFeeColumns();
    const base = { name: form.name.trim(), location: form.location ?? "", starts_on: form.starts || null, ends_on: form.ends || form.starts || null };
    let { error } = await supabase.from("events").update({ ...base, ...fees }).eq("id", modal.event.id);
    if (error && isMissingFeeColumns(error)) {
      if (fees.ground_fee_cents || fees.admin_fee_cents) { setFormError(FEE_MIGRATION_HINT); return; }
      ({ error } = await supabase.from("events")
        .update({ ...base, entry_fee_cents: fees.entry_fee_cents }).eq("id", modal.event.id));
    }
    if (error) { setFormError(error.message); return; }
    await loadEvents();
    closeModal();
  };

  const submitClass = async () => {
    if (!form.num || !form.name?.trim()) { setFormError("Class number and name are required"); return; }
    const maxOrder = Math.max(0, ...classes.map((c) => c.sort_order));
    const insertData = {
      event_id: eventId,
      num: parseInt(form.num, 10),
      name: form.name.trim(),
      judge: form.judge ?? "",
      judge2: form.judge2?.trim() || null,
      pattern_url: form.pattern_url?.trim() || null,
      sort_order: maxOrder + 1,
      day: parseInt(form.day ?? "1", 10) || 1,
      scoring_mode: form.scoring_mode ?? "score",
      capacity: form.capacity ? parseInt(form.capacity, 10) : null,
      hp_category: form.hp_category || null,
    };
    if (form.program_category?.trim()) insertData.program_category = form.program_category.trim();
    if (form.program_break_before?.trim()) insertData.program_break_before = form.program_break_before.trim();
    if (form.program_break_after?.trim()) insertData.program_break_after = form.program_break_after.trim();
    const feederIds = Array.isArray(form.champ_feeder_ids) ? form.champ_feeder_ids.filter(Boolean) : [];
    if (feederIds.length) {
      insertData.champ_feeder_ids = feederIds;
      insertData.champ_take = form.champ_take === "top1" ? "top1" : "top2";
    }
    // Slot the new class into class-number order instead of appending at the
    // end — a re-added Class 86 lands back between 85 and 87, not below 200.
    // (▲▼ and "Sort by number" can still override afterwards.)
    const ordered = [...classes].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const slotAfter = ordered.find((c) =>
      ((c.day ?? 1) > insertData.day) || ((c.day ?? 1) === insertData.day && (c.num ?? 0) > insertData.num));
    if (slotAfter) {
      insertData.sort_order = slotAfter.sort_order;
      const bump = ordered.filter((c) => (c.sort_order ?? 0) >= (slotAfter.sort_order ?? 0));
      await Promise.all(bump.map((c) =>
        supabase.from("classes").update({ sort_order: (c.sort_order ?? 0) + 1 }).eq("id", c.id)));
    }
    const { error } = await supabase.from("classes").insert(insertData);
    if (error) {
      const msg = error.message?.includes("champ_feeder_ids") || error.message?.includes("champ_take")
        ? 'Championship classes need a database update. Please run "schema-v43-championship-classes.sql" in your Supabase SQL Editor first.'
        : error.message?.includes("program_break_before") || error.message?.includes("program_break_after")
        ? 'Database migration needed. Please run "schema-v20-program-breaks.sql" in your Supabase SQL Editor first.'
        : error.message?.includes("program_category") ? 'Database migration needed. Please run "schema-v19-class-categories.sql" in your Supabase SQL Editor first.'
        : error.message?.includes("day") ? 'Database migration needed. Please run "schema-v2-horses.sql" in your Supabase SQL Editor first.' : error.message;
      setFormError(msg);
      return;
    }
    closeModal();
  };

  const submitEntry = async () => {
    const cls = classes.find((c) => c.id === modal.classId);
    if (!cls) return;
    if (isClinic) {
      if (!form.exhibitor?.trim()) { setFormError("Participant name is required"); return; }
    } else {
      if (!form.back || !form.horse?.trim() || !form.exhibitor?.trim()) {
        setFormError("Back number, horse, and exhibitor are required");
        return;
      }
    }
    const maxDraw = Math.max(0, ...cls.entries.map((e) => e.draw_order));
    const { error } = await supabase.from("entries").insert({
      class_id: cls.id,
      back_number: isClinic ? maxDraw + 1 : parseInt(form.back, 10),
      horse: form.horse?.trim() || "",
      exhibitor: form.exhibitor.trim(),
      draw_order: maxDraw + 1,
    });
    if (error) { setFormError(error.message); return; }
    await loadClasses();
    closeModal();
  };

  // Day entry: one horse into many classes at once — for taking entries at
  // the gate with payment on the Square terminal. Mirrors the online form's
  // conveniences: registry lookup by back number, and (insert-only, like
  // approveRegistration) a brand-new number straight into the registry.
  const submitDayEntry = async () => {
    const classIds = form.dayClassIds ?? [];
    if (!form.horse?.trim() || !form.exhibitor?.trim()) { setFormError("Horse and exhibitor are required"); return; }
    if (!form.newNumber && (!form.back || !(parseInt(form.back, 10) >= 1))) { setFormError("Enter the back number, or tick 'assign a new number'"); return; }
    if (!classIds.length) { setFormError("Tick at least one class"); return; }
    setBusy(true);
    try {
      let backNumber = parseInt(form.back, 10);
      if (form.newNumber) {
        const { data: top, error: topErr } = await supabase
          .from("horses").select("back_number").order("back_number", { ascending: false }).limit(1);
        if (topErr) { setFormError(topErr.message); return; }
        backNumber = (top?.[0]?.back_number ?? 0) + 1;
        // The unique index on horses.back_number arbitrates races — walk up on conflict.
        let registered = false;
        for (let i = 0; i < 5 && !registered; i++) {
          const { error: insErr } = await supabase
            .from("horses").insert({ back_number: backNumber, name: form.horse.trim(), owner: form.exhibitor.trim() });
          if (!insErr) registered = true;
          else if (/duplicate|unique/i.test(insErr.message ?? "")) backNumber += 1;
          else { setFormError(insErr.message); return; }
        }
        if (!registered) { setFormError("Couldn't reserve a new back number — try again."); return; }
      }
      const failures = [];
      let added = 0;
      for (const classId of classIds) {
        const cls = classes.find((c) => c.id === classId);
        if (!cls) continue;
        if (cls.entries.some((e) => e.back_number === backNumber && !e.scratched)) {
          failures.push(`Class ${cls.num}: #${fmtBack(backNumber)} is already entered`);
          continue;
        }
        const maxDraw = Math.max(0, ...cls.entries.map((e) => e.draw_order ?? 0));
        const { error } = await supabase.from("entries").insert({
          class_id: classId,
          back_number: backNumber,
          horse: form.horse.trim(),
          exhibitor: form.exhibitor.trim(),
          draw_order: maxDraw + 1,
        });
        if (error) failures.push(`Class ${cls.num}: ${error.message}`);
        else added += 1;
      }
      await loadClasses();
      if (failures.length) { setFormError(failures.join("\n")); return; }
      closeModal();
      const feeCents = (currentEvent?.entry_fee_cents ?? 0) * added;
      const extras = [
        (currentEvent?.ground_fee_cents || currentEvent?.admin_fee_cents) ? "ground/admin fees if this is their first entry today" : null,
        "a day membership if they're not a member",
      ].filter(Boolean).join(", plus ");
      window.alert(
        `#${fmtBack(backNumber)} ${form.horse.trim()} added to ${added} class${added === 1 ? "" : "es"}.` +
        (feeCents > 0 ? `\n\nCollect $${(feeCents / 100).toFixed(2)} in class fees on the terminal (plus ${extras}).` : "")
      );
    } finally {
      setBusy(false);
    }
  };

  const submitEditEntry = async () => {
    if (!form.exhibitor?.trim()) {
      setFormError(isClinic ? "Participant name is required" : "Back number, horse, and exhibitor are required");
      return;
    }
    if (!isClinic && (!form.back || !form.horse?.trim())) {
      setFormError("Back number, horse, and exhibitor are required");
      return;
    }
    const entryClass = classes.find((c) => c.entries.some((e) => e.id === modal.entry?.id));
    const updateData = {
      back_number: parseInt(form.back, 10),
      horse: form.horse?.trim() ?? "",
      exhibitor: form.exhibitor.trim(),
      score: form.score !== "" && form.score != null ? parseFloat(form.score) : null,
    };
    if (entryClass?.judge2) {
      updateData.score2 = form.score2 !== "" && form.score2 != null ? parseFloat(form.score2) : null;
    }
    const { error } = await supabase.from("entries").update(updateData).eq("id", modal.entry.id);
    if (error) { setFormError(error.message); return; }
    closeModal();
    // Paperwork-mode results (TBC classes) are typed in AFTER the class
    // completes — feed any championship this class qualifies into, so its
    // draw tops up as the judge's results are entered.
    if (entryClass?.status === "completed") {
      await fillChampionshipsFedBy(entryClass.id);
    }
  };

  const submitEditClass = async () => {
    if (!form.num || !form.name?.trim()) { setFormError("Class number and name are required"); return; }
    const updateData = { num: parseInt(form.num, 10), name: form.name.trim(), judge: form.judge ?? "", judge2: form.judge2?.trim() || null, scoring_mode: form.scoring_mode ?? "score", capacity: form.capacity ? parseInt(form.capacity, 10) : null, hp_category: form.hp_category || null };
    if (Object.prototype.hasOwnProperty.call(modal.cls ?? {}, "program_category") || form.program_category?.trim()) {
      updateData.program_category = form.program_category?.trim() || null;
    }
    if (Object.prototype.hasOwnProperty.call(modal.cls ?? {}, "program_break_before") || form.program_break_before?.trim()) {
      updateData.program_break_before = form.program_break_before?.trim() || null;
    }
    if (Object.prototype.hasOwnProperty.call(modal.cls ?? {}, "program_break_after") || form.program_break_after?.trim()) {
      updateData.program_break_after = form.program_break_after?.trim() || null;
    }
    if (modal.cls.day !== undefined) updateData.day = parseInt(form.day ?? "1", 10) || 1;
    const editFeederIds = Array.isArray(form.champ_feeder_ids) ? form.champ_feeder_ids.filter(Boolean) : [];
    if (Object.prototype.hasOwnProperty.call(modal.cls ?? {}, "champ_feeder_ids") || editFeederIds.length) {
      updateData.champ_feeder_ids = editFeederIds.length ? editFeederIds : null;
      updateData.champ_take = form.champ_take === "top1" ? "top1" : "top2";
    }
    const { error } = await supabase.from("classes").update(updateData).eq("id", modal.cls.id);
    if (error) {
      setFormError(error.message?.includes("champ_feeder_ids") || error.message?.includes("champ_take")
        ? 'Championship classes need a database update. Please run "schema-v43-championship-classes.sql" in your Supabase SQL Editor first.'
        : error.message?.includes("program_break_before") || error.message?.includes("program_break_after")
        ? 'Database migration needed. Please run "schema-v20-program-breaks.sql" in your Supabase SQL Editor first.'
        : error.message?.includes("program_category") ? 'Database migration needed. Please run "schema-v19-class-categories.sql" in your Supabase SQL Editor first.'
        : error.message);
      return;
    }
    closeModal();
  };

  const submitPattern = async () => {
    if (!form.pattern_url?.trim() && !form.patternFile) { setFormError("Provide a URL or upload a file"); return; }
    let url = form.pattern_url?.trim() || null;
    const classIds = [...new Set([modal.classId, ...(form.applyClassIds ?? [])].filter(Boolean))];
    if (classIds.length === 0) { setFormError("Choose at least one class"); return; }
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
    const { error } = await supabase.from("classes").update({ pattern_url: url }).in("id", classIds);
    if (error) { setFormError(error.message); return; }
    await loadClasses();
    await loadPatternFiles();
    closeModal();
  };

  const submitBulkPatterns = async () => {
    const files = form.patternFiles ?? [];
    if (!files.length) { setFormError("Choose one or more pattern files to upload"); return; }
    setUploadingPatternFiles(true);
    setFormError("");
    try {
      let uploaded = 0;
      const uploadedFiles = [];
      for (const file of files) {
        const safeName = file.name.replace(/[^\w.\- ]+/g, "-");
        const path = `${eventId}/${safeName}`;
        const { error } = await supabase.storage.from("patterns").upload(path, file, { upsert: true });
        if (error) {
          const msg = error.message?.toLowerCase() ?? "";
          setFormError(msg.includes("not found") || msg.includes("bucket")
            ? 'Storage not configured. Create a "patterns" bucket in Supabase Storage (Dashboard → Storage → New bucket, name: patterns, Public: on).'
            : error.message);
          return;
        }
        const { data: urlData } = supabase.storage.from("patterns").getPublicUrl(path);
        uploadedFiles.push({ name: safeName, url: urlData.publicUrl });
        uploaded += 1;
      }
      await loadPatternFiles();
      setForm((f) => {
        const singlePdf = uploadedFiles.length === 1 && isPdfFile(uploadedFiles[0].name) ? uploadedFiles[0].url : "";
        return {
          ...f,
          patternFiles: [],
          patternUploadMessage: `Uploaded ${uploaded} pattern${uploaded === 1 ? "" : "s"}.`,
          patterns_pdf_url: f.patterns_pdf_url || currentEvent?.patterns_pdf_url || singlePdf,
        };
      });
    } finally {
      setUploadingPatternFiles(false);
    }
  };

  const submitPatternsPdf = async () => {
    if (!eventId) return;
    const url = form.patterns_pdf_url?.trim() || null;
    setFormError("");
    const { error } = await supabase.from("events").update({ patterns_pdf_url: url }).eq("id", eventId);
    if (error) {
      setFormError(error.message?.includes("patterns_pdf_url")
        ? 'Database migration needed. Please run "schema-v21-event-patterns-pdf.sql" in your Supabase SQL Editor first.'
        : error.message);
      return;
    }
    await loadEvents();
    setForm((f) => ({
      ...f,
      patterns_pdf_url: url ?? "",
      patternsPdfMessage: url
        ? "Rider Patterns PDF updated."
        : "Patterns PDF will use the generated class pattern book.",
    }));
  };

  // ---- export ----
  const exportClasses = async () => {
    if (!currentEvent) return;
    if (!classes.length) {
      window.alert("No classes to export yet.");
      return;
    }
    setExportingClasses(true);
    try {
      const mod = await import("xlsx"); const XLSX = mod.default ?? mod;
      const wb = XLSX.utils.book_new();

      const classRows = [[
        "Category", "Break Before", "Class #", "Class Name", "Judge 1", "Judge 2",
        "Break After", "Type", "HP Category", "Day", "Capacity", "Pattern URL",
      ]];

      [...classes]
        .sort((a, b) =>
          (a.day ?? 1) - (b.day ?? 1) ||
          (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
          (a.num ?? 0) - (b.num ?? 0))
        .forEach((cls) => {
          classRows.push([
            cls.program_category ?? "",
            cls.program_break_before ?? "",
            cls.num ?? "",
            cls.name ?? "",
            cls.judge ?? "",
            cls.judge2 ?? "",
            cls.program_break_after ?? "",
            SCORING_MODE_LABELS[cls.scoring_mode ?? "score"] ?? "Score",
            cls.hp_category ?? "",
            cls.day ?? 1,
            cls.capacity ?? "",
            cls.pattern_url ?? "",
          ]);
        });

      const classSheet = XLSX.utils.aoa_to_sheet(classRows);
      classSheet["!cols"] = [
        { wch: 24 }, { wch: 24 }, { wch: 9 }, { wch: 42 }, { wch: 22 }, { wch: 22 },
        { wch: 24 }, { wch: 18 }, { wch: 22 }, { wch: 8 }, { wch: 10 }, { wch: 42 },
      ];
      XLSX.utils.book_append_sheet(wb, classSheet, "Classes");

      const optionsRows = [
        ["Type options"],
        ...Object.values(SCORING_MODE_LABELS).map((label) => [label]),
        [],
        ["Notes"],
        ["Edit the Classes tab, then use Import classes to re-upload it."],
        ["Rows are matched to existing classes by class number/name, then category/name, then name."],
        ["Leave Capacity blank for unlimited spots."],
        ["Pattern URL can be a public link or a pattern previously uploaded to the event."],
      ];
      const optionsSheet = XLSX.utils.aoa_to_sheet(optionsRows);
      optionsSheet["!cols"] = [{ wch: 90 }];
      XLSX.utils.book_append_sheet(wb, optionsSheet, "Options");

      XLSX.writeFile(wb, `${cleanFilename(currentEvent.name, "classes")}-classes.xlsx`);
    } finally {
      setExportingClasses(false);
    }
  };

  const exportResults = async () => {
    if (!currentEvent) return;
    setExporting(true);
    try {
      const mod = await import("xlsx"); const XLSX = mod.default ?? mod;

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

      // Results sheet — one row per entry (two score columns for two-judge classes)
      const resRows = [["Class #", "Class Name", "Judge 1", "Judge 2", "Pl (J1)", "Back #", "Horse", "Exhibitor", "Score (J1)", "Score (J2)", "Entries in Class", "Registrations"]];
      classes.forEach((cls) => {
        if (cls.hidden) return; // hidden classes are out of results by design
        const ce = (entries ?? []).filter((e) => e.class_id === cls.id);
        const competing = ce.filter((e) => !e.scratched).length;
        const mode = cls.scoring_mode ?? "score";
        const isPlacing = mode === "placing" || mode === "class_only" || mode === "tbc_class";
        const placed = ce.filter((e) => e.score != null && !e.scratched)
          .sort((a, b) => {
            const d = isPlacing ? a.score - b.score : b.score - a.score;
            return d !== 0 ? d : isPlacing ? (a.score2 ?? 99) - (b.score2 ?? 99) : (b.score2 ?? 0) - (a.score2 ?? 0);
          });
        const scratched = ce.filter((e) => e.scratched);
        placed.forEach((e, i) => {
          const regs = (horseMap[e.back_number]?.horse_registrations ?? []).map((r) => `${r.club}${r.registration_number ? " " + r.registration_number : ""}`).join(", ");
          resRows.push([cls.num, cls.name, cls.judge ?? "", cls.judge2 ?? "", i + 1, e.back_number, e.horse, e.exhibitor, e.score, cls.judge2 ? (e.score2 ?? "") : "", competing, regs]);
        });
        // A horse placed/scored by judge 2 but not judge 1 is still a result —
        // append it with a blank J1 placing rather than dropping it entirely.
        if (cls.judge2) {
          ce.filter((e) => e.score == null && e.score2 != null && !e.scratched)
            .sort((a, b) => (isPlacing ? a.score2 - b.score2 : b.score2 - a.score2))
            .forEach((e) => {
              const regs = (horseMap[e.back_number]?.horse_registrations ?? []).map((r) => `${r.club}${r.registration_number ? " " + r.registration_number : ""}`).join(", ");
              resRows.push([cls.num, cls.name, cls.judge ?? "", cls.judge2 ?? "", "", e.back_number, e.horse, e.exhibitor, "", e.score2, competing, regs]);
            });
        }
        scratched.forEach((e) => resRows.push([cls.num, cls.name, cls.judge ?? "", cls.judge2 ?? "", "SCR", e.back_number, e.horse, e.exhibitor, "", "", competing, ""]));
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resRows), "Results");

      // Club Points sheet — for two-judge classes: separate rows per judge (each judge's placings are independent)
      const ptRows = [["Class #", "Class Name", "Judge", "Placing", "Back #", "Horse", "Exhibitor", "Score", "Entries in Class", "Points", "Club", "Registration #"]];

      const pushPtRows = (clsNum, clsName, judgeName, sortedEntries, getPlacing, getScore, competing) => {
        sortedEntries.forEach((e) => {
          const placing = getPlacing(e);
          if (placing == null) return;
          const pts = calcPoints(placing, competing);
          const regs = horseMap[e.back_number]?.horse_registrations ?? [];
          const score = getScore(e);
          if (regs.length === 0) {
            ptRows.push([clsNum, clsName, judgeName, placing, e.back_number, e.horse, e.exhibitor, score, competing, pts, "", ""]);
          } else {
            regs.forEach((r) => ptRows.push([clsNum, clsName, judgeName, placing, e.back_number, e.horse, e.exhibitor, score, competing, pts, r.club, r.registration_number ?? ""]));
          }
        });
      };

      classes.forEach((cls) => {
        if (cls.hidden) return; // hidden classes are out of results by design
        const ce = (entries ?? []).filter((e) => e.class_id === cls.id);
        const competing = ce.filter((e) => !e.scratched).length;
        const mode = cls.scoring_mode ?? "score";
        const isPlacing = mode === "placing" || mode === "class_only" || mode === "tbc_class";
        const active = ce.filter((e) => !e.scratched);
        const scored = active.filter((e) => e.score != null);

        if (cls.judge2) {
          // Two judges — each judge's results generate independent point rows.
          // Judge 2's list comes from ALL active entries: a horse judge 1
          // didn't place can still hold a judge-2 placing and earn points.
          const j1Sorted = [...scored].sort((a, b) => isPlacing ? a.score - b.score : b.score - a.score);
          pushPtRows(cls.num, cls.name, cls.judge || "Judge 1", j1Sorted,
            (e) => isPlacing ? e.score : j1Sorted.findIndex((x) => x.id === e.id) + 1,
            (e) => e.score, competing);

          const j2Scored = active.filter((e) => e.score2 != null);
          const j2Sorted = [...j2Scored].sort((a, b) => isPlacing ? a.score2 - b.score2 : b.score2 - a.score2);
          pushPtRows(cls.num, cls.name, cls.judge2, j2Sorted,
            (e) => isPlacing ? e.score2 : j2Sorted.findIndex((x) => x.id === e.id) + 1,
            (e) => e.score2, competing);
        } else {
          // Single judge
          const j1Sorted = [...scored].sort((a, b) => isPlacing ? a.score - b.score : b.score - a.score);
          pushPtRows(cls.num, cls.name, cls.judge ?? "", j1Sorted,
            (e) => isPlacing ? e.score : j1Sorted.findIndex((x) => x.id === e.id) + 1,
            (e) => e.score, competing);
        }
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ptRows), "Club Points");

      XLSX.writeFile(wb, `${(currentEvent.name ?? "results").replace(/[^a-z0-9]/gi, "-")}-results.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  // ---- push all HP points ----
  const pushAllHighPoints = async () => {
    const eligible = classes.filter((c) => c.hp_category && c.status === "completed");
    if (!eligible.length) return;
    setPushingAllHp(true);
    try {
      // One push per unique category — each call already recalculates the whole category.
      const seen = new Set();
      let failed = 0;
      for (const cls of eligible) {
        if (seen.has(cls.hp_category)) continue;
        seen.add(cls.hp_category);
        const res = await pushToHighPoints(cls);
        if (res && !res.ok) failed += 1;
      }
      if (failed > 0) {
        window.alert(`${failed} high-points ${failed === 1 ? "category" : "categories"} could not be updated — check your internet connection and try “Push all HP” again.`);
      }
    } finally {
      setPushingAllHp(false);
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
              {" · "}<Link href={`/event/${eventId}/program`} style={{ color: "var(--brass)" }}>Program</Link>
              {" · "}<Link href={`/event/${eventId}/results`} style={{ color: "var(--brass)" }}>Results</Link>
              {" · "}<a href={`/api/events/${eventId}/patterns`} style={{ color: "var(--brass)" }}>Patterns PDF</a>
              {" · "}<Link href={`/event/${eventId}/register`} style={{ color: "var(--brass)" }}>Entry form</Link>
              {currentEvent && (() => {
                const s = currentEvent.status;
                const LABEL = { pre_open: "Pre-open", open: "Entries open", upcoming: "Entries open", closed: "Entries closed", live: "Live", completed: "Completed", archived: "Archived", cancelled: "Cancelled" };
                const COLOR = { pre_open: "#7A6E8A", open: "#2D7A52", upcoming: "#2D7A52", closed: "#9A6A1A", live: "var(--clay)", completed: "var(--green)", archived: "#9A9A9A", cancelled: "#B03030" };
                return (
                  <>
                    <span style={{ marginLeft: 10, background: COLOR[s] ?? "var(--quiet)", color: "#fff", borderRadius: 10, padding: "2px 10px", fontSize: 11.5, fontWeight: 700 }}>
                      {LABEL[s] ?? s}
                    </span>
                    {s === "cancelled" && currentEvent.cancellation_reason && (
                      <span style={{ marginLeft: 8, fontSize: 12.5, color: "#B03030", fontStyle: "italic" }}>
                        — {currentEvent.cancellation_reason}
                      </span>
                    )}
                  </>
                );
              })()}
            </>}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%" }}>
            {/* The toolbar is grouped so the dozen-plus controls read as three
                jobs, not a wall of buttons. A full-width label forces each
                group onto its own row. */}
            <span style={{ flexBasis: "100%", fontSize: 10.5, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--quiet)" }}>Show day</span>
            {!isClinic && (
              <button className="btn-ghost" style={{ borderColor: "var(--brass)", color: "var(--brass)", fontWeight: 700 }}
                onClick={() => openModal("dayEntry")} disabled={!eventId || classes.length === 0}
                title="Take an entry at the gate: one horse into many classes, payment on the Square terminal">
                🐎 Day entry
              </button>
            )}
            {!isClinic && (
              <button className="btn-ghost" onClick={gateAccess} disabled={!eventId}
                title="Share a link that gives the gate marshal gate controls only — no staff access">
                🚪 Gate access
              </button>
            )}
            <button className="btn-ghost" onClick={testPush} disabled={!eventId}>Test push</button>
            {classes.some((c) => c.hp_category && c.status === "completed") && (
              <button className="btn-ghost" style={{ borderColor: "#2D7A52", color: "#2D7A52" }}
                onClick={pushAllHighPoints} disabled={pushingAllHp || !eventId}>
                {pushingAllHp ? "Pushing HP…" : "↑ Push all HP"}
              </button>
            )}

            <span style={{ flexBasis: "100%", fontSize: 10.5, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--quiet)", marginTop: 4 }}>People &amp; money</span>
            <Link href="/coordinator/registrations" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", border: "1px solid var(--line)", background: "#fff", color: "var(--leather)", borderRadius: 10, padding: "8px 14px", fontSize: 14, fontWeight: 700 }}>
              Registrations
            </Link>
            <Link href="/coordinator/memberships" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", border: "1px solid var(--line)", background: "#fff", color: "var(--leather)", borderRadius: 10, padding: "8px 14px", fontSize: 14, fontWeight: 700 }}>
              Memberships
            </Link>
            <Link href="/coordinator/numbers" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", border: "1px solid var(--line)", background: "#fff", color: "var(--leather)", borderRadius: 10, padding: "8px 14px", fontSize: 14, fontWeight: 700 }}>
              New numbers
            </Link>

            <span style={{ flexBasis: "100%", fontSize: 10.5, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--quiet)", marginTop: 4 }}>Setup &amp; data</span>
            <button className="btn-ghost" onClick={() => openModal("editEvent", { event: currentEvent })} disabled={!eventId}>
              Edit event
            </button>
            {eventId && (
              <button className="btn-ghost" onClick={() => openModal("bulkPatterns")}>
                Manage patterns PDF
              </button>
            )}
            <button className="btn-ghost" onClick={() => openModal("importClasses")} disabled={!eventId}>⇪ Import classes</button>
            <button className="btn-ghost" onClick={() => openModal("import")} disabled={!eventId}>⇪ Import entries</button>
            <button className="btn-ghost" onClick={sortByClassNumber} disabled={busy || !eventId || classes.length < 2}
              title="Put every class into class-number order, day by day">
              ↕ Sort by number
            </button>
            <button className="btn-ghost" onClick={exportClasses} disabled={exportingClasses || !eventId || classes.length === 0}>
              {exportingClasses ? "Exporting…" : "⇩ Export classes"}
            </button>
            <button className="btn-ghost" onClick={exportResults} disabled={exporting || !eventId}>{exporting ? "Exporting…" : "⇩ Export results"}</button>
            <Link href="/coordinator/health" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", border: "1px solid var(--line)", background: "#fff", color: "var(--quiet)", borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: 700 }}>
              ⚙ Health
            </Link>

            {eventId && <span style={{ flexBasis: "100%", fontSize: 10.5, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--quiet)", marginTop: 4 }}>Event status</span>}
            {eventId && (() => {
              const s = currentEvent?.status;
              return (
                <>
                  {s === "pre_open" && (
                    <button className="btn-ghost" style={{ borderColor: "var(--green)", color: "var(--green)" }}
                      onClick={() => setEventStatus("open")} disabled={busy}>
                      Open entries
                    </button>
                  )}
                  {(s === "open" || s === "upcoming") && (
                    <>
                      <button className="btn-ghost" style={{ fontSize: 13 }}
                        onClick={() => { if (window.confirm("Revert to pre-open? Entries will be closed and the event will show as 'Coming soon' again.")) setEventStatus("pre_open"); }}
                        disabled={busy}>
                        ← Back to pre-open
                      </button>
                      <button className="btn-ghost danger" onClick={closeEntries} disabled={busy}>
                        Close entries
                      </button>
                    </>
                  )}
                  {s === "closed" && (
                    <>
                      <button className="btn-ghost" style={{ borderColor: "var(--green)", color: "var(--green)" }}
                        onClick={() => setEventStatus("open")} disabled={busy}>
                        Reopen entries
                      </button>
                      <button className="btn-ghost" onClick={randomiseDraw} disabled={busy}>
                        🔀 Randomise draw
                      </button>
                      <button className="btn-ghost" style={{ borderColor: "var(--green)", color: "var(--green)" }}
                        onClick={() => setEventStatus("live")} disabled={busy}>
                        Go live
                      </button>
                    </>
                  )}
                  {s === "live" && (
                    <>
                      <button className="btn-ghost" style={{ fontSize: 13 }}
                        onClick={revertToClosed}
                        disabled={busy}>
                        ← Back to closed
                      </button>
                      <button className="btn-ghost danger" onClick={endEvent} disabled={busy}>End event</button>
                    </>
                  )}
                  {s === "completed" && (
                    <button className="btn-ghost" onClick={() => {
                      if (window.confirm("Archive this event? It will be hidden from the public home page but results remain accessible via its URL.")) setEventStatus("archived");
                    }}>Archive</button>
                  )}
                  {s === "cancelled" && (
                    <button className="btn-ghost" style={{ borderColor: "var(--green)", color: "var(--green)" }}
                      onClick={() => { if (window.confirm("Reopen this event? It will be moved back to pre-open so you can set it up again.")) setEventStatus("pre_open"); }}
                      disabled={busy}>
                      Reopen event
                    </button>
                  )}
                  {s !== "completed" && s !== "archived" && s !== "cancelled" && (
                    <button className="btn-ghost danger" onClick={cancelEvent} disabled={busy}>
                      Cancel event
                    </button>
                  )}
                  {s !== "live" && s !== "completed" && s !== "archived" && (
                    <button className="btn-ghost danger" onClick={deleteEvent} disabled={busy}>
                      Delete event
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        {liveClass && current && liveClass.scoring_mode !== "class_only" && liveClass.scoring_mode !== "tbc_class" && liveClass.scoring_mode !== "tbc" && (
          <section className="card" style={{ padding: 20, borderColor: "var(--brass)" }}>
            <div style={{ fontSize: 11.5, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--quiet)", fontWeight: 600, marginBottom: 10 }}>
              Class {liveClass.num} · {liveClass.scoring_mode === "placing" ? "Set placing" : "Enter score"} — #{fmtBack(current.back_number)} {current.horse}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {/* Judge 1 input */}
              <div style={{ flex: "1 1 140px" }}>
                {liveClass.judge2 && (
                  <div style={{ fontSize: 11, color: "var(--quiet)", fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".1em" }}>
                    {liveClass.judge || "Judge 1"}
                  </div>
                )}
                {liveClass.scoring_mode === "placing" ? (
                  <select className="field display" style={{ width: "100%", fontSize: 20, fontWeight: 600 }}
                    value={scoreInput} onChange={(e) => setScoreInput(e.target.value)}>
                    <option value="">Select placing…</option>
                    {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{ordinal(n)}</option>
                    ))}
                  </select>
                ) : (
                  <input className="field display" style={{ width: "100%", fontSize: 22, fontWeight: 600 }}
                    type="number" step="0.5" inputMode="decimal" placeholder="e.g. 72.5"
                    value={scoreInput} onChange={(e) => setScoreInput(e.target.value)}
                    onKeyDown={(e) => !liveClass.judge2 && e.key === "Enter" && saveScore()} />
                )}
              </div>
              {/* Judge 2 input — only when two judges */}
              {liveClass.judge2 && (
                <div style={{ flex: "1 1 140px" }}>
                  <div style={{ fontSize: 11, color: "var(--quiet)", fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".1em" }}>
                    {liveClass.judge2}
                  </div>
                  {liveClass.scoring_mode === "placing" ? (
                    <select className="field display" style={{ width: "100%", fontSize: 20, fontWeight: 600 }}
                      value={scoreInput2} onChange={(e) => setScoreInput2(e.target.value)}>
                      <option value="">Select placing…</option>
                      {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>{ordinal(n)}</option>
                      ))}
                    </select>
                  ) : (
                    <input className="field display" style={{ width: "100%", fontSize: 22, fontWeight: 600 }}
                      type="number" step="0.5" inputMode="decimal" placeholder="e.g. 71.0"
                      value={scoreInput2} onChange={(e) => setScoreInput2(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && saveScore()} />
                  )}
                </div>
              )}
              <button className="btn" style={{ flex: "1 1 180px", alignSelf: "flex-end" }}
                disabled={(scoreInput === "" || (liveClass.judge2 && scoreInput2 === "")) || busy}
                onClick={saveScore}>
                {liveClass.scoring_mode === "placing" ? "Save placing & call next →" : "Save score & call next →"}
              </button>
              <button className="btn-ghost danger" style={{ padding: "10px 16px", fontSize: 14, borderRadius: 10, alignSelf: "flex-end" }} onClick={() => toggleScratch(current)}>
                Scratch this entry
              </button>
            </div>
          </section>
        )}

        {liveClass && liveClass.scoring_mode === "class_only" && (
          <section className="card" style={{ padding: 20, borderColor: "var(--brass)", background: "#FBF4E4" }}>
            <div style={{ fontSize: 11.5, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--quiet)", fontWeight: 600, marginBottom: 8 }}>
              Class {liveClass.num} · {liveClass.name} — in progress
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 13.5, color: "var(--quiet)" }}>
              Everyone is in the ring together. Use <strong>Complete</strong> when done, then edit individual entries to enter placings.
            </p>
            <button className="btn" style={{ background: "var(--leather)" }} onClick={() => completeClass(liveClass)}>
              Complete class
            </button>
          </section>
        )}

        {liveClass && current && liveClass.scoring_mode === "tbc" && (
          <section className="card" style={{ padding: 20, borderColor: "var(--brass)" }}>
            <div style={{ fontSize: 11.5, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--quiet)", fontWeight: 600, marginBottom: 10 }}>
              Class {liveClass.num} · TBC draw — #{fmtBack(current.back_number)} {current.horse}
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 13.5, color: "var(--quiet)" }}>
              Tap <strong>Next entry →</strong> as each horse enters the ring. Results will be entered later from the judge's paperwork.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn" style={{ flex: "1 1 180px" }} disabled={busy} onClick={callNext}>
                Next entry →
              </button>
              <button className="btn-ghost danger" style={{ padding: "10px 16px", fontSize: 14, borderRadius: 10 }} onClick={() => toggleScratch(current)}>
                Scratch this entry
              </button>
            </div>
          </section>
        )}

        {liveClass && liveClass.scoring_mode === "tbc_class" && (
          <section className="card" style={{ padding: 20, borderColor: "var(--brass)", background: "#FBF4E4" }}>
            <div style={{ fontSize: 11.5, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--quiet)", fontWeight: 600, marginBottom: 8 }}>
              Class {liveClass.num} · {liveClass.name} — results to be confirmed
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 13.5, color: "var(--quiet)" }}>
              Everyone is in the ring together. Click <strong>Complete</strong> when done, then use the Edit button on each entry to enter results from the judge's paperwork.
            </p>
            <button className="btn" style={{ background: "var(--leather)" }} onClick={() => completeClass(liveClass)}>
              Complete class
            </button>
          </section>
        )}

        {selectedClassIds.size > 0 && (
          <div style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", gap: 10, alignItems: "center", background: "var(--leather)", color: "#fff", borderRadius: 10, padding: "10px 16px" }}>
            <span style={{ fontWeight: 700, flex: 1 }}>{selectedClassIds.size} class{selectedClassIds.size === 1 ? "" : "es"} selected</span>
            <button className="btn-ghost" style={{ color: "#fff", borderColor: "#fff" }} onClick={() => setSelectedClassIds(new Set())} disabled={busy}>
              Clear
            </button>
            <button className="btn-ghost danger" style={{ background: "#fff" }} onClick={deleteSelectedClasses} disabled={busy}>
              Delete selected
            </button>
          </div>
        )}

        {(() => {
          const shownClasses = classes.filter((c) => !c.hidden);
          // Tuck completed classes into a collapsed section while the show is
          // running — same as the public event view. Everything shows in full
          // once the event is over.
          const showRunning = currentEvent && !["completed", "archived", "cancelled"].includes(currentEvent.status);
          const completedList = shownClasses.filter((c) => c.status === "completed");
          const tuckCompleted = !isClinic && showRunning && completedList.length > 0;
          const mainList = tuckCompleted ? shownClasses.filter((c) => c.status !== "completed") : shownClasses;
          const renderClassRow = (row) => {
          if (row.type === "break") {
            return (
              <div key={row.key} style={{ margin: "24px 0 8px", color: "var(--leather)", background: "#FFF7D6", border: "1px solid #E6C76B", borderRadius: 8, padding: "7px 12px", fontWeight: 800, fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase" }}>
                {row.label}
              </div>
            );
          }
          if (row.type === "category") {
            return (
              <div key={row.key} style={{ margin: "22px 0 8px", color: "#1746C6", fontWeight: 800, fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase" }}>
                {row.label}
              </div>
            );
          }
          const cls = row.cls;
          const mode = cls.scoring_mode ?? "score";
          const isTbcDraw = mode === "tbc";
          const twoJudges = !!cls.judge2;
          const isPlacing = mode === "placing" || mode === "class_only" || mode === "tbc_class";
          const placed = cls.entries.filter((e) => e.score != null && !e.scratched)
            .sort((a, b) => {
              const d = isPlacing ? a.score - b.score : b.score - a.score;
              if (d !== 0) return d;
              return isPlacing ? (a.score2 ?? 99) - (b.score2 ?? 99) : (b.score2 ?? 0) - (a.score2 ?? 0);
            });
          const calledRows = isTbcDraw ? cls.entries.filter((e) => e.called && e.score == null && !e.scratched) : [];
          const pending = isTbcDraw
            ? cls.entries.filter((e) => !e.called && !e.scratched)
            : cls.entries.filter((e) => e.score == null && !e.scratched);
          const scratchedRows = cls.entries.filter((e) => e.scratched);
          const isLive = cls.status === "live";
          const confirmedSpots = cls.entries.filter((e) => !e.scratched).length;
          const isFull = cls.capacity != null && confirmedSpots >= cls.capacity;
          return (
            <section key={cls.id} className="card" style={{
              ...(isLive ? { borderColor: "var(--brass)" } : {}),
              // .card clips overflow for its rounded corners, which cuts the
              // "⋯" dropdown off on short cards — let it spill while open.
              ...(classMenu === cls.id ? { overflow: "visible" } : {}),
            }}>
              <div className="card-head" style={{ flexWrap: "nowrap", ...(isLive ? { background: "#FBF4E4" } : {}) }}>
                {cls.status === "upcoming" && (
                  <input type="checkbox" checked={selectedClassIds.has(cls.id)} onChange={() => toggleClassSelect(cls.id)}
                    aria-label={`Select ${isClinic ? cls.name : `Class ${cls.num} · ${cls.name}`} for deletion`}
                    style={{ width: 18, height: 18, flexShrink: 0, marginRight: 2, marginTop: 2 }} />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="display" style={{ fontWeight: 600, fontSize: 16.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {isClinic ? cls.name : `Class ${cls.num} · ${cls.name}`}
                  </div>
                  {!isClinic && (cls.judge || cls.judge2) && (
                    <div style={{ fontSize: 12, color: "var(--quiet)", marginTop: 1 }}>
                      {cls.judge2
                        ? `Judges: ${cls.judge || "—"} · ${cls.judge2}`
                        : `Judge: ${cls.judge}`}
                    </div>
                  )}
                  {cls.hp_category && (
                    <div style={{ fontSize: 11, color: "var(--brass)", marginTop: 2, fontWeight: 700 }}>
                      HP: {cls.hp_category}
                    </div>
                  )}
                  {isChampionship(cls) && (
                    <div style={{ fontSize: 11, color: "#7A5C10", marginTop: 2, fontWeight: 700 }}>
                      🏆 Championship — fills with {cls.champ_take === "top1" ? "the winner" : "1st & 2nd"} from classes {
                        cls.champ_feeder_ids.map((id) => classes.find((c) => c.id === id)?.num).filter((n) => n != null).join(", ") || "—"
                      }
                    </div>
                  )}
                  {cls.capacity != null && (
                    <div style={{ fontSize: 12, marginTop: 2 }}>
                      <span style={{ background: isFull ? "var(--clay)" : confirmedSpots >= cls.capacity * 0.8 ? "#A05000" : "var(--green)", color: "#fff", borderRadius: 8, padding: "1px 8px", fontWeight: 700 }}>
                        {confirmedSpots} / {cls.capacity} spots
                      </span>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end", position: "relative" }}>
                  {cls.status === "upcoming" && !isClinic && (
                    <>
                      <button className="btn-ghost" onClick={() => moveClass(cls, -1)} aria-label="Move earlier">▲</button>
                      <button className="btn-ghost" onClick={() => moveClass(cls, 1)} aria-label="Move later">▼</button>
                      {currentEvent?.status === "live" && (
                        <button className="btn-ghost" style={{ borderColor: "var(--green)", color: "var(--green)" }} onClick={() => startClass(cls)} disabled={busy}>Start</button>
                      )}
                    </>
                  )}
                  {isLive && !isClinic && <button className="btn-ghost" onClick={() => completeClassManual(cls)} disabled={busy}>Complete</button>}
                  <button className="btn-ghost" onClick={() => openModal("entry", { classId: cls.id })}>
                    {isClinic ? "+ Participant" : "+ Entry"}
                  </button>
                  <button className="btn-ghost" aria-label="More actions" style={{ fontWeight: 800, minWidth: 38 }}
                    onClick={() => setClassMenu(classMenu === cls.id ? null : cls.id)}>
                    ⋯
                  </button>
                  <span className={`badge ${cls.status}`}>{cls.status}</span>
                  {classMenu === cls.id && (
                    <>
                      <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setClassMenu(null)} />
                      <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 50, marginTop: 4, background: "#fff", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "0 10px 28px rgba(42,30,18,.2)", padding: 6, display: "grid", gap: 2, minWidth: 190 }}>
                        {[
                          { label: "Edit class", show: true, onClick: () => openModal("editClass", { cls }) },
                          { label: cls.pattern_url ? "✓ Pattern" : "Set pattern", show: !isClinic, onClick: () => openModal("pattern", { classId: cls.id }) },
                          { label: `Result sheets${Array.isArray(cls.result_sheets) && cls.result_sheets.length ? ` (${cls.result_sheets.length})` : ""}`, show: !isClinic, onClick: () => openModal("resultSheets", { classId: cls.id }) },
                          { label: "↻ Refresh qualifiers", show: isChampionship(cls) && cls.status !== "completed" && !isClinic, onClick: () => refreshChampionship(cls) },
                          { label: "Push to High Points", show: cls.status === "completed" && !!cls.hp_category && !isClinic, onClick: async () => {
                            const res = await pushToHighPoints(cls);
                            if (res && !res.ok) window.alert("High points could not be updated — check your internet connection and try again.");
                            else if (res && res.ok) window.alert("High points updated.");
                          } },
                          { label: "Hide from schedule", show: cls.status === "upcoming", onClick: () => hideClass(cls) },
                          { label: "Delete class", show: cls.status === "upcoming", danger: true, onClick: () => deleteClass(cls) },
                        ].filter((a) => a.show).map((a) => (
                          <button key={a.label}
                            style={{ textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "9px 10px", borderRadius: 8, fontSize: 13.5, fontWeight: 600, color: a.danger ? "var(--clay)" : "var(--leather)", fontFamily: "inherit" }}
                            onClick={() => { setClassMenu(null); a.onClick(); }}>
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <table>
                <tbody>
                  {placed.map((e, i) => (
                    <tr key={e.id}>
                      <td className="display" style={{ width: 50, fontWeight: 700, color: i === 0 ? "var(--brass)" : "var(--quiet)" }}>{i + 1}</td>
                      <td style={{ fontWeight: 600 }}>#{fmtBack(e.back_number)} {e.horse} <span style={{ color: "var(--quiet)", fontWeight: 400 }}>· {e.exhibitor}</span></td>
                      <td className="display" style={{ textAlign: "right", fontWeight: 700, width: twoJudges ? 120 : 70 }}>
                        {mode === "placing"
                          ? (twoJudges ? `${ordinal(e.score)} / ${ordinal(e.score2 ?? "?")}` : ordinal(e.score))
                          : (twoJudges && e.score2 != null ? `${e.score} / ${e.score2}` : e.score)}
                      </td>
                      <td style={{ width: 1, textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-flex", gap: 5 }}>
                          <button className="btn-ghost" style={{ fontSize: 11 }} onClick={() => openModal("editEntry", { entry: e })}>Edit</button>
                          <button className="btn-ghost danger" style={{ fontSize: 11 }} onClick={() => deleteEntry(e)}>Delete</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                  {calledRows.map((e, i) => (
                    <tr key={e.id} style={{ opacity: 0.75 }}>
                      <td style={{ width: 50, color: "var(--quiet)", fontStyle: "italic", fontSize: 11, fontWeight: 600 }}>TBC</td>
                      <td style={{ fontWeight: 600 }}>#{fmtBack(e.back_number)} {e.horse} <span style={{ color: "var(--quiet)", fontWeight: 400 }}>· {e.exhibitor}</span></td>
                      <td colSpan={2} style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-flex", gap: 5 }}>
                          <button className="btn-ghost" style={{ fontSize: 11 }} onClick={() => openModal("editEntry", { entry: e })}>Edit</button>
                          <button className="btn-ghost danger" style={{ fontSize: 11 }} onClick={() => deleteEntry(e)}>Delete</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                  {pending.map((e, i) => (
                    <tr key={e.id}>
                      <td style={{ width: 50, color: isLive && i === 0 ? "var(--clay)" : "var(--quiet)", fontWeight: 700, fontSize: isLive && i === 0 ? 11 : 13 }}>
                        {isLive && i === 0 ? "NOW" : placed.length + calledRows.length + i + 1}
                      </td>
                      <td style={{ fontWeight: 600 }}>#{fmtBack(e.back_number)} {e.horse} <span style={{ color: "var(--quiet)", fontWeight: 400 }}>· {e.exhibitor}</span></td>
                      <td colSpan={2} style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-flex", gap: 5 }}>
                          <button className="btn-ghost" onClick={() => movePending(cls, e, -1)} aria-label="Move earlier">▲</button>
                          <button className="btn-ghost" onClick={() => movePending(cls, e, 1)} aria-label="Move later">▼</button>
                          <button className="btn-ghost danger" onClick={() => toggleScratch(e)}>Scratch</button>
                          <button className="btn-ghost" onClick={() => openModal("editEntry", { entry: e })}>Edit</button>
                          <button className="btn-ghost danger" onClick={() => deleteEntry(e)}>Delete</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                  {scratchedRows.map((e) => (
                    <tr key={e.id} style={{ opacity: 0.6 }}>
                      <td style={{ width: 50, color: "var(--clay)", fontSize: 10.5, fontWeight: 700 }}>SCR</td>
                      <td style={{ fontWeight: 600, textDecoration: "line-through" }}>#{fmtBack(e.back_number)} {e.horse}</td>
                      <td colSpan={2} style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-flex", gap: 5 }}>
                          {cls.status !== "completed" && <button className="btn-ghost" onClick={() => toggleScratch(e)}>Restore</button>}
                          <button className="btn-ghost" onClick={() => openModal("editEntry", { entry: e })}>Edit</button>
                          <button className="btn-ghost danger" onClick={() => deleteEntry(e)}>Delete</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
          };
          return (
            <>
              {tuckCompleted && (
                <details className="card" style={{ padding: "12px 16px", overflow: "visible" }}>
                  <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--quiet)", fontSize: 14 }}>
                    Completed classes ({completedList.length}) — tap to view / enter results
                  </summary>
                  <div style={{ marginTop: 10 }}>
                    {programDisplayRows(completedList).map(renderClassRow)}
                  </div>
                </details>
              )}
              {programDisplayRows(mainList).map(renderClassRow)}
            </>
          );
        })()}

        {classes.some((c) => c.hidden) && (
          <details className="card" style={{ padding: "12px 16px", marginBottom: 8 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--quiet)", fontSize: 14 }}>
              Hidden {isClinic ? "spot types" : "classes"} ({classes.filter((c) => c.hidden).length}) — reactivate if someone enters on the day
            </summary>
            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
              <button className="btn-ghost" style={{ fontSize: 12.5, fontWeight: 700 }} onClick={unhideAllClasses}>
                ↺ Reactivate all
              </button>
            </div>
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              {classes.filter((c) => c.hidden).sort((a, b) => (a.day ?? 1) - (b.day ?? 1) || (a.sort_order ?? 0) - (b.sort_order ?? 0)).map((c) => (
                <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {isClinic ? c.name : `Class ${c.num} · ${c.name}`}
                    {(c.entries?.length ?? 0) > 0 && <span style={{ color: "var(--quiet)", fontWeight: 400 }}> · {c.entries.length} {c.entries.length === 1 ? "entry" : "entries"}</span>}
                  </span>
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => unhideClass(c)}>↺ Reactivate</button>
                    <button className="btn-ghost danger" style={{ fontSize: 12 }} onClick={() => deleteClass(c)}>Delete</button>
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn" style={{ background: "var(--leather)" }} onClick={() => openModal("class")} disabled={!eventId}>
            {isClinic ? "+ Add spot type" : "+ Add class"}
          </button>
          <Link href="/registry" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", border: "1px solid var(--line)", background: "#fff", color: "var(--quiet)", borderRadius: 10, padding: "10px 18px", fontSize: 15, fontWeight: 700 }}>
            Horse registry →
          </Link>
        </div>
      </main>

      {/* ---- MODALS ---- */}
      {modal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="modal-sheet">
            <ProgramCategoryDatalist />

            {modal.type === "event" && (
              <>
                <h2 className="display modal-title">New event</h2>
                <label className="modal-label">Event type</label>
                <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                  {[["show", "Horse show"], ["clinic", "Clinic"]].map(([val, label]) => (
                    <button key={val} type="button"
                      onClick={() => setForm((f) => ({ ...f, event_type: val }))}
                      style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `2px solid ${(form.event_type ?? "show") === val ? "var(--leather)" : "var(--line)"}`, background: (form.event_type ?? "show") === val ? "var(--sand)" : "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", color: (form.event_type ?? "show") === val ? "var(--leather)" : "var(--quiet)" }}>
                      {label}
                    </button>
                  ))}
                </div>
                <label className="modal-label">Event name *</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.name ?? ""} onChange={setField("name")} placeholder="e.g. Hunter Valley Winter Circuit" autoFocus />
                <label className="modal-label">Venue / location</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.location ?? ""} onChange={setField("location")} placeholder="e.g. Tamworth Showground" />
                <label className="modal-label">Status</label>
                <select className="field" style={{ width: "100%", fontSize: 16 }} value={form.status ?? "pre_open"} onChange={setField("status")}>
                  <option value="pre_open">Pre-open — setting up, entries not yet open</option>
                  <option value="open">Open — accepting entries now</option>
                  <option value="live">Live — happening now</option>
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
                <label className="modal-label">Entry fee per class (AUD)</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 600 }}>$</span>
                  <input className="field" type="number" min="0" step="0.50" style={{ width: 120, fontSize: 16 }}
                    value={form.fee ?? ""} onChange={setField("fee")} placeholder="0.00" />
                </div>
                <p style={{ fontSize: 12, color: "var(--quiet)", marginTop: 2 }}>
                  Set to $0 for free entry. This is what exhibitors pay per class when registering online.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label className="modal-label">Ground fee (AUD)</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 18, fontWeight: 600 }}>$</span>
                      <input className="field" type="number" min="0" step="0.50" style={{ width: "100%", fontSize: 16 }}
                        value={form.ground_fee ?? ""} onChange={setField("ground_fee")} placeholder="0.00" />
                    </div>
                  </div>
                  <div>
                    <label className="modal-label">Admin fee (AUD)</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 18, fontWeight: 600 }}>$</span>
                      <input className="field" type="number" min="0" step="0.50" style={{ width: "100%", fontSize: 16 }}
                        value={form.admin_fee ?? ""} onChange={setField("admin_fee")} placeholder="0.00" />
                    </div>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: "var(--quiet)", marginTop: 2 }}>
                  Charged once per person for this event, on their first online payment — coming back later to add more entries doesn&apos;t charge these again. $0 = no fee.
                </p>
                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={submitEvent}>Create event</button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                </div>
              </>
            )}

            {modal.type === "editEvent" && (
              <>
                <h2 className="display modal-title">Edit event</h2>
                <label className="modal-label">Event name *</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.name ?? ""} onChange={setField("name")} autoFocus />
                <label className="modal-label">Venue / location</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.location ?? ""} onChange={setField("location")} placeholder="e.g. Tamworth Showground" />
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
                <label className="modal-label">Entry fee per {isClinic ? "spot" : "class"} (AUD)</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 600 }}>$</span>
                  <input className="field" type="number" min="0" step="0.50" style={{ width: 120, fontSize: 16 }}
                    value={form.fee ?? ""} onChange={setField("fee")} placeholder="0.00" />
                </div>
                <p style={{ fontSize: 12, color: "var(--quiet)", marginTop: 2 }}>
                  Set to $0 for free entry. This only affects new online registrations from now on — anyone who's already paid keeps their original price.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label className="modal-label">Ground fee (AUD)</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 18, fontWeight: 600 }}>$</span>
                      <input className="field" type="number" min="0" step="0.50" style={{ width: "100%", fontSize: 16 }}
                        value={form.ground_fee ?? ""} onChange={setField("ground_fee")} placeholder="0.00" />
                    </div>
                  </div>
                  <div>
                    <label className="modal-label">Admin fee (AUD)</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 18, fontWeight: 600 }}>$</span>
                      <input className="field" type="number" min="0" step="0.50" style={{ width: "100%", fontSize: 16 }}
                        value={form.admin_fee ?? ""} onChange={setField("admin_fee")} placeholder="0.00" />
                    </div>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: "var(--quiet)", marginTop: 2 }}>
                  Charged once per person for this event, on their first online payment — coming back later to add more entries doesn&apos;t charge these again. $0 = no fee.
                </p>
                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={submitEditEvent}>Save changes</button>
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
                <label className="modal-label">Judge 1</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.judge ?? ""} onChange={setField("judge")} placeholder="e.g. K. Maddox" />
                <label className="modal-label">Judge 2 (leave blank for single-judge class)</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.judge2 ?? ""} onChange={setField("judge2")} placeholder="e.g. L. Smith" />
                <label className="modal-label">Program category</label>
                <input className="field" list="program-categories" style={{ width: "100%", fontSize: 16 }} value={form.program_category ?? ""} onChange={setField("program_category")} placeholder="e.g. Quarter Horse Halter" />
                <label className="modal-label">Program break before this class</label>
                <input className="field" list="program-breaks" style={{ width: "100%", fontSize: 16 }} value={form.program_break_before ?? ""} onChange={setField("program_break_before")} placeholder="e.g. BREAK FOR GEAR CHANGE" />
                <label className="modal-label">Program break after this class</label>
                <input className="field" list="program-breaks" style={{ width: "100%", fontSize: 16 }} value={form.program_break_after ?? ""} onChange={setField("program_break_after")} placeholder="e.g. FINISH" />
                <label className="modal-label">Pattern URL (optional)</label>
                <input className="field" style={{ width: "100%", fontSize: 15 }} value={form.pattern_url ?? ""} onChange={setField("pattern_url")} placeholder="Link to pattern image or PDF" />
                <label className="modal-label">Show day (1 for single-day events)</label>
                <input className="field" type="number" min="1" max="10" style={{ width: 80, fontSize: 16 }} value={form.day ?? "1"} onChange={setField("day")} />
                {!isClinic && (
                  <>
                    <label className="modal-label">Scoring mode</label>
                    <select className="field" style={{ width: "100%", fontSize: 15 }} value={form.scoring_mode ?? "score"} onChange={setField("scoring_mode")}>
                      <option value="score">Score — 70pt scale, one horse at a time</option>
                      <option value="placing">Placing — 1st/2nd/3rd, one horse at a time</option>
                      <option value="class_only">Class only — everyone together, no live draw</option>
                      <option value="tbc">TBC (draw) — horses one at a time, results from judge's paperwork</option>
                      <option value="tbc_class">TBC (whole class) — everyone together, results from judge's paperwork</option>
                    </select>
                    <label className="modal-label">High Points category</label>
                    <select className="field" style={{ width: "100%", fontSize: 15 }} value={form.hp_category ?? ""} onChange={setField("hp_category")}>
                      <option value="">— Does not count toward High Points —</option>
                      {HP_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </>
                )}
                <label className="modal-label">Spot capacity (leave blank for unlimited)</label>
                <input className="field" type="number" min="1" style={{ width: 120, fontSize: 16 }}
                  value={form.capacity ?? ""} onChange={setField("capacity")} placeholder="e.g. 20" />
                {isClinic && (
                  <p style={{ fontSize: 12, color: "var(--quiet)", marginTop: 2 }}>
                    Set to limit online registrations for this spot type (e.g. 20 rider spots, 30 fence sitting spots).
                  </p>
                )}
                {!isClinic && <ChampionshipFields form={form} setForm={setForm} classes={classes} currentClassId={null} />}
                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={submitClass}>
                    {isClinic ? "Add spot type" : "Add class"}
                  </button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                </div>
              </>
            )}

            {modal.type === "entry" && (
              <>
                <h2 className="display modal-title">{isClinic ? "Add participant" : "Add entry"}</h2>
                {(() => { const cls = classes.find((c) => c.id === modal.classId); return cls && <p style={{ marginTop: 0, color: "var(--quiet)", fontSize: 13 }}>Class {cls.num} · {cls.name}</p>; })()}
                {!isClinic && (
                  <>
                    <label className="modal-label">Back number *</label>
                    <input className="field" type="number" style={{ width: "100%", fontSize: 16 }} value={form.back ?? ""}
                      onChange={setField("back")}
                      onBlur={(e) => lookupHorse(e.target.value)}
                      placeholder="e.g. 301" autoFocus />
                    {horseSuggestion === false && <p style={{ fontSize: 12, color: "var(--quiet)", margin: "4px 0 0" }}>Not in registry — fill in manually below</p>}
                    {horseSuggestion && <p style={{ fontSize: 12, color: "var(--green)", margin: "4px 0 0" }}>Found in registry: {horseSuggestion.name}{horseSuggestion.owner ? ` · ${horseSuggestion.owner}` : ""}{registryClubs(horseSuggestion) ? ` · ${registryClubs(horseSuggestion)}` : ""}</p>}
                  </>
                )}
                <label className="modal-label">{isClinic ? "Horse name (if participating, optional)" : "Horse name *"}</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.horse ?? ""} onChange={setField("horse")} placeholder={isClinic ? "e.g. Machine Made Lady" : "e.g. Machine Made Lady"} autoFocus={isClinic} />
                <label className="modal-label">{isClinic ? "Participant name *" : "Exhibitor *"}</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.exhibitor ?? ""} onChange={setField("exhibitor")} placeholder={isClinic ? "e.g. Jane Smith" : "e.g. P. Santos"} />
                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={submitEntry}>Add entry</button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                </div>
              </>
            )}

            {modal.type === "dayEntry" && (() => {
              const eligible = classes
                .filter((c) => c.status !== "completed" && !c.hidden && !isChampionship(c))
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
              const selected = form.dayClassIds ?? [];
              const toggleDayClass = (id) => setForm((f) => {
                const cur = new Set(f.dayClassIds ?? []);
                if (cur.has(id)) cur.delete(id); else cur.add(id);
                return { ...f, dayClassIds: [...cur] };
              });
              const feeCents = currentEvent?.entry_fee_cents ?? 0;
              return (
                <>
                  <h2 className="display modal-title">Day entry — one horse, many classes</h2>
                  <p style={{ marginTop: 0, fontSize: 13, color: "var(--quiet)" }}>
                    For entries taken at the gate: fill in the horse once, tick every class they&apos;re entering, and collect payment on the Square terminal.
                  </p>
                  <label className="modal-label">Back number *</label>
                  <input className="field" type="number" min="1" style={{ width: "100%", fontSize: 16 }} value={form.back ?? ""}
                    onChange={setField("back")}
                    onBlur={(e) => {
                      // Overwrite horse/exhibitor only when the number actually
                      // changed — re-tapping the field must never clobber an
                      // exhibitor the staff already typed (lessee ≠ owner).
                      const v = e.target.value;
                      lookupHorse(v, { force: v !== form.lookedUpBack });
                      setForm((f) => ({ ...f, lookedUpBack: v }));
                    }}
                    disabled={!!form.newNumber}
                    placeholder="e.g. 301" autoFocus />
                  {!form.newNumber && horseSuggestion === false && <p style={{ fontSize: 12, color: "var(--quiet)", margin: "4px 0 0" }}>Not in registry — fill in manually below</p>}
                  {!form.newNumber && horseSuggestion && <p style={{ fontSize: 12, color: "var(--green)", margin: "4px 0 0" }}>Found in registry: {horseSuggestion.name}{horseSuggestion.owner ? ` · ${horseSuggestion.owner}` : ""}{registryClubs(horseSuggestion) ? ` · ${registryClubs(horseSuggestion)}` : ""}</p>}
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "8px 0 0", cursor: "pointer", fontSize: 13 }}>
                    <input type="checkbox" checked={!!form.newNumber} style={{ marginTop: 2 }}
                      onChange={(e) => setForm((f) => ({ ...f, newNumber: e.target.checked, back: e.target.checked ? "" : f.back }))} />
                    <span>This horse doesn&apos;t have a back number yet — assign the next available number (added to the registry permanently)</span>
                  </label>
                  <label className="modal-label">Horse name *</label>
                  <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.horse ?? ""} onChange={setField("horse")} placeholder="e.g. Machine Made Lady" />
                  <label className="modal-label">Exhibitor *</label>
                  <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.exhibitor ?? ""} onChange={setField("exhibitor")} placeholder="e.g. P. Santos" />
                  <label className="modal-label">Classes ({selected.length} ticked)</label>
                  <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, background: "#fff", padding: "6px 10px" }}>
                    {eligible.length === 0 && <p style={{ fontSize: 12.5, color: "var(--quiet)", margin: "4px 0" }}>No classes available for entry.</p>}
                    {eligible.map((c) => (
                      <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0", cursor: "pointer", fontSize: 13.5 }}>
                        <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggleDayClass(c.id)} />
                        <span>{c.num}. {c.name}{c.status === "live" ? " (live now)" : ""}</span>
                      </label>
                    ))}
                  </div>
                  {feeCents > 0 && (
                    <p style={{ fontSize: 13, fontWeight: 700, color: "var(--leather)", margin: "8px 0 0" }}>
                      Class fees to collect: ${((feeCents * selected.length) / 100).toFixed(2)}
                      <span style={{ fontWeight: 400, color: "var(--quiet)" }}> — plus any ground/admin fees and day membership, as applicable.</span>
                    </p>
                  )}
                  {formError && <p className="modal-error" style={{ whiteSpace: "pre-line" }}>{formError}</p>}
                  <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                    <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={submitDayEntry} disabled={busy}>
                      {busy ? "Adding…" : `Add to ${selected.length || "…"} class${selected.length === 1 ? "" : "es"}`}
                    </button>
                    <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                  </div>
                </>
              );
            })()}

            {modal.type === "resultSheets" && (() => {
              const cls = classes.find((c) => c.id === modal.classId);
              if (!cls) return null;
              const sheets = Array.isArray(cls.result_sheets) ? cls.result_sheets : [];
              const judgeOptions = [...new Set([cls.judge || "Judge 1", ...(cls.judge2 ? [cls.judge2] : [])])];
              return (
                <>
                  <h2 className="display modal-title">Result sheets — Class {cls.num}</h2>
                  <p style={{ marginTop: 0, fontSize: 13, color: "var(--quiet)" }}>
                    Each judge has their own paper sheet — add a photo under each judge below. It uploads as soon as you choose it, and appears as a link on the public Results page. Multiple pages per judge are fine.
                  </p>
                  {judgeOptions.map((j, ji) => {
                    const mine = sheets.map((s, i) => ({ ...s, i })).filter((s) => s.label === j);
                    return (
                      <div key={j} style={{ border: mine.length ? "1px solid var(--green)" : "1px solid var(--line)", borderRadius: 10, background: "#fff", padding: "10px 12px", marginBottom: 10 }}>
                        <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 6 }}>
                          {j}{judgeOptions.length > 1 ? ` (J${ji + 1})` : ""}
                          {mine.length > 0
                            ? <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 12, marginLeft: 8 }}>✓ {mine.length} sheet{mine.length === 1 ? "" : "s"} attached</span>
                            : <span style={{ color: "var(--clay)", fontWeight: 700, fontSize: 12, marginLeft: 8 }}>no sheet yet</span>}
                        </div>
                        {mine.map((s) => (
                          <div key={s.i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
                            <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--brass)", fontSize: 13.5, fontWeight: 700 }}>
                              📄 View sheet
                            </a>
                            <button className="btn-ghost danger" style={{ fontSize: 11, padding: "3px 9px" }} onClick={() => removeResultSheet(cls, s.i)}>Remove</button>
                          </div>
                        ))}
                        <input key={`${j}-${form.sheetFileKey ?? 0}`} className="field" type="file" accept="image/*,application/pdf" capture="environment"
                          style={{ width: "100%", fontSize: 14, marginTop: 6 }} disabled={busy}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadResultSheet(cls, j, f); }} />
                      </div>
                    );
                  })}
                  {sheets.some((s) => !judgeOptions.includes(s.label)) && (
                    <div style={{ border: "1px solid var(--line)", borderRadius: 10, background: "#fff", padding: "10px 12px", marginBottom: 10 }}>
                      <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 6 }}>Other sheets</div>
                      {sheets.map((s, i) => ({ ...s, i })).filter((s) => !judgeOptions.includes(s.label)).map((s) => (
                        <div key={s.i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
                          <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--brass)", fontSize: 13.5, fontWeight: 700 }}>
                            📄 {s.label}
                          </a>
                          <button className="btn-ghost danger" style={{ fontSize: 11, padding: "3px 9px" }} onClick={() => removeResultSheet(cls, s.i)}>Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {busy && <p style={{ fontSize: 13, color: "var(--quiet)", margin: "0 0 8px" }}>Uploading…</p>}
                  {formError && <p className="modal-error">{formError}</p>}
                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={closeModal} disabled={busy}>Done</button>
                  </div>
                </>
              );
            })()}

            {modal.type === "pattern" && (
              <>
                <h2 className="display modal-title">Set class pattern</h2>
                {(() => {
                  const cls = classes.find((c) => c.id === modal.classId);
                  return cls && (
                    <p style={{ marginTop: 0, color: "var(--quiet)", fontSize: 13 }}>
                      Class {cls.num} · {cls.name}
                    </p>
                  );
                })()}
                <label className="modal-label">Upload pattern file</label>
                <input type="file" accept="image/*,.pdf" style={{ marginBottom: 4 }}
                  onChange={(e) => setForm((f) => ({ ...f, patternFile: e.target.files?.[0] ?? null }))} />
                <p style={{ fontSize: 12, color: "var(--quiet)", marginTop: 0, marginBottom: 12 }}>
                  File upload requires the "patterns" storage bucket in Supabase (see setup notes).
                </p>
                <label className="modal-label">Choose uploaded pattern</label>
                <select className="field" style={{ width: "100%", fontSize: 15 }}
                  value={patternFiles.some((file) => file.url === form.pattern_url) ? form.pattern_url : ""}
                  onChange={(e) => setForm((f) => ({ ...f, pattern_url: e.target.value, patternFile: null }))}>
                  <option value="">{loadingPatternFiles ? "Loading uploaded patterns..." : "— Select from event uploads —"}</option>
                  {patternFiles.map((file) => (
                    <option key={file.url} value={file.url}>{file.name}</option>
                  ))}
                </select>
                <p style={{ fontSize: 12, color: "var(--quiet)", marginTop: 4, marginBottom: 12 }}>
                  Use Upload patterns on the dashboard to add all pattern files for the event first.
                </p>
                <label className="modal-label">Or paste a URL</label>
                <input className="field" style={{ width: "100%", fontSize: 15 }} value={form.pattern_url ?? ""} onChange={setField("pattern_url")} placeholder="https://…" />
                {(() => {
                  const cls = classes.find((c) => c.id === modal.classId);
                  const selectedIds = new Set([modal.classId, ...(form.applyClassIds ?? [])].filter(Boolean));
                  const currentCategoryKey = categoryKey(cls?.program_category);
                  const sameCategoryIds = currentCategoryKey
                    ? classes.filter((c) => categoryKey(c.program_category) === currentCategoryKey).map((c) => c.id)
                    : [modal.classId];
                  return (
                    <>
                      <label className="modal-label">Apply this pattern to</label>
                      <p style={{ fontSize: 12, color: "var(--quiet)", margin: "0 0 8px" }}>
                        Upload or paste once, then choose every class that uses the same pattern.
                      </p>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                        <button type="button" className="btn-ghost" style={{ padding: "6px 10px" }}
                          onClick={() => setPatternApplyClassIds(sameCategoryIds)} disabled={!currentCategoryKey}>
                          Same category
                        </button>
                        <button type="button" className="btn-ghost" style={{ padding: "6px 10px" }}
                          onClick={() => setPatternApplyClassIds(classes.map((c) => c.id))}>
                          All classes
                        </button>
                        <button type="button" className="btn-ghost" style={{ padding: "6px 10px" }}
                          onClick={() => setPatternApplyClassIds([modal.classId])}>
                          Current only
                        </button>
                        <span style={{ fontSize: 12, color: "var(--quiet)", alignSelf: "center" }}>
                          {selectedIds.size} selected
                        </span>
                      </div>
                      <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }}>
                        {classes.map((c) => {
                          const checked = selectedIds.has(c.id);
                          const isCurrent = c.id === modal.classId;
                          return (
                            <label key={c.id} style={{ display: "grid", gridTemplateColumns: "20px 1fr auto", gap: 8, alignItems: "center", padding: "9px 10px", borderBottom: "1px solid var(--line)", cursor: isCurrent ? "default" : "pointer" }}>
                              <input type="checkbox" checked={checked || isCurrent} disabled={isCurrent}
                                onChange={() => togglePatternApplyClass(c.id)}
                                style={{ width: 16, height: 16 }} />
                              <span style={{ minWidth: 0 }}>
                                <span className="display" style={{ display: "block", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  Class {c.num} · {c.name}
                                </span>
                                <span style={{ display: "block", fontSize: 11.5, color: "var(--quiet)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {c.program_category || "No category"}
                                </span>
                              </span>
                              <span style={{ display: "inline-flex", gap: 6, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
                                {isCurrent && <span style={{ fontSize: 10.5, color: "var(--brass)", fontWeight: 800, textTransform: "uppercase" }}>Current</span>}
                                {c.pattern_url && (
                                  <span style={{ fontSize: 10.5, color: "var(--green)", fontWeight: 800, textTransform: "uppercase" }}>
                                    Has pattern
                                  </span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={submitPattern}>Save pattern</button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                </div>
              </>
            )}

            {modal.type === "bulkPatterns" && (
              <>
                <h2 className="display modal-title">Manage patterns PDF</h2>
                <p style={{ fontSize: 13, color: "var(--quiet)", marginTop: 0 }}>
                  Upload class pattern files here, then choose one PDF to be the public rider-facing Patterns PDF. Leave it blank to use the generated class pattern book.
                </p>
                <label className="modal-label">Pattern files</label>
                <input type="file" accept="image/*,.pdf" multiple style={{ marginBottom: 8 }}
                  onChange={(e) => setForm((f) => ({ ...f, patternFiles: Array.from(e.target.files ?? []), patternUploadMessage: "" }))} />
                <p style={{ fontSize: 12, color: "var(--quiet)", marginTop: 0 }}>
                  Files are stored in the public Supabase Storage bucket named "patterns".
                </p>
                {form.patternUploadMessage && (
                  <p style={{ color: "var(--green)", fontSize: 13, fontWeight: 700, margin: "8px 0 0" }}>
                    {form.patternUploadMessage}
                  </p>
                )}
                <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }}
                    onClick={submitBulkPatterns} disabled={uploadingPatternFiles}>
                    {uploadingPatternFiles ? "Uploading..." : "Upload selected files"}
                  </button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Done</button>
                </div>

                <label className="modal-label">Rider-facing Patterns PDF</label>
                <select className="field" style={{ width: "100%", fontSize: 15 }}
                  value={uploadedPdfFiles.some((file) => file.url === form.patterns_pdf_url) ? form.patterns_pdf_url : ""}
                  onChange={(e) => setForm((f) => ({ ...f, patterns_pdf_url: e.target.value, patternsPdfMessage: "" }))}>
                  <option value="">{loadingPatternFiles ? "Loading PDFs..." : "— Generated from class patterns —"}</option>
                  {uploadedPdfFiles.map((file) => (
                    <option key={file.url} value={file.url}>{file.name}</option>
                  ))}
                </select>
                <label className="modal-label">Or paste PDF URL</label>
                <input className="field" style={{ width: "100%", fontSize: 15 }} value={form.patterns_pdf_url ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, patterns_pdf_url: e.target.value, patternsPdfMessage: "" }))}
                  placeholder="https://..." />
                <p style={{ fontSize: 12, color: "var(--quiet)", margin: "4px 0 0" }}>
                  The public Patterns PDF link will send riders this PDF. Clear the field and save to go back to the generated class-pattern PDF.
                </p>
                {form.patternsPdfMessage && (
                  <p style={{ color: "var(--green)", fontSize: 13, fontWeight: 700, margin: "8px 0 0" }}>
                    {form.patternsPdfMessage}
                  </p>
                )}
                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={submitPatternsPdf}>
                    Save rider PDF
                  </button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }}
                    onClick={() => setForm((f) => ({ ...f, patterns_pdf_url: "", patternsPdfMessage: "" }))}>
                    Use generated
                  </button>
                </div>

                <label className="modal-label">Already uploaded</label>
                <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }}>
                  {loadingPatternFiles ? (
                    <div style={{ padding: 12, fontSize: 13, color: "var(--quiet)" }}>Loading patterns...</div>
                  ) : patternFiles.length ? (
                    patternFiles.map((file) => {
                      const pdf = isPdfFile(file.name) || isPdfFile(file.url);
                      const isRiderPdf = currentEvent?.patterns_pdf_url === file.url;
                      return (
                        <div key={file.url}
                          style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", padding: "9px 10px", borderBottom: "1px solid var(--line)" }}>
                          <a href={file.url} target="_blank" rel="noreferrer"
                            style={{ color: "var(--leather)", fontSize: 13, fontWeight: 700, textDecoration: "none", overflowWrap: "anywhere", minWidth: 0 }}>
                            {file.name}
                          </a>
                          <span style={{ display: "inline-flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                            {isRiderPdf && <span style={{ fontSize: 10.5, color: "var(--green)", fontWeight: 800, textTransform: "uppercase" }}>Rider PDF</span>}
                            {pdf && (
                              <button type="button" className="btn-ghost" style={{ padding: "5px 8px" }}
                                onClick={() => setForm((f) => ({ ...f, patterns_pdf_url: file.url, patternsPdfMessage: "" }))}>
                                Select
                              </button>
                            )}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ padding: 12, fontSize: 13, color: "var(--quiet)" }}>
                      No pattern files have been uploaded for this event yet.
                    </div>
                  )}
                </div>
              </>
            )}

            {modal.type === "importClasses" && (
              <ImportClasses
                eventId={eventId}
                onDone={() => { closeModal(); loadClasses(); }}
              />
            )}

            {modal.type === "import" && (
              <ImportEntries
                eventId={eventId}
                classes={classes}
                onDone={() => { closeModal(); loadClasses(); }}
              />
            )}

            {modal.type === "editEntry" && (() => {
              const entryClass = classes.find((c) => c.entries.some((e) => e.id === modal.entry?.id));
              const eMode = entryClass?.scoring_mode ?? "score";
              const twoJ = !!entryClass?.judge2;
              const j1 = entryClass?.judge || "Judge 1";
              const j2 = entryClass?.judge2 || "Judge 2";
              const isPlacing = eMode === "placing" || eMode === "class_only";
              const scoreLabel = isPlacing ? "Placing" : "Score";
              const scorePlaceholder = isPlacing ? null : "e.g. 72.5";
              const ScoreInput = ({ field, label }) => isPlacing ? (
                <select className="field" style={{ width: "100%", fontSize: 16 }} value={form[field] ?? ""} onChange={setField(field)}>
                  <option value="">— Not placed —</option>
                  {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{ordinal(n)}</option>
                  ))}
                </select>
              ) : (
                <input className="field" type="number" step="0.5" style={{ width: "100%", fontSize: 16 }}
                  value={form[field] ?? ""} onChange={setField(field)} placeholder={scorePlaceholder} />
              );
              return (
                <>
                  <h2 className="display modal-title">{isClinic ? "Edit participant" : "Edit entry"}</h2>
                  {!isClinic && (
                    <>
                      <label className="modal-label">Back number *</label>
                      <input className="field" type="number" style={{ width: "100%", fontSize: 16 }} value={form.back ?? ""}
                        onChange={setField("back")}
                        onBlur={(e) => lookupHorse(e.target.value, { force: e.target.value !== (form.origBack ?? "") })}
                        autoFocus />
                      {horseSuggestion === false && <p style={{ fontSize: 12, color: "var(--quiet)", margin: "4px 0 0" }}>Not in registry — fill in manually below</p>}
                      {horseSuggestion && <p style={{ fontSize: 12, color: "var(--green)", margin: "4px 0 0" }}>Registry: {horseSuggestion.name}{horseSuggestion.owner ? ` · ${horseSuggestion.owner}` : ""}{registryClubs(horseSuggestion) ? ` · ${registryClubs(horseSuggestion)}` : ""}</p>}
                    </>
                  )}
                  <label className="modal-label">{isClinic ? "Horse name (optional)" : "Horse name *"}</label>
                  <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.horse ?? ""} onChange={setField("horse")} autoFocus={isClinic} />
                  <label className="modal-label">{isClinic ? "Participant name *" : "Exhibitor *"}</label>
                  <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.exhibitor ?? ""} onChange={setField("exhibitor")} />
                  {twoJ ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div>
                        <label className="modal-label">{scoreLabel} — {j1} (blank = not yet set)</label>
                        <ScoreInput field="score" />
                      </div>
                      <div>
                        <label className="modal-label">{scoreLabel} — {j2} (blank = not yet set)</label>
                        <ScoreInput field="score2" />
                      </div>
                    </div>
                  ) : (
                    <>
                      <label className="modal-label">{scoreLabel} (leave blank if not yet set)</label>
                      <ScoreInput field="score" />
                    </>
                  )}
                  {formError && <p className="modal-error">{formError}</p>}
                  <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                    <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={submitEditEntry}>Save changes</button>
                    <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                  </div>
                </>
              );
            })()}

            {modal.type === "editClass" && (
              <>
                <h2 className="display modal-title">Edit class</h2>
                <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 10 }}>
                  <div>
                    <label className="modal-label">Class # *</label>
                    <input className="field" type="number" style={{ width: "100%", fontSize: 16 }} value={form.num ?? ""} onChange={setField("num")} autoFocus />
                  </div>
                  <div>
                    <label className="modal-label">Class name *</label>
                    <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.name ?? ""} onChange={setField("name")} />
                  </div>
                </div>
                <label className="modal-label">Judge 1</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.judge ?? ""} onChange={setField("judge")} />
                <label className="modal-label">Judge 2 (leave blank for single-judge class)</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.judge2 ?? ""} onChange={setField("judge2")} placeholder="e.g. L. Smith" />
                <label className="modal-label">Program category</label>
                <input className="field" list="program-categories" style={{ width: "100%", fontSize: 16 }} value={form.program_category ?? ""} onChange={setField("program_category")} placeholder="e.g. Trail" />
                <label className="modal-label">Program break before this class</label>
                <input className="field" list="program-breaks" style={{ width: "100%", fontSize: 16 }} value={form.program_break_before ?? ""} onChange={setField("program_break_before")} placeholder="e.g. SET UP TRAIL" />
                <label className="modal-label">Program break after this class</label>
                <input className="field" list="program-breaks" style={{ width: "100%", fontSize: 16 }} value={form.program_break_after ?? ""} onChange={setField("program_break_after")} placeholder="e.g. FINISH" />
                {modal.cls?.day !== undefined && (
                  <>
                    <label className="modal-label">Show day</label>
                    <input className="field" type="number" min="1" max="10" style={{ width: 80, fontSize: 16 }} value={form.day ?? "1"} onChange={setField("day")} />
                  </>
                )}
                {!isClinic && (
                  <>
                    <label className="modal-label">Scoring mode</label>
                    <select className="field" style={{ width: "100%", fontSize: 15 }} value={form.scoring_mode ?? "score"} onChange={setField("scoring_mode")}>
                      <option value="score">Score — 70pt scale, one horse at a time</option>
                      <option value="placing">Placing — 1st/2nd/3rd, one horse at a time</option>
                      <option value="class_only">Class only — everyone together, no live draw</option>
                      <option value="tbc">TBC (draw) — horses one at a time, results from judge's paperwork</option>
                      <option value="tbc_class">TBC (whole class) — everyone together, results from judge's paperwork</option>
                    </select>
                    <label className="modal-label">High Points category</label>
                    <select className="field" style={{ width: "100%", fontSize: 15 }} value={form.hp_category ?? ""} onChange={setField("hp_category")}>
                      <option value="">— Does not count toward High Points —</option>
                      {HP_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </>
                )}
                <label className="modal-label">Spot capacity (leave blank for unlimited)</label>
                <input className="field" type="number" min="1" style={{ width: 120, fontSize: 16 }}
                  value={form.capacity ?? ""} onChange={setField("capacity")} placeholder="e.g. 20" />
                {!isClinic && <ChampionshipFields form={form} setForm={setForm} classes={classes} currentClassId={modal.cls?.id ?? null} />}
                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={submitEditClass}>Save changes</button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                </div>
              </>
            )}

            {modal.type === "cancelEvent" && (
              <>
                <h2 className="display modal-title" style={{ color: "#B03030" }}>Cancel event</h2>
                <p style={{ fontSize: 14, color: "var(--quiet)", marginTop: 0 }}>
                  The event will be hidden from the public home page and marked as cancelled. You can reopen it afterwards if needed.
                </p>
                <label className="modal-label">Reason for cancellation (optional)</label>
                <textarea className="field" rows={3} style={{ width: "100%", fontSize: 15, resize: "vertical" }}
                  value={form.reason ?? ""} onChange={setField("reason")}
                  placeholder="e.g. Venue unavailable due to flooding" autoFocus />
                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "#B03030", color: "#fff" }} onClick={submitCancelEvent}>
                    Confirm cancellation
                  </button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Go back</button>
                </div>
              </>
            )}

            {modal.type === "closeEntries" && (() => {
              const emptyClasses = classes.filter((c) => c.entries.length === 0);
              return (
                <>
                  <h2 className="display modal-title">Close entries</h2>
                  <p style={{ fontSize: 14, color: "var(--quiet)", marginTop: 0 }}>
                    Exhibitors will no longer be able to register online. You can reopen entries later if needed.
                  </p>
                  {emptyClasses.length > 0 ? (
                    <>
                      <p style={{ fontSize: 13.5, color: "var(--leather)", fontWeight: 700, margin: "6px 0 2px" }}>
                        {emptyClasses.length} {emptyClasses.length === 1 ? "class has" : "classes have"} no entries — what should happen to {emptyClasses.length === 1 ? "it" : "them"}?
                      </p>
                      <p style={{ fontSize: 12.5, color: "var(--quiet)", margin: "0 0 8px" }}>
                        {emptyClasses.slice(0, 6).map((c) => `Class ${c.num} · ${c.name}`).join(", ")}{emptyClasses.length > 6 ? `, and ${emptyClasses.length - 6} more` : ""}
                      </p>
                      {[
                        { val: "hide", title: "Hide them (recommended)", desc: "Removed from the public schedule and program but kept — reactivate any one in a click if someone enters it on the day." },
                        { val: "delete", title: "Delete them permanently", desc: "Removes the classes for good. You'd have to re-add one if it's needed later. This cannot be undone." },
                        { val: "leave", title: "Leave them as they are", desc: "Keep the empty classes visible on the schedule." },
                      ].map((opt) => (
                        <label key={opt.val} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", cursor: "pointer" }}>
                          <input type="radio" name="emptyAction" checked={(form.emptyAction ?? "hide") === opt.val} style={{ marginTop: 3 }}
                            onChange={() => setForm((f) => ({ ...f, emptyAction: opt.val }))} />
                          <span>
                            <strong>{opt.title}</strong>
                            <span style={{ display: "block", fontSize: 12.5, color: "var(--quiet)", marginTop: 2 }}>{opt.desc}</span>
                          </span>
                        </label>
                      ))}
                      {(form.emptyAction ?? "hide") === "delete" && (
                        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "4px 0 10px 30px", cursor: "pointer" }}>
                          <input type="checkbox" checked={!!form.renumber} style={{ marginTop: 3 }}
                            onChange={(e) => setForm((f) => ({ ...f, renumber: e.target.checked }))} />
                          <span>
                            <strong>Renumber the remaining classes</strong>
                            <span style={{ display: "block", fontSize: 12.5, color: "var(--quiet)", marginTop: 2 }}>
                              Re-sequence class numbers 1, 2, 3… in running order so there are no gaps. This changes the numbers shown on the schedule and printed program.
                            </span>
                          </span>
                        </label>
                      )}
                    </>
                  ) : (
                    <p style={{ fontSize: 13.5, color: "var(--quiet)" }}>Every class has at least one entry.</p>
                  )}
                  {formError && <p className="modal-error">{formError}</p>}
                  <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                    <button className="btn" style={{ flex: 1, background: "var(--leather)", color: "#fff" }} onClick={submitCloseEntries} disabled={busy}>
                      {busy ? "Closing…" : "Close entries"}
                    </button>
                    <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                  </div>
                </>
              );
            })()}

          </div>
        </div>
      )}
    </>
  );
}
