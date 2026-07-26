"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { supabase } from "../../../../lib/supabaseClient";
import { programDisplayRows, withoutHiddenClasses } from "../../../../lib/classCategories";
import { activeEntries, dateRange, dayDate, fmtBack, resultEntries, scoreText } from "../../../../lib/showPrint";

function PrintStyles() {
  return (
    <style jsx global>{`
      .print-toolbar { max-width: 980px; margin: 0 auto; padding: 14px 18px; display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
      .print-toolbar a, .print-toolbar button { text-decoration: none; border: 1px solid #d8d0c3; background: #fff; color: #3A2A1C; border-radius: 7px; padding: 7px 11px; font: 700 12px Archivo, sans-serif; }
      .program-sheet { width: 8.5in; min-height: 11in; margin: 18px auto 40px; padding: .42in .46in; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; box-shadow: 0 12px 30px rgba(42, 30, 18, .14); }
      .program-title { margin: 0 0 12px; text-align: center; font-size: 14px; line-height: 1.25; font-weight: 800; }
      .program-subtitle { margin: -6px 0 12px; text-align: center; font-size: 10.5px; color: #333; }
      .program-columns { column-count: 2; column-gap: 30px; font-size: 10px; line-height: 1.22; }
      .program-row { break-inside: avoid; margin: 0 0 7px; }
      .program-category { margin: 8px 0 4px; color: #003DE0; font-size: 10px; font-weight: 800; text-transform: uppercase; break-after: avoid; }
      .program-break { display: inline-block; margin: 7px 0 4px; padding: 1px 2px; background: #fff200; color: #003DE0; font-size: 10px; font-weight: 800; text-transform: uppercase; break-after: avoid; }
      .class-heading { display: grid; grid-template-columns: 25px 1fr; gap: 4px; margin-bottom: 2px; }
      .class-num { text-align: right; font-weight: 700; }
      .class-name { font-weight: 700; }
      .result-list { margin: 2px 0 0 29px; padding: 0; list-style: none; font-size: 9px; }
      .result-list li { display: grid; grid-template-columns: 18px 1fr auto; gap: 5px; margin: 1px 0; }
      .result-place { font-weight: 800; color: #003DE0; }
      .result-score { font-weight: 700; }
      .pending-line { margin-left: 29px; color: #555; font-style: italic; font-size: 8.8px; }
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

export default function ResultsPrintPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const [event, setEvent] = useState(null);
  const [classes, setClasses] = useState([]);

  const load = useCallback(async () => {
    const [{ data: ev }, { data: cls }] = await Promise.all([
      supabase.from("events").select("*").eq("id", id).single(),
      supabase.from("classes").select("*, entries(*)").eq("event_id", id).order("day").order("sort_order"),
    ]);
    if (ev) setEvent(ev);
    if (cls) setClasses(withoutHiddenClasses(cls).map((c) => ({ ...c, entries: activeEntries(c) }))); // hidden classes (schema-v38) stay off public results; their program breaks carry over
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const days = useMemo(() => {
    const values = [...new Set(classes.map((cls) => cls.day ?? 1))].sort((a, b) => a - b);
    return values.length ? values : [1];
  }, [classes]);
  const selectedDay = Number(searchParams.get("day") || days[0] || 1);
  const dayClasses = classes.filter((cls) => (cls.day ?? 1) === selectedDay);
  const multiDay = days.length > 1;

  if (!event) return <main className="wrap"><p style={{ color: "var(--quiet)" }}>Loading...</p></main>;

  return (
    <>
      <PrintStyles />
      <div className="print-toolbar">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={`/event/${id}`}>Live view</Link>
          <Link href={`/event/${id}/schedule`}>Schedule</Link>
          <Link href={`/event/${id}/program${multiDay ? `?day=${selectedDay}` : ""}`}>Program</Link>
          <a href={`/api/events/${id}/patterns`}>Patterns PDF</a>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {multiDay && days.map((day) => (
            <Link key={day} href={`/event/${id}/results?day=${day}`} style={day === selectedDay ? { borderColor: "#A8843C", color: "#A8843C" } : {}}>
              Day {day}
            </Link>
          ))}
          <button onClick={() => window.print()}>Print / Save PDF</button>
        </div>
      </div>

      <section className="program-sheet">
        <h1 className="program-title">
          HUNTER COAST QUARTER HORSE ASSOCIATION - {event.name} Results
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
            const results = resultEntries(cls);
            // Championship classes (schema-v43): 1st/2nd read as Champion/Reserve
            // (a Supreme class's winner reads Supreme).
            const isChamp = Array.isArray(cls.champ_feeder_ids) && cls.champ_feeder_ids.length > 0;
            const champTitle = /supreme/i.test(cls.name ?? "") ? "Supreme" : "Champion";
            return (
              <div key={row.key} className="program-row">
                <div className="class-heading">
                  <div className="class-num">{cls.num}.</div>
                  <div className="class-name">{cls.name}</div>
                </div>
                {results.length > 0 ? (
                  <ol className="result-list">
                    {results.map((entry, idx) => (
                      <li key={entry.id}>
                        <span className="result-place">{isChamp && idx === 0 ? `${champTitle}:` : isChamp && idx === 1 ? "Reserve:" : `${idx + 1}.`}</span>
                        <span>#{fmtBack(entry.back_number)} {entry.horse} - {entry.exhibitor}</span>
                        <span className="result-score">{scoreText(entry, cls)}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="pending-line">Results pending</div>
                )}
                {Array.isArray(cls.result_sheets) && cls.result_sheets.length > 0 && (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "3px 0 4px", fontSize: "9px" }}>
                    {cls.result_sheets.map((s, i) => (
                      <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ color: "#7A5C10", fontWeight: 700, textDecoration: "none" }}>
                        📄 {s.label}{cls.result_sheets.filter((x) => x.label === s.label).length > 1 ? ` (${cls.result_sheets.slice(0, i + 1).filter((x) => x.label === s.label).length})` : ""}&apos;s sheet
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
