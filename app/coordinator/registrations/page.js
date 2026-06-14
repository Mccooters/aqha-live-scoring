"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";

const fmtMoney = (cents) => (cents != null ? `$${(cents / 100).toFixed(2)}` : "—");
const fmtDate = (s) =>
  s ? new Date(s).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" }) : "—";

export default function RegistrationsPage() {
  const [session, setSession] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState("");
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [approving, setApproving] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    supabase
      .from("events")
      .select("id, name, status")
      .order("starts_on", { ascending: false })
      .then(({ data }) => {
        setEvents(data ?? []);
        if (data?.length) setEventId(data[0].id);
      });
  }, []);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    const { data } = await supabase
      .from("registrations")
      .select("*, registration_entries(*)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false });
    setRegistrations(data ?? []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  // Realtime updates
  useEffect(() => {
    if (!eventId) return;
    const channel = supabase
      .channel(`regs-${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "registrations" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [eventId, load]);

  const forceApprove = async (regId) => {
    if (!confirm("Force-create entries from this registration?\n\nOnly do this if the Square payment has been confirmed but entries didn't appear automatically.")) return;
    setApproving(regId);
    const res = await fetch("/api/registrations/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registration_id: regId }),
    });
    const data = await res.json();
    if (data.error) alert("Error: " + data.error);
    else await load();
    setApproving(null);
  };

  if (!session) {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <h1 className="display" style={{ fontWeight: 700, fontSize: 22 }}>Staff only</h1>
        <Link href="/coordinator" style={{ color: "var(--brass)" }}>← Sign in at coordinator dashboard</Link>
      </main>
    );
  }

  const paid = registrations.filter((r) => r.status === "paid");
  const pending = registrations.filter((r) => r.status !== "paid");
  const revenue = paid.reduce((s, r) => s + (r.total_cents ?? 0), 0);
  const entryCount = registrations.reduce((s, r) => s + (r.registration_entries?.length ?? 0), 0);

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>
              Coordinator
            </div>
            <h1 className="display" style={{ fontWeight: 700, fontSize: 22, margin: "2px 0", color: "#F2EADB" }}>
              Online Registrations
            </h1>
          </div>
          <Link href="/coordinator" style={{ color: "var(--brass-soft)", fontSize: 13, alignSelf: "center" }}>
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="wrap">
        {/* Event selector */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 12, color: "var(--quiet)", marginBottom: 4 }}>Event</label>
          <select className="field" value={eventId} onChange={(e) => setEventId(e.target.value)} style={{ fontSize: 15 }}>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.name}</option>
            ))}
          </select>
        </div>

        {/* Summary cards */}
        {!loading && registrations.length > 0 && (
          <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
            {[
              { label: "Confirmed", value: paid.length },
              { label: "Pending payment", value: pending.length },
              { label: "Total entries", value: entryCount },
              { label: "Revenue", value: fmtMoney(revenue) },
            ].map((s) => (
              <div key={s.label} className="card" style={{ flex: "1 1 120px", padding: "12px 16px", margin: 0 }}>
                <div className="display" style={{ fontWeight: 700, fontSize: 22 }}>{s.value}</div>
                <div style={{ fontSize: 12, color: "var(--quiet)", marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {loading && <p style={{ color: "var(--quiet)" }}>Loading…</p>}

        {!loading && registrations.length === 0 && (
          <div className="card" style={{ textAlign: "center", padding: "30px 20px" }}>
            <p className="display" style={{ fontSize: 18, color: "var(--quiet)", margin: 0 }}>
              No registrations for this event yet.
            </p>
            <p style={{ fontSize: 13, color: "var(--quiet)", marginTop: 8 }}>
              Share the event page with exhibitors so they can register online.
            </p>
          </div>
        )}

        {registrations.map((reg) => {
          const isExpanded = expanded === reg.id;
          const isPaid = reg.status === "paid";
          return (
            <section key={reg.id} className="card" style={{ opacity: isPaid ? 1 : 0.75 }}>
              <div
                className="card-head"
                style={{ cursor: "pointer" }}
                onClick={() => setExpanded(isExpanded ? null : reg.id)}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{reg.contact_name}</div>
                  <div style={{ fontSize: 12.5, color: "var(--quiet)" }}>
                    {reg.contact_email} · {fmtDate(reg.created_at)}
                    {" · "}{reg.registration_entries?.length ?? 0} {reg.registration_entries?.length === 1 ? "entry" : "entries"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{fmtMoney(reg.total_cents)}</span>
                  <span className={`badge ${isPaid ? "live" : "upcoming"}`}>
                    {isPaid ? "paid" : "pending"}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--quiet)" }}>{isExpanded ? "▲" : "▼"}</span>
                </div>
              </div>

              {isExpanded && (
                <div style={{ paddingBottom: 12 }}>
                  {(reg.registration_entries ?? []).length > 0 ? (
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: 70 }}>Back #</th>
                          <th>Horse</th>
                          <th>Exhibitor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(reg.registration_entries ?? []).map((e) => (
                          <tr key={e.id}>
                            <td className="display" style={{ fontWeight: 700, color: "var(--brass)" }}>
                              #{String(e.back_number).padStart(3, "0")}
                            </td>
                            <td style={{ fontWeight: 600 }}>{e.horse_name}</td>
                            <td style={{ color: "var(--quiet)" }}>{e.exhibitor}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ color: "var(--quiet)", fontSize: 13, padding: "4px 0 0" }}>No entry details found.</p>
                  )}

                  {!isPaid && (
                    <div style={{ padding: "10px 0 0" }}>
                      <button
                        className="btn-ghost"
                        style={{ fontSize: 12 }}
                        onClick={() => forceApprove(reg.id)}
                        disabled={approving === reg.id}
                      >
                        {approving === reg.id ? "Creating entries…" : "Force-create entries (Square payment confirmed manually)"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </main>
    </>
  );
}
