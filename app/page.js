"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";

export default function Home() {
  const [events, setEvents] = useState(null);

  useEffect(() => {
    supabase
      .from("events")
      .select("*")
      .order("starts_on", { ascending: false })
      .then(({ data }) => setEvents(data ?? []));
  }, []);

  return (
    <>
      <header className="header">
        <div className="wrap" style={{ padding: "0 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>
                HCQHA Events
              </div>
              <h1 className="display" style={{ fontWeight: 700, fontSize: "clamp(22px,4vw,30px)", margin: "2px 0 4px" }}>
                Live Show Tracker
              </h1>
            </div>
          </div>
        </div>
      </header>

      <main className="wrap">
        {events === null && <p style={{ color: "var(--quiet)" }}>Loading events…</p>}
        {events?.length === 0 && (
          <p style={{ color: "var(--quiet)" }}>
            No events yet. <Link href="/coordinator" style={{ color: "var(--brass)" }}>Sign in as coordinator</Link> to create your first event.
          </p>
        )}
        {events?.map((ev) => (
          <section key={ev.id} className="card" style={{ marginBottom: 14, overflow: "hidden" }}>
            <Link href={`/event/${ev.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "14px 16px", textDecoration: "none", color: "inherit" }}>
              <div>
                <div className="display" style={{ fontWeight: 700, fontSize: 18 }}>{ev.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 2 }}>
                  {ev.starts_on}{ev.ends_on && ev.ends_on !== ev.starts_on ? ` – ${ev.ends_on}` : ""}{ev.location ? ` · ${ev.location}` : ""}
                </div>
              </div>
              <span className={`badge ${ev.status}`}>{ev.status}</span>
            </Link>
            <div style={{ borderTop: "1px solid var(--line)", padding: "8px 16px", display: "flex", gap: 16 }}>
              <Link href={`/event/${ev.id}`} style={{ fontSize: 12.5, color: "var(--brass)", textDecoration: "none", fontWeight: 600 }}>Live scoring →</Link>
              <Link href={`/event/${ev.id}/schedule`} style={{ fontSize: 12.5, color: "var(--brass)", textDecoration: "none", fontWeight: 600 }}>Schedule →</Link>
            </div>
          </section>
        ))}
      </main>
    </>
  );
}
