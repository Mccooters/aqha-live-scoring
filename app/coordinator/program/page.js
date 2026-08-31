"use client";
import { Suspense, useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import ReadOnlyBanner from "../../components/ReadOnlyBanner";
import { categoryKey, normaliseCategoryLabel } from "../../../lib/classCategories";

// Program builder: the whole running order on one screen, so staff can lay
// out the printed program — section headings, breaks, class order — without
// opening every class's Edit modal. Headings and breaks are stored on the
// classes themselves (program_category / program_break_before / _after), so
// everything here is just a friendlier way to edit those fields in bulk, and
// the printable program and public pages pick changes up instantly.

const BREAK_SUGGESTIONS = ["LUNCH", "MORNING TEA", "BREAK FOR GEAR CHANGE", "SET UP TRAIL", "PRESENTATIONS", "FINISH"];

function ProgramBuilder() {
  const searchParams = useSearchParams();
  const [session, setSession] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState(searchParams.get("event") ?? "");
  const [classes, setClasses] = useState([]);
  const [day, setDay] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One thing being added or edited at a time:
  //   { mode: "add", classId, field, kind: "heading"|"break", canBreak, canHeading }
  //   { mode: "editHeading", ids }   { mode: "editBreak", classId, field }
  const [editor, setEditor] = useState(null);
  const [editorValue, setEditorValue] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    supabase
      .from("events")
      .select("id, name, starts_on, status, event_type")
      .neq("event_type", "clinic")
      .order("starts_on", { ascending: false })
      .then(({ data }) => {
        const list = data ?? [];
        setEvents(list);
        setEventId((cur) => (cur && list.some((e) => e.id === cur) ? cur : (list.find((e) => e.status !== "archived")?.id ?? list[0]?.id ?? "")));
      });
  }, [session]);

  const load = useCallback(async () => {
    if (!session || !eventId) return;
    const { data } = await supabase
      .from("classes")
      .select("id, num, name, day, sort_order, hidden, program_category, program_break_before, program_break_after")
      .eq("event_id", eventId)
      .order("sort_order");
    setClasses(data ?? []);
    setLoading(false);
  }, [session, eventId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  useEffect(() => {
    if (!session || !eventId) return;
    const channel = supabase
      .channel("program-builder")
      .on("postgres_changes", { event: "*", schema: "public", table: "classes" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, eventId, load]);

  const orderedAll = useMemo(
    () => [...classes].sort((a, b) => (a.day ?? 1) - (b.day ?? 1) || (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [classes]
  );
  const days = useMemo(() => {
    const values = [...new Set(classes.map((c) => c.day ?? 1))].sort((a, b) => a - b);
    return values.length ? values : [1];
  }, [classes]);
  useEffect(() => { if (!days.includes(day)) setDay(days[0]); }, [days, day]);

  // Hidden classes stay in the list (greyed out) — any break attached to one
  // is still part of the day, and staff should see where everything sits.
  const dayClasses = useMemo(() => orderedAll.filter((c) => (c.day ?? 1) === day), [orderedAll, day]);

  const categorySuggestions = useMemo(
    () => [...new Set(classes.map((c) => normaliseCategoryLabel(c.program_category)).filter(Boolean))],
    [classes]
  );

  // The contiguous run of classes sharing class `start`'s current category —
  // the "section" that a heading added or edited here applies to.
  const groupFrom = (start) => {
    const key = categoryKey(start.program_category);
    const startIdx = dayClasses.findIndex((c) => c.id === start.id);
    const ids = [];
    for (let i = startIdx; i < dayClasses.length; i++) {
      if (categoryKey(dayClasses[i].program_category) !== key) break;
      ids.push(dayClasses[i].id);
    }
    return ids;
  };

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      setEditor(null);
      setEditorValue("");
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  const updateMany = async (ids, data) => {
    const { error: e } = await supabase.from("classes").update(data).in("id", ids);
    if (e) throw e;
  };

  const submitEditor = () => {
    const label = editorValue.trim();
    if (!editor) return;
    if (editor.mode === "add") {
      if (!label) { setError(`Type what the ${editor.kind === "heading" ? "heading" : "break"} should say first.`); return; }
      if (editor.kind === "break") {
        return run(() => updateMany([editor.classId], { [editor.field]: label }));
      }
      // Heading: applies from this class down to where the section already
      // changes — so adding one mid-section splits that section in two.
      const start = dayClasses.find((c) => c.id === editor.classId);
      return run(() => updateMany(groupFrom(start), { program_category: label }));
    }
    if (editor.mode === "editHeading") {
      if (!label) { setError("A heading needs a name — use its remove button to take it out instead."); return; }
      return run(() => updateMany(editor.ids, { program_category: label }));
    }
    if (editor.mode === "editBreak") {
      return run(() => updateMany([editor.classId], { [editor.field]: label || null }));
    }
  };

  const removeHeading = (ids, prevLabel) => {
    const into = prevLabel ? `join the "${prevLabel}" section above` : "have no section heading";
    if (!window.confirm(`Remove this heading?\n\nThe ${ids.length} class${ids.length === 1 ? "" : "es"} under it will ${into}. No classes are deleted.`)) return;
    run(() => updateMany(ids, { program_category: prevLabel || null }));
  };

  const removeBreak = (classId, field) => run(() => updateMany([classId], { [field]: null }));

  const moveClass = (cls, dir) => {
    const i = dayClasses.findIndex((c) => c.id === cls.id);
    const j = i + dir;
    if (j < 0 || j >= dayClasses.length) return;
    run(async () => {
      // Swap the two classes but leave the LAYOUT where it was: headings and
      // breaks live on class rows, so without this a class moved past "LUNCH"
      // would drag lunch along with it, and one moved across a section
      // boundary would drag its old heading into the new section.
      const layout = (c) => ({
        program_category: c.program_category ?? null,
        program_break_before: c.program_break_before ?? null,
        program_break_after: c.program_break_after ?? null,
      });
      const a = dayClasses[i], b = dayClasses[j];
      const swapped = [...dayClasses];
      swapped[i] = { ...b, ...layout(a) };
      swapped[j] = { ...a, ...layout(b) };
      // Rebuild the event-wide order and give every class a clean sequential
      // sort_order — this also repairs ties that make the arrows look dead.
      let k = 0;
      const rebuilt = orderedAll.map((c) => ((c.day ?? 1) === day ? swapped[k++] : c));
      for (let idx = 0; idx < rebuilt.length; idx++) {
        const c = rebuilt[idx];
        const original = classes.find((x) => x.id === c.id);
        const data = {};
        if ((original?.sort_order ?? 0) !== idx + 1) data.sort_order = idx + 1;
        if (c.id === a.id || c.id === b.id) {
          for (const [field, value] of Object.entries(layout(c))) {
            if ((original?.[field] ?? null) !== value) data[field] = value;
          }
        }
        if (Object.keys(data).length) {
          const { error: e } = await supabase.from("classes").update(data).eq("id", c.id);
          if (e) throw e;
        }
      }
    });
  };

  const openEditor = (spec, initial = "") => { setEditor(spec); setEditorValue(initial); setError(""); };

  const editorForm = (placeholder, list) => (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "6px 0" }}>
      <input
        className="field"
        autoFocus
        list={list}
        style={{ flex: "1 1 180px", fontSize: 15 }}
        placeholder={placeholder}
        value={editorValue}
        onChange={(e) => setEditorValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submitEditor(); if (e.key === "Escape") setEditor(null); }}
      />
      <button className="btn" style={{ background: "var(--leather)", padding: "8px 14px" }} disabled={busy} onClick={submitEditor}>
        {busy ? "Saving…" : "Save"}
      </button>
      <button className="btn-ghost" style={{ padding: "8px 12px" }} onClick={() => { setEditor(null); setEditorValue(""); }}>Cancel</button>
    </div>
  );

  // The slim "＋" strip between rows — expands into a heading/break chooser.
  const addStrip = (cls, field, canBreak, canHeading) => {
    if (!canBreak && !canHeading) return null;
    const isOpen = editor?.mode === "add" && editor.classId === cls.id && editor.field === field;
    if (isOpen) {
      return (
        <div style={{ padding: "2px 0 2px 34px" }}>
          {canBreak && canHeading && (
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <button className="btn-ghost" style={{ fontSize: 11.5, padding: "3px 9px", ...(editor.kind === "heading" ? { borderColor: "var(--brass)", color: "var(--brass)" } : {}) }}
                onClick={() => setEditor({ ...editor, kind: "heading" })}>
                Section heading
              </button>
              <button className="btn-ghost" style={{ fontSize: 11.5, padding: "3px 9px", ...(editor.kind === "break" ? { borderColor: "var(--brass)", color: "var(--brass)" } : {}) }}
                onClick={() => setEditor({ ...editor, kind: "break" })}>
                Break
              </button>
            </div>
          )}
          {editorForm(editor.kind === "heading" ? "e.g. Quarter Horse Halter" : "e.g. LUNCH", editor.kind === "heading" ? "pb-categories" : "pb-breaks")}
        </div>
      );
    }
    return (
      <div style={{ padding: "0 0 0 34px" }}>
        <button
          onClick={() => openEditor({ mode: "add", classId: cls.id, field, kind: canHeading ? "heading" : "break" })}
          title={canBreak && canHeading ? "Add a section heading or a break here" : canBreak ? "Add a break here" : "Add a section heading here"}
          style={{ border: "none", background: "transparent", color: "#C3B79F", fontSize: 11, fontWeight: 800, cursor: "pointer", padding: "1px 4px", lineHeight: 1 }}>
          ＋{!canBreak ? " heading" : !canHeading ? " break" : ""}
        </button>
      </div>
    );
  };

  if (!session) {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <h1 className="display" style={{ fontWeight: 700, fontSize: 22 }}>Staff only</h1>
        <Link href="/coordinator" style={{ color: "var(--brass)" }}>← Sign in at coordinator dashboard</Link>
      </main>
    );
  }

  // Build the visible rows: a break where one is stored, a heading where the
  // category changes, a ＋ strip before every class, the class itself.
  const rows = [];
  let prevKey = "";
  let prevLabel = "";
  dayClasses.forEach((cls, i) => {
    const before = String(cls.program_break_before ?? "").trim();
    if (before) rows.push({ type: "break", cls, field: "program_break_before", label: before, key: `bb-${cls.id}` });

    const label = normaliseCategoryLabel(cls.program_category);
    const startsSection = categoryKey(label) !== prevKey;
    if (startsSection && label) rows.push({ type: "heading", cls, label, prevLabel, key: `h-${cls.id}` });
    if (startsSection) prevLabel = label;
    prevKey = categoryKey(label);

    // Offer a break only when the slot is free, and a heading only where one
    // isn't already shown (adding mid-section splits the section in two).
    rows.push({ type: "strip", cls, field: "program_break_before", canBreak: !before, canHeading: !(startsSection && label), key: `s-${cls.id}` });

    rows.push({ type: "class", cls, index: i, key: cls.id });

    const after = String(cls.program_break_after ?? "").trim();
    if (i === dayClasses.length - 1) {
      if (after) rows.push({ type: "break", cls, field: "program_break_after", label: after, key: `ba-${cls.id}` });
      else rows.push({ type: "strip", cls, field: "program_break_after", canBreak: true, canHeading: false, key: `sa-${cls.id}` });
    } else if (after) {
      rows.push({ type: "break", cls, field: "program_break_after", label: after, key: `ba-${cls.id}` });
    }
  });

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>Staff</div>
          <h1 className="display" style={{ fontWeight: 700, fontSize: "clamp(20px,4vw,26px)", margin: "2px 0", color: "#F2EADB" }}>Program builder</h1>
          <div style={{ fontSize: 13, color: "#CBBFA9" }}>
            Lay out the printed program — headings, breaks and running order in one place.
          </div>
        </div>
      </header>
      <main className="wrap" style={{ maxWidth: 760 }}>
        <ReadOnlyBanner />
        <p style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 4 }}>
          <Link href="/coordinator" style={{ color: "var(--brass)" }}>← Back to dashboard</Link>
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <select className="field" style={{ fontSize: 14, maxWidth: 320 }} value={eventId} onChange={(e) => { setEventId(e.target.value); setEditor(null); }}>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          {days.length > 1 && days.map((d) => (
            <button key={d} className="btn-ghost" style={{ fontSize: 12.5, padding: "6px 12px", ...(d === day ? { borderColor: "var(--brass)", color: "var(--brass)" } : {}) }}
              onClick={() => { setDay(d); setEditor(null); }}>
              Day {d}
            </button>
          ))}
          {eventId && (
            <a href={`/event/${eventId}/program${days.length > 1 ? `?day=${day}` : ""}`} target="_blank" rel="noreferrer" className="btn-ghost"
              style={{ fontSize: 12.5, padding: "6px 12px", textDecoration: "none", marginLeft: "auto" }}>
              👁 Preview / print ↗
            </a>
          )}
        </div>

        <p style={{ fontSize: 12.5, color: "var(--quiet)", margin: "0 0 12px" }}>
          Tap <strong>＋</strong> between classes to add a <strong>section heading</strong> (like &quot;Quarter Horse Halter&quot; — it covers every class below it
          until the next heading) or a <strong>break</strong> (like &quot;LUNCH&quot;). Tap any heading or break to rename it, and use ▲▼ to change the running
          order. Everything saves straight away and shows on the printed program and public pages.
        </p>

        {error && <p style={{ color: "var(--clay)", fontWeight: 700, fontSize: 13.5 }}>{error}</p>}

        <section className="card" style={{ padding: "10px 14px" }}>
          {loading && <p style={{ color: "var(--quiet)", fontSize: 13 }}>Loading…</p>}
          {!loading && dayClasses.length === 0 && (
            <p style={{ color: "var(--quiet)", fontSize: 13 }}>
              No classes yet — add or import classes from the <Link href="/coordinator" style={{ color: "var(--brass)" }}>dashboard</Link> first.
            </p>
          )}
          {!loading && rows.map((row) => {
            if (row.type === "strip") {
              return <div key={row.key}>{addStrip(row.cls, row.field, row.canBreak, row.canHeading)}</div>;
            }
            if (row.type === "heading") {
              const ids = groupFrom(row.cls);
              const isEditing = editor?.mode === "editHeading" && editor.ids?.[0] === ids[0];
              return (
                <div key={row.key} style={{ margin: "10px 0 2px", paddingLeft: 34 }}>
                  {isEditing ? editorForm("Section heading", "pb-categories") : (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => openEditor({ mode: "editHeading", ids }, row.label)}
                        title="Rename this section heading"
                        style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, color: "#1c4fd6", fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em", textAlign: "left" }}>
                        {row.label} <span style={{ color: "#C3B79F", fontWeight: 700, textTransform: "none", letterSpacing: 0 }}>✎</span>
                      </button>
                      <button className="btn-ghost danger" style={{ fontSize: 10.5, padding: "1px 7px" }} disabled={busy}
                        onClick={() => removeHeading(ids, row.prevLabel)}>
                        remove
                      </button>
                    </div>
                  )}
                </div>
              );
            }
            if (row.type === "break") {
              const isEditing = editor?.mode === "editBreak" && editor.classId === row.cls.id && editor.field === row.field;
              return (
                <div key={row.key} style={{ margin: "6px 0", paddingLeft: 34 }}>
                  {isEditing ? editorForm("Break — leave empty and Save to remove", "pb-breaks") : (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => openEditor({ mode: "editBreak", classId: row.cls.id, field: row.field }, row.label)}
                        title="Rename this break"
                        style={{ border: "none", cursor: "pointer", background: "#FFF200", color: "#1c4fd6", fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", padding: "2px 8px", borderRadius: 3 }}>
                        {row.label} ✎
                      </button>
                      <button className="btn-ghost danger" style={{ fontSize: 10.5, padding: "1px 7px" }} disabled={busy}
                        onClick={() => removeBreak(row.cls.id, row.field)}>
                        remove
                      </button>
                    </div>
                  )}
                </div>
              );
            }
            const cls = row.cls;
            return (
              <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", opacity: cls.hidden ? 0.45 : 1 }}>
                <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
                  <button className="btn-ghost" style={{ fontSize: 9, padding: "0 6px", lineHeight: "14px" }} disabled={busy || row.index === 0}
                    onClick={() => moveClass(cls, -1)} aria-label="Move earlier">▲</button>
                  <button className="btn-ghost" style={{ fontSize: 9, padding: "0 6px", lineHeight: "14px" }} disabled={busy || row.index === dayClasses.length - 1}
                    onClick={() => moveClass(cls, 1)} aria-label="Move later">▼</button>
                </span>
                <span className="display" style={{ fontWeight: 700, fontSize: 14, minWidth: 26, textAlign: "right" }}>{cls.num}.</span>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {cls.name}
                  {cls.hidden && <span style={{ marginLeft: 6, fontSize: 10.5, color: "var(--quiet)", fontWeight: 800 }}>HIDDEN</span>}
                </span>
              </div>
            );
          })}
        </section>

        <datalist id="pb-categories">
          {categorySuggestions.map((c) => <option key={c} value={c} />)}
        </datalist>
        <datalist id="pb-breaks">
          {BREAK_SUGGESTIONS.map((b) => <option key={b} value={b} />)}
        </datalist>
      </main>
    </>
  );
}

export default function ProgramBuilderPage() {
  return (
    <Suspense fallback={<main className="wrap"><p style={{ color: "var(--quiet)" }}>Loading…</p></main>}>
      <ProgramBuilder />
    </Suspense>
  );
}
