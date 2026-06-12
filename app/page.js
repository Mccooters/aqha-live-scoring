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
          <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>
            AQHA Events
          </div>
          <h1 className="display" style={{ fontWeight: 700, fontSize: "clamp(22px,4vw,30px)", margin: "2px 0 4px" }}>
            Live Show Tracker
          </h1>
          <Link href="/coordinator" style={{ color: "var(--brass-soft)", fontSize: 13 }}>
            Coordinator sign in →
          </Link>
        </div>
      </header>
      <main className="wrap">
        {events === null && <p style={{ color: "var(--quiet)" }}>Loading events…</p>}
        {events?.length === 0 && (
          <p style={{ color: "var(--quiet)" }}>
            No events yet. Sign in as coordinator to create your first event.
          </p>
        )}
        {events?.map((ev) => (
          <Link key={ev.id} href={`/event/${ev.id}`} style={{ textDecoration: "none", color: "inherit" }}>
            <section className="card" style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <div className="display" style={{ fontWeight: 700, fontSize: 18 }}>{ev.name}</div>
                  <div style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 2 }}>
                    {ev.starts_on} {ev.ends_on && ev.ends_on !== ev.starts_on ? `– ${ev.ends_on}` : ""} · {ev.location}
                  </div>
                </div>
                <span className={`badge ${ev.status}`}>{ev.status}</span>
              </div>
            </section>
          </Link>
        ))}
      </main>
    </>
  );
}
