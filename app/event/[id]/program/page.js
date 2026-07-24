"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { supabase } from "../../../../lib/supabaseClient";
import { programDisplayRows } from "../../../../lib/classCategories";
import { activeEntries, BEGINNER_RULES, dateRange, dayDate, drawIsPublished, fmtBack, HCQHA_RULES } from "../../../../lib/showPrint";

// The program is laid out into explicit A4 pages, each with three columns that
// we pack ourselves (by measuring every item's real height). This avoids
// relying on the browser's CSS multi-column pagination, which Safari renders
// unreliably in print (spreading the program thinly over many pages). Because
// we measure at the exact print width, the on-screen preview and the printed
// sheets are identical.

function PrintStyles() {
  return (
    <style jsx global>{`
      .print-toolbar { max-width: 980px; margin: 0 auto; padding: 14px 18px; display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
      .print-toolbar a, .print-toolbar button { text-decoration: none; border: 1px solid #d8d0c3; background: #fff; color: #3A2A1C; border-radius: 7px; padding: 7px 11px; font: 700 12px Archivo, sans-serif; }

      .program-shell { padding-bottom: 40px; }
      .program-page { width: 210mm; min-height: 297mm; box-sizing: border-box; margin: 18px auto; padding: 12mm 10mm; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; box-shadow: 0 12px 30px rgba(42, 30, 18, .14); }
      .program-page-body { display: flex; gap: 6mm; align-items: flex-start; }
      .program-col { width: calc((190mm - 12mm) / 3); }
      .prog-item { display: flow-root; }

      .program-title { margin: 0 0 6px; text-align: center; font-size: 14px; line-height: 1.25; font-weight: 800; }
      .program-subtitle { margin: 0 0 12px; text-align: center; font-size: 10.5px; color: #333; }
      .program-category { margin: 8px 0 4px; color: #003DE0; font-size: 10px; font-weight: 800; text-transform: uppercase; }
      .program-break { display: inline-block; margin: 7px 0 4px; padding: 1px 2px; background: #fff200; color: #003DE0; font-size: 10px; font-weight: 800; text-transform: uppercase; }
      .program-row { margin: 0 0 4px; font-size: 10px; line-height: 1.2; }
      .class-line { display: grid; grid-template-columns: 25px 1fr; gap: 4px; }
      .class-num { text-align: right; font-weight: 700; }
      .class-name { font-weight: 600; }
      .judge-line { grid-column: 2; color: #444; font-size: 8.5px; }
      .draw-list { grid-column: 2; margin: 2px 0 4px 0; padding-left: 0; list-style: none; font-size: 8.8px; color: #222; }
      .draw-list li { margin: 1px 0; }
      .entry-back { font-weight: 700; }
      .program-note { font-size: 8.6px; margin: 8px 0 4px; }
      .rules-title { color: #2D7A52; font-weight: 800; text-transform: uppercase; margin: 8px 0 3px; font-size: 8.6px; }
      .rule-line { font-size: 8.4px; line-height: 1.25; margin: 0 0 2px; padding-left: 10px; text-indent: -10px; }

      /* Off-screen measuring copy — never shown, never printed. */
      .program-measure { position: absolute; left: -10000px; top: 0; visibility: hidden; pointer-events: none; }

      @page { size: A4; margin: 0; }
      @media print {
        body { background: #fff !important; }
        .header, .print-toolbar, .bottom-nav, nav { display: none !important; }
        .program-measure { display: none !important; }
        .program-shell { padding: 0; }
        .program-page { margin: 0; box-shadow: none; break-after: page; page-break-after: always; }
        .program-page:last-child { break-after: auto; page-break-after: auto; }
      }
      @media (max-width: 760px) {
        .program-page { width: 100%; min-height: 0; padding: 18px; }
        .program-page-body { flex-direction: column; gap: 0; }
        .program-col { width: 100%; }
      }
    `}</style>
  );
}

function ItemView({ item }) {
  switch (item.kind) {
    case "category":
      return <div className="program-category">{item.label}</div>;
    case "break":
      return <div className="program-break">{item.label}</div>;
    case "note":
      return <p className="program-note"><strong>Note:</strong> {item.text}</p>;
    case "rulesTitle":
      return <div className="rules-title">{item.label}</div>;
    case "ruleLine":
      return <div className="rule-line">• {item.text}</div>;
    case "class": {
      const cls = item.cls;
      return (
        <div className="program-row">
          <div className="class-line">
            <div className="class-num">{cls.num}.</div>
            <div className="class-name">{cls.name}</div>
            {(cls.judge || cls.judge2) && (
              <div className="judge-line">
                {cls.judge2 ? `Judges: ${cls.judge || "-"} / ${cls.judge2}` : `Judge: ${cls.judge}`}
              </div>
            )}
            {item.entries.length > 0 && (
              <ul className="draw-list">
                {item.entries.map((entry) => (
                  <li key={entry.id}>
                    <span className="entry-back">#{fmtBack(entry.back_number)}</span> {entry.horse} - {entry.exhibitor}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}

function buildItems(dayClasses, showDraw) {
  const items = programDisplayRows(dayClasses).map((row) => {
    if (row.type === "category") return { key: row.key, kind: "category", label: row.label };
    if (row.type === "break") return { key: row.key, kind: "break", label: row.label };
    const cls = row.cls;
    return { key: row.key, kind: "class", cls, entries: showDraw ? activeEntries(cls) : [] };
  });
  items.push({ key: "note", kind: "note", text: "All Beginner and EWD classes are walk/jog or walk/trot only." });
  items.push({ key: "finish", kind: "break", label: "FINISH" });
  items.push({ key: "hcqha-title", kind: "rulesTitle", label: "HCQHA Rules" });
  HCQHA_RULES.forEach((rule, i) => items.push({ key: `hcqha-${i}`, kind: "ruleLine", text: rule }));
  items.push({ key: "beg-title", kind: "rulesTitle", label: "Beginner Rules" });
  BEGINNER_RULES.forEach((rule, i) => items.push({ key: `beg-${i}`, kind: "ruleLine", text: rule }));
  return items;
}

// Greedily pack item indices into columns of `cap` px (first page smaller to
// make room for the title), three columns per page.
function paginate(heights, firstCap, cap) {
  const pages = [];
  let cols = [[], [], []];
  let col = 0;
  let used = 0;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    const capacity = pages.length === 0 ? firstCap : cap;
    if (used > 0 && used + h > capacity) {
      col += 1;
      used = 0;
      if (col > 2) { pages.push(cols); cols = [[], [], []]; col = 0; }
    }
    cols[col].push(i);
    used += h;
  }
  if (cols.some((c) => c.length)) pages.push(cols);
  return pages;
}

const MM_TO_PX = 96 / 25.4;
const PAGE_CONTENT_H_PX = (297 - 24) * MM_TO_PX; // A4 height minus 12mm top+bottom padding

export default function ProgramPrintPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const [event, setEvent] = useState(null);
  const [classes, setClasses] = useState([]);
  const [drawOverride, setDrawOverride] = useState(null);
  const [pages, setPages] = useState(null);

  const measureColRef = useRef(null);
  const measureTitleRef = useRef(null);

  const load = useCallback(async () => {
    const [{ data: ev }, { data: cls }] = await Promise.all([
      supabase.from("events").select("*").eq("id", id).single(),
      supabase.from("classes").select("*, entries(*)").eq("event_id", id).order("day").order("sort_order"),
    ]);
    if (ev) setEvent(ev);
    if (cls) setClasses(cls.filter((c) => !c.hidden).map((c) => ({ ...c, entries: activeEntries(c) }))); // hidden classes (schema-v38) stay off the printed program
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const days = useMemo(() => {
    const values = [...new Set(classes.map((cls) => cls.day ?? 1))].sort((a, b) => a - b);
    return values.length ? values : [1];
  }, [classes]);
  const selectedDay = Number(searchParams.get("day") || days[0] || 1);
  const dayClasses = useMemo(() => classes.filter((cls) => (cls.day ?? 1) === selectedDay), [classes, selectedDay]);
  const multiDay = days.length > 1;
  const anyEntries = classes.some((cls) => (cls.entries?.length ?? 0) > 0);
  const showDraw = drawOverride ?? drawIsPublished(event);
  const items = useMemo(() => buildItems(dayClasses, showDraw), [dayClasses, showDraw]);

  const title = event ? `HUNTER COAST QUARTER HORSE ASSOCIATION - ${event.name} ${showDraw ? "Draw" : "Show Program"}` : "";
  const subtitle = event
    ? `${multiDay ? `Day ${selectedDay}${dayDate(event, selectedDay) ? ` - ${dayDate(event, selectedDay)}` : ""}` : dateRange(event)}${event.location ? ` - ${event.location}` : ""}`
    : "";

  // Measure each item at the real column width, then pack into A4 pages.
  useLayoutEffect(() => {
    if (!measureColRef.current) return;
    const itemEls = measureColRef.current.querySelectorAll(".prog-item");
    const heights = Array.from(itemEls).map((el) => el.getBoundingClientRect().height);
    const titleH = measureTitleRef.current ? measureTitleRef.current.getBoundingClientRect().height : 0;
    const cap = PAGE_CONTENT_H_PX * 0.97;
    const firstCap = (PAGE_CONTENT_H_PX - titleH - 6) * 0.97;
    setPages(paginate(heights, firstCap, cap));
  }, [items, title, subtitle]);

  if (!event) return <main className="wrap"><p style={{ color: "var(--quiet)" }}>Loading...</p></main>;

  return (
    <>
      <PrintStyles />
      <div className="print-toolbar">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={`/event/${id}`}>Live view</Link>
          <Link href={`/event/${id}/schedule`}>Schedule</Link>
          <Link href={`/event/${id}/results${multiDay ? `?day=${selectedDay}` : ""}`}>Results</Link>
          <a href={`/api/events/${id}/patterns`}>Patterns PDF</a>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {multiDay && days.map((day) => (
            <Link key={day} href={`/event/${id}/program?day=${day}`} style={day === selectedDay ? { borderColor: "#A8843C", color: "#A8843C" } : {}}>
              Day {day}
            </Link>
          ))}
          {anyEntries && (
            <button
              onClick={() => setDrawOverride(!showDraw)}
              style={showDraw ? { borderColor: "#A8843C", color: "#A8843C" } : {}}
              title="Include each class's riders in the printed program">
              {showDraw ? "Hide riders" : "Show riders"}
            </button>
          )}
          <button onClick={() => window.print()}>Print / Save PDF</button>
        </div>
      </div>

      {/* Off-screen measuring copy: one full-width title + one column of every item. */}
      <div className="program-measure" aria-hidden="true">
        <div ref={measureTitleRef} style={{ width: "190mm" }}>
          <h1 className="program-title">{title}</h1>
          <div className="program-subtitle">{subtitle}</div>
        </div>
        <div className="program-col" ref={measureColRef}>
          {items.map((item, i) => (
            <div className="prog-item" key={item.key}><ItemView item={item} /></div>
          ))}
        </div>
      </div>

      <div className="program-shell">
        {(pages ?? []).map((cols, pi) => (
          <section className="program-page" key={pi}>
            {pi === 0 && (
              <>
                <h1 className="program-title">{title}</h1>
                <div className="program-subtitle">{subtitle}</div>
              </>
            )}
            <div className="program-page-body">
              {cols.map((colItems, ci) => (
                <div className="program-col" key={ci}>
                  {colItems.map((idx) => (
                    <div className="prog-item" key={items[idx].key}><ItemView item={items[idx]} /></div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
