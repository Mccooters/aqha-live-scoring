"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { supabase } from "../../../../lib/supabaseClient";
import { programDisplayRows } from "../../../../lib/classCategories";
import { activeEntries, BEGINNER_RULES, dateRange, dayDate, drawIsPublished, fmtBack, HCQHA_RULES } from "../../../../lib/showPrint";

function PrintStyles() {
  return (
    <style jsx global>{`
      .print-toolbar { max-width: 980px; margin: 0 auto; padding: 14px 18px; display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
      .print-toolbar a, .print-toolbar button { text-decoration: none; border: 1px solid #d8d0c3; background: #fff; color: #3A2A1C; border-radius: 7px; padding: 7px 11px; font: 700 12px Archivo, sans-serif; }
      .program-sheet { width: 8.5in; min-height: 11in; margin: 18px auto 40px; padding: .42in .46in; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; box-shadow: 0 12px 30px rgba(42, 30, 18, .14); }
      .program-title { margin: 0 0 12px; text-align: center; font-size: 14px; line-height: 1.25; font-weight: 800; }
      .program-subtitle { margin: -6px 0 12px; text-align: center; font-size: 10.5px; color: #333; }
      .program-columns { column-count: 3; column-gap: 28px; font-size: 10px; line-height: 1.2; }
      .program-row { break-inside: avoid; margin: 0 0 4px; }
      .program-category { margin: 8px 0 4px; color: #003DE0; font-size: 10px; font-weight: 800; text-transform: uppercase; break-after: avoid; }
      .program-break { display: inline-block; margin: 7px 0 4px; padding: 1px 2px; background: #fff200; color: #003DE0; font-size: 10px; font-weight: 800; text-transform: uppercase; break-after: avoid; }
      .class-line { display: grid; grid-template-columns: 25px 1fr; gap: 4px; }
      .class-num { text-align: right; font-weight: 700; }
      .class-name { font-weight: 600; }
      .judge-line { grid-column: 2; color: #444; font-size: 8.5px; }
      .draw-list { grid-column: 2; margin: 2px 0 4px 0; padding-left: 0; list-style: none; font-size: 8.8px; color: #222; }
      .draw-list li { margin: 1px 0; }
      .entry-back { font-weight: 700; }
      .rules-block { break-inside: avoid; margin-top: 12px; font-size: 8.4px; }
      .rules-title { color: #2D7A52; font-weight: 800; text-transform: uppercase; margin: 8px 0 3px; }
      .rules-block ol { margin: 0; padding-left: 15px; }
      .rules-block li { margin-bottom: 2px; }
      @page { size: Letter; margin: 0.32in; }
      @media print {
        body { background: #fff !important; }
        .header, .print-toolbar, .bottom-nav { display: none !important; }
        .program-sheet { width: auto; min-height: auto; margin: 0; padding: 0; box-shadow: none; }
      }
      @media (max-width: 760px) {
        .program-sheet { width: calc(100vw - 24px); padding: 24px 18px; overflow-x: auto; }
        .program-columns { column-count: 1; }
      }
    `}</style>
  );
}

export default function ProgramPrintPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const [event, setEvent] = useState(null);
  const [classes, setClasses] = useState([]);
  // null = follow the event status (draw shown once closed/live/completed);
  // true/false = staff override via the "Show riders" toggle, so a program
  // with riders can be printed while entries are still open.
  const [drawOverride, setDrawOverride] = useState(null);

  const load = useCallback(async () => {
    const [{ data: ev }, { data: cls }] = await Promise.all([
      supabase.from("events").select("*").eq("id", id).single(),
      supabase.from("classes").select("*, entries(*)").eq("event_id", id).order("day").order("sort_order"),
    ]);
    if (ev) setEvent(ev);
    if (cls) setClasses(cls.map((c) => ({ ...c, entries: activeEntries(c) })));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const days = useMemo(() => {
    const values = [...new Set(classes.map((cls) => cls.day ?? 1))].sort((a, b) => a - b);
    return values.length ? values : [1];
  }, [classes]);
  const selectedDay = Number(searchParams.get("day") || days[0] || 1);
  const dayClasses = classes.filter((cls) => (cls.day ?? 1) === selectedDay);
  const multiDay = days.length > 1;
  const anyEntries = classes.some((cls) => (cls.entries?.length ?? 0) > 0);
  const showDraw = drawOverride ?? drawIsPublished(event);

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

      <section className="program-sheet">
        <h1 className="program-title">
          HUNTER COAST QUARTER HORSE ASSOCIATION - {event.name} {showDraw ? "Draw" : "Show Program"}
        </h1>
        <div className="program-subtitle">
          {multiDay ? `Day ${selectedDay}${dayDate(event, selectedDay) ? ` - ${dayDate(event, selectedDay)}` : ""}` : dateRange(event)}
          {event.location ? ` - ${event.location}` : ""}
        </div>
        <div className="program-columns">
          {programDisplayRows(dayClasses).map((row) => {
            if (row.type === "category") return <div key={row.key} className="program-category">{row.label}</div>;
            if (row.type === "break") return <div key={row.key} className="program-break">{row.label}</div>;
            const cls = row.cls;
            const entries = activeEntries(cls);
            return (
              <div key={row.key} className="program-row">
                <div className="class-line">
                  <div className="class-num">{cls.num}.</div>
                  <div className="class-name">{cls.name}</div>
                  {(cls.judge || cls.judge2) && (
                    <div className="judge-line">
                      {cls.judge2 ? `Judges: ${cls.judge || "-"} / ${cls.judge2}` : `Judge: ${cls.judge}`}
                    </div>
                  )}
                  {showDraw && entries.length > 0 && (
                    <ul className="draw-list">
                      {entries.map((entry) => (
                        <li key={entry.id}>
                          <span className="entry-back">#{fmtBack(entry.back_number)}</span> {entry.horse} - {entry.exhibitor}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
          <div className="rules-block">
            <p><strong>Note:</strong> All Beginner and EWD classes are walk/jog or walk/trot only.</p>
            <div className="program-break">FINISH</div>
            <div className="rules-title">HCQHA Rules</div>
            <ol>{HCQHA_RULES.map((rule) => <li key={rule}>{rule}</li>)}</ol>
            <div className="rules-title">Beginner Rules</div>
            <ol>{BEGINNER_RULES.map((rule) => <li key={rule}>{rule}</li>)}</ol>
          </div>
        </div>
      </section>
    </>
  );
}
