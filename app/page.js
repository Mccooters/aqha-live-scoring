"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";

const STATUS_LABEL = {
  pre_open:  "Coming soon",
  open:      "Entries open",
  upcoming:  "Entries open",
  closed:    "Entries closed",
  live:      "Live",
  completed: "Completed",
  archived:  "Archived",
};

export default function Home() {
  const [events, setEvents] = useState(null);

  useEffect(() => {
    supabase
      .from("events")
      .select("*")
      .order("starts_on", { ascending: false })
      .then(({ data }) => setEvents(data ?? []));
  }, []);

  const active   = events?.filter((e) => e.status !== "archived") ?? [];
  const archived = events?.filter((e) => e.status === "archived") ?? [];

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

        {active.map((ev) => {
          const isOpen = ev.status === "open" || ev.status === "upcoming";
          const isLive = ev.status === "live";
          return (
            <section key={ev.id} className="card" style={{ marginBottom: 14, overflow: "hidden" }}>
              <Link href={`/event/${ev.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "14px 16px", textDecoration: "none", color: "inherit" }}>
                <div>
                  <div className="display" style={{ fontWeight: 700, fontSize: 18 }}>{ev.name}</div>
                  <div style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 2 }}>
                    {ev.starts_on}{ev.ends_on && ev.ends_on !== ev.starts_on ? ` – ${ev.ends_on}` : ""}{ev.location ? ` · ${ev.location}` : ""}
                  </div>
                </div>
                <span className={`badge ${ev.status}`}>{STATUS_LABEL[ev.status] ?? ev.status}</span>
              </Link>
              <div style={{ borderTop: "1px solid var(--line)", padding: "8px 16px", display: "flex", gap: 16 }}>
                <Link href={`/event/${ev.id}`} style={{ fontSize: 12.5, color: "var(--brass)", textDecoration: "none", fontWeight: 600 }}>
                  {isLive ? "Live scoring →" : ev.status === "completed" ? "Results →" : "View →"}
                </Link>
                {(ev.status === "closed" || isLive || ev.status === "completed") && (
                  <Link href={`/event/${ev.id}/schedule`} style={{ fontSize: 12.5, color: "var(--brass)", textDecoration: "none", fontWeight: 600 }}>Schedule →</Link>
                )}
                {isOpen && (
                  <Link href={`/event/${ev.id}/register`} style={{ fontSize: 12.5, color: "var(--brass)", textDecoration: "none", fontWeight: 600 }}>Register entries →</Link>
                )}
              </div>
            </section>
          );
        })}

        {archived.length > 0 && (
          <details style={{ marginTop: 24 }}>
            <summary style={{ fontSize: 13, color: "var(--quiet)", cursor: "pointer", fontWeight: 600, letterSpacing: ".05em" }}>
              Archived events ({archived.length})
            </summary>
            <div style={{ marginTop: 10 }}>
              {archived.map((ev) => (
                <section key={ev.id} className="card" style={{ marginBottom: 10, overflow: "hidden", opacity: 0.75 }}>
                  <Link href={`/event/${ev.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 16px", textDecoration: "none", color: "inherit" }}>
                    <div>
                      <div className="display" style={{ fontWeight: 700, fontSize: 16 }}>{ev.name}</div>
                      <div style={{ fontSize: 12, color: "var(--quiet)", marginTop: 1 }}>
                        {ev.starts_on}{ev.ends_on && ev.ends_on !== ev.starts_on ? ` – ${ev.ends_on}` : ""}{ev.location ? ` · ${ev.location}` : ""}
                      </div>
                    </div>
                    <span className="badge archived">Archived</span>
                  </Link>
                </section>
              ))}
            </div>
          </details>
        )}
      </main>
    </>
  );
}
