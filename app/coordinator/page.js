"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
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

// Points scale: max(0, competing_entries - placing).
// With 5 entries: 1st=4pts, 2nd=3pts, 3rd=2pts, 4th=1pt, 5th=0pts.
// Verify this against the current HCQHA rule book before use.
function calcPoints(placing, competingEntries) {
  if (competingEntries < 2) return 0;
  return Math.max(0, competingEntries - placing);
}

const fmtBack = (n) => String(n).padStart(3, "0");
const ordinal = (n) => { const s = ["th","st","nd","rd"]; const v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); };

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
  const [scoreInput2, setScoreInput2] = useState("");
  const [busy, setBusy] = useState(false);

  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [formError, setFormError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [horseSuggestion, setHorseSuggestion] = useState(null);

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
  const current = liveClass ? firstPending(liveClass.entries, liveClass.scoring_mode) : null;
  const currentEvent = events.find((e) => e.id === eventId);
  const isClinic = currentEvent?.event_type === "clinic";

  // Clear score inputs whenever the live class changes (auto-advance after last entry)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setScoreInput(""); setScoreInput2(""); }, [liveClass?.id]);

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
      await supabase.from("entries").update(updateData).eq("id", current.id);
      const remaining = liveClass.entries.filter((e) => e.id !== current.id && e.score == null && !e.scratched);
      if (remaining.length === 0) {
        await completeClass(liveClass);
      } else {
        const next = remaining[0];
        triggerPush(`Now showing: #${fmtBack(next.back_number)} ${next.horse}`, `Class ${liveClass.num} · ${liveClass.name}`, "now-showing");
      }
      setScoreInput("");
      setScoreInput2("");
    } finally {
      setBusy(false);
    }
  };

  const callNext = async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await supabase.from("entries").update({ called: true }).eq("id", current.id);
      const remaining = liveClass.entries.filter((e) => e.id !== current.id && !e.called && !e.scratched);
      if (remaining.length === 0) {
        await completeClass(liveClass);
      } else {
        triggerPush(`Now showing: #${fmtBack(remaining[0].back_number)} ${remaining[0].horse}`, `Class ${liveClass.num} · ${liveClass.name}`, "now-showing");
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleScratch = async (entry) => {
    await supabase.from("entries").update({ scratched: !entry.scratched }).eq("id", entry.id);
    if (!entry.scratched) {
      triggerPush(`Scratch: #${entry.back_number} ${entry.horse}`, "This entry has been scratched.", "scratch");
      if (liveClass) {
        const liveMode = liveClass.scoring_mode ?? "score";
        const remaining = liveMode === "tbc"
          ? liveClass.entries.filter((e) => e.id !== entry.id && !e.called && !e.scratched)
          : liveClass.entries.filter((e) => e.id !== entry.id && e.score == null && !e.scratched);
        if (remaining.length === 0) await completeClass(liveClass);
      }
    }
  };

  const movePending = async (cls, entry, dir) => {
    const clsMode = cls.scoring_mode ?? "score";
    const pending = clsMode === "tbc"
      ? cls.entries.filter((e) => !e.called && !e.scratched)
      : cls.entries.filter((e) => e.score == null && !e.scratched);
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
    const next = firstPending(cls.entries, cls.scoring_mode);
    if (next) triggerPush(`Now showing: #${fmtBack(next.back_number)} ${next.horse}`, `Class ${cls.num} · ${cls.name}`, "now-showing");
  };

  const completeClass = async (cls) => {
    await supabase.from("classes").update({ status: "completed" }).eq("id", cls.id);
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
    const nextUp = classes.find((c) => c.status === "upcoming" && c.id !== cls.id);
    if (nextUp) {
      await supabase.from("classes").update({ status: "live" }).eq("id", nextUp.id);
      const nextEntry = firstPending(nextUp.entries, nextUp.scoring_mode);
      if (nextEntry) triggerPush(`Now showing: #${fmtBack(nextEntry.back_number)} ${nextEntry.horse}`, `Class ${nextUp.num} · ${nextUp.name}`, "now-showing");
    }
  };

  const pushToHighPoints = async (cls) => {
    if (!cls.hp_category || !currentEvent?.starts_on) return;

    // Fetch fresh entries — when called from saveScore the last score isn't in
    // React state yet (realtime hasn't fired back), so we go straight to the DB.
    const { data: fresh } = await supabase.from("entries").select("*").eq("class_id", cls.id);
    const entries = (fresh ?? []).filter((e) => e.score != null && !e.scratched);
    if (!entries.length) return;

    const [y, mo] = currentEvent.starts_on.split("-").map(Number);
    const season = mo >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
    const showName = currentEvent.name;
    const isHorseCat = HP_HORSE_CATS.has(cls.hp_category);
    const isPlacing = ["placing", "class_only", "tbc_class"].includes(cls.scoring_mode);

    // Accumulate points across both judges into one total per entity.
    const pointsMap = {};
    const applyJudge = (sorted, getScore) => {
      sorted.forEach((e, i) => {
        const placing = isPlacing ? Math.round(getScore(e)) : i + 1;
        const pts = placing === 1 ? 3 : placing === 2 ? 2 : placing === 3 ? 1 : 0;
        if (!pts) return;
        const name = isHorseCat ? e.horse : e.exhibitor;
        pointsMap[name] = (pointsMap[name] ?? 0) + pts;
      });
    };

    applyJudge(
      [...entries].sort((a, b) => isPlacing ? a.score - b.score : b.score - a.score),
      (e) => e.score
    );
    if (cls.judge2) {
      const j2 = entries.filter((e) => e.score2 != null);
      applyJudge(
        [...j2].sort((a, b) => isPlacing ? a.score2 - b.score2 : b.score2 - a.score2),
        (e) => e.score2
      );
    }

    const toUpsert = Object.entries(pointsMap).map(([name, pts]) => ({
      season, category: cls.hp_category,
      entity_type: isHorseCat ? "horse" : "rider",
      entity_name: name, show_name: showName, points: pts,
    }));
    if (!toUpsert.length) return;
    await supabase.from("high_points").upsert(toUpsert, { onConflict: "season,category,entity_name,show_name" });
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

  const setEventStatus = async (newStatus) => {
    await supabase.from("events").update({ status: newStatus }).eq("id", eventId);
    await loadEvents();
  };

  const endEvent = async () => {
    if (!window.confirm("Mark this event as completed? This cannot be undone.")) return;
    await setEventStatus("completed");
  };

  const cancelEvent = () => {
    openModal("cancelEvent");
  };

  const submitCancelEvent = async () => {
    await supabase.from("events").update({ status: "cancelled", cancellation_reason: form.reason?.trim() || null }).eq("id", eventId);
    await loadEvents();
    closeModal();
  };

  const closeEntries = async () => {
    const emptyClasses = classes.filter((c) => c.entries.length === 0);
    const emptyNote = emptyClasses.length > 0
      ? `\n\n${emptyClasses.length} class${emptyClasses.length !== 1 ? "es" : ""} with no entries will be removed:\n${emptyClasses.slice(0, 8).map((c) => `  · Class ${c.num} · ${c.name}`).join("\n")}${emptyClasses.length > 8 ? `\n  · …and ${emptyClasses.length - 8} more` : ""}`
      : "";
    if (!window.confirm(`Close entries for this event?${emptyNote}\n\nExhibitors will no longer be able to register online. You can reopen entries if needed.`)) return;
    if (emptyClasses.length > 0) {
      await supabase.from("classes").delete().in("id", emptyClasses.map((c) => c.id));
    }
    await setEventStatus("closed");
    await loadClasses();
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
      initialForm = { pattern_url: cls?.pattern_url ?? "" };
    }
    if (type === "editEntry" && extra.entry) {
      const e = extra.entry;
      initialForm = {
        back: String(e.back_number), horse: e.horse, exhibitor: e.exhibitor,
        score: e.score != null ? String(e.score) : "",
        score2: e.score2 != null ? String(e.score2) : "",
      };
    }
    if (type === "editClass" && extra.cls) {
      const c = extra.cls;
      initialForm = { num: String(c.num), name: c.name, judge: c.judge ?? "", judge2: c.judge2 ?? "", day: String(c.day ?? 1), scoring_mode: c.scoring_mode ?? "score", capacity: c.capacity != null ? String(c.capacity) : "", hp_category: c.hp_category ?? "" };
    }
    setModal({ type, ...extra });
    setForm(initialForm);
    setFormError("");
    setHorseSuggestion(null);
  };
  const closeModal = () => { setModal(null); setForm({}); setFormError(""); setHorseSuggestion(null); };
  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const lookupHorse = async (backNum) => {
    if (!backNum) { setHorseSuggestion(null); return; }
    try {
      const { data } = await supabase.from("horses").select("name, owner").eq("back_number", parseInt(backNum, 10)).maybeSingle();
      setHorseSuggestion(data ?? false);
      if (data) setForm((f) => ({ ...f, horse: f.horse || data.name, exhibitor: f.exhibitor || (data.owner ?? "") }));
    } catch { setHorseSuggestion(null); }
  };

  const submitEvent = async () => {
    if (!form.name?.trim()) { setFormError("Event name is required"); return; }
    const feeCents = form.fee ? Math.round(parseFloat(form.fee) * 100) : 0;
    const { data, error } = await supabase.from("events")
      .insert({ name: form.name.trim(), location: form.location ?? "", starts_on: form.starts || null, ends_on: form.ends || form.starts || null, status: form.status ?? "pre_open", entry_fee_cents: feeCents, event_type: form.event_type ?? "show" })
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
      judge2: form.judge2?.trim() || null,
      pattern_url: form.pattern_url?.trim() || null,
      sort_order: maxOrder + 1,
      day: parseInt(form.day ?? "1", 10) || 1,
      scoring_mode: form.scoring_mode ?? "score",
      capacity: form.capacity ? parseInt(form.capacity, 10) : null,
      hp_category: form.hp_category || null,
    });
    if (error) {
      const msg = error.message?.includes("day") ? 'Database migration needed. Please run "schema-v2-horses.sql" in your Supabase SQL Editor first.' : error.message;
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
    await supabase.from("entries").insert({
      class_id: cls.id,
      back_number: isClinic ? maxDraw + 1 : parseInt(form.back, 10),
      horse: form.horse?.trim() || "",
      exhibitor: form.exhibitor.trim(),
      draw_order: maxDraw + 1,
    });
    closeModal();
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
  };

  const submitEditClass = async () => {
    if (!form.num || !form.name?.trim()) { setFormError("Class number and name are required"); return; }
    const updateData = { num: parseInt(form.num, 10), name: form.name.trim(), judge: form.judge ?? "", judge2: form.judge2?.trim() || null, scoring_mode: form.scoring_mode ?? "score", capacity: form.capacity ? parseInt(form.capacity, 10) : null, hp_category: form.hp_category || null };
    if (modal.cls.day !== undefined) updateData.day = parseInt(form.day ?? "1", 10) || 1;
    const { error } = await supabase.from("classes").update(updateData).eq("id", modal.cls.id);
    if (error) { setFormError(error.message); return; }
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
        const ce = (entries ?? []).filter((e) => e.class_id === cls.id);
        const competing = ce.filter((e) => !e.scratched).length;
        const mode = cls.scoring_mode ?? "score";
        const isPlacing = mode === "placing" || mode === "class_only" || mode === "tbc_class";
        const scored = ce.filter((e) => e.score != null && !e.scratched);

        if (cls.judge2) {
          // Two judges — each judge's results generate independent point rows
          const j1Sorted = [...scored].sort((a, b) => isPlacing ? a.score - b.score : b.score - a.score);
          pushPtRows(cls.num, cls.name, cls.judge || "Judge 1", j1Sorted,
            (e) => isPlacing ? e.score : j1Sorted.findIndex((x) => x.id === e.id) + 1,
            (e) => e.score, competing);

          const j2Scored = scored.filter((e) => e.score2 != null);
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/coordinator/registrations" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", border: "1px solid var(--line)", background: "#fff", color: "var(--leather)", borderRadius: 10, padding: "8px 14px", fontSize: 14, fontWeight: 700 }}>
              Registrations
            </Link>
            <button className="btn-ghost" onClick={() => openModal("importClasses")} disabled={!eventId}>⇪ Import classes</button>
            <button className="btn-ghost" onClick={() => openModal("import")} disabled={!eventId}>⇪ Import entries</button>
            <button className="btn-ghost" onClick={exportResults} disabled={exporting || !eventId}>{exporting ? "Exporting…" : "⇩ Export results"}</button>
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
                        onClick={() => { if (window.confirm("Revert to closed? The event will go back to the 'Entries closed' state. Any scoring in progress will not be affected.")) setEventStatus("closed"); }}
                        disabled={busy}>
                        ← Back to closed
                      </button>
                      <button className="btn-ghost danger" onClick={endEvent}>End event</button>
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

        {classes.map((cls) => {
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
            <section key={cls.id} className="card" style={isLive ? { borderColor: "var(--brass)" } : {}}>
              <div className="card-head" style={{ flexWrap: "nowrap", ...(isLive ? { background: "#FBF4E4" } : {}) }}>
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
                  {cls.capacity != null && (
                    <div style={{ fontSize: 12, marginTop: 2 }}>
                      <span style={{ background: isFull ? "var(--clay)" : confirmedSpots >= cls.capacity * 0.8 ? "#A05000" : "var(--green)", color: "#fff", borderRadius: 8, padding: "1px 8px", fontWeight: 700 }}>
                        {confirmedSpots} / {cls.capacity} spots
                      </span>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {cls.status === "upcoming" && !isClinic && (
                    <>
                      <button className="btn-ghost" onClick={() => moveClass(cls, -1)} aria-label="Move earlier">▲</button>
                      <button className="btn-ghost" onClick={() => moveClass(cls, 1)} aria-label="Move later">▼</button>
                      <button className="btn-ghost" style={{ borderColor: "var(--green)", color: "var(--green)" }} onClick={() => startClass(cls)}>Start</button>
                    </>
                  )}
                  {isLive && !isClinic && <button className="btn-ghost" onClick={() => completeClass(cls)}>Complete</button>}
                  {cls.status === "completed" && cls.hp_category && !isClinic && (
                    <button className="btn-ghost" style={{ fontSize: 11, borderColor: "var(--green)", color: "var(--green)" }}
                      onClick={() => pushToHighPoints(cls)} title="Push results to the High Points leaderboard">
                      Push HP
                    </button>
                  )}
                  {!isClinic && (
                    <button className="btn-ghost" style={cls.pattern_url ? { borderColor: "var(--brass)", color: "var(--brass)" } : {}} onClick={() => openModal("pattern", { classId: cls.id })}>
                      {cls.pattern_url ? "✓ Pattern" : "Pattern"}
                    </button>
                  )}
                  <button className="btn-ghost" onClick={() => openModal("editClass", { cls })}>Edit</button>
                  <button className="btn-ghost" onClick={() => openModal("entry", { classId: cls.id })}>
                    {isClinic ? "+ Participant" : "+ Entry"}
                  </button>
                  {cls.status === "upcoming" && (
                    <button className="btn-ghost danger" onClick={() => deleteClass(cls)}>Delete</button>
                  )}
                  <span className={`badge ${cls.status}`}>{cls.status}</span>
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
        })}

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
                <label className="modal-label">Judge 1</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.judge ?? ""} onChange={setField("judge")} placeholder="e.g. K. Maddox" />
                <label className="modal-label">Judge 2 (leave blank for single-judge class)</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }} value={form.judge2 ?? ""} onChange={setField("judge2")} placeholder="e.g. L. Smith" />
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
                    {horseSuggestion && <p style={{ fontSize: 12, color: "var(--green)", margin: "4px 0 0" }}>Found in registry: {horseSuggestion.name}{horseSuggestion.owner ? ` · ${horseSuggestion.owner}` : ""}</p>}
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
                      <input className="field" type="number" style={{ width: "100%", fontSize: 16 }} value={form.back ?? ""} onChange={setField("back")} autoFocus />
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
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "#B03030", color: "#fff" }} onClick={submitCancelEvent}>
                    Confirm cancellation
                  </button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Go back</button>
                </div>
              </>
            )}

          </div>
        </div>
      )}
    </>
  );
}
