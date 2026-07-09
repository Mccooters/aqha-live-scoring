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
  const [squareStatus, setSquareStatus] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [squareNotice, setSquareNotice] = useState("");

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

  // Auto-expiry: whenever staff view an event's registrations, sweep its
  // abandoned checkouts (unpaid > 48h) — they get cancelled and their Square
  // links deleted. The realtime subscription refreshes the list after.
  useEffect(() => {
    if (!session || !eventId) return;
    fetch("/api/registrations/cancel", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ expire: true, event_id: eventId }),
    })
      .then((res) => res.json())
      .then((data) => { if (data.expired > 0) load(); })
      .catch(() => {});
  }, [session, eventId, load]);

  const cancelRegistration = async (reg) => {
    if (!confirm(`Cancel ${reg.contact_name}'s unpaid registration?\n\nTheir Square checkout link will stop working and no entries will be created. They can always submit a fresh entry. This can't be undone.`)) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch("/api/registrations/cancel", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionData?.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ registration_id: reg.id }),
    });
    const data = await res.json();
    if (data.error) alert("Error: " + data.error);
    else await load();
  };

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
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch("/api/registrations/approve", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionData?.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ registration_id: regId }),
    });
    const data = await res.json();
    if (data.error) alert("Error: " + data.error);
    else await load();
    setApproving(null);
  };

  // Square connection card: current status, plus the outcome message when
  // Square has just redirected back here (?square=connected / denied / ...).
  const loadSquareStatus = useCallback(() => {
    if (!session) return;
    fetch("/api/square/status", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setSquareStatus(data))
      .catch(() => setSquareStatus(null));
  }, [session]);

  useEffect(() => {
    if (!session) return;
    loadSquareStatus();
    // Connecting happens over on squareup.com (sometimes in another window),
    // so re-check whenever the coordinator comes back to this tab — the card
    // must never keep showing a stale verdict after a reconnect.
    window.addEventListener("focus", loadSquareStatus);
    return () => window.removeEventListener("focus", loadSquareStatus);
  }, [session, loadSquareStatus]);

  useEffect(() => {
    if (!session) return;
    const outcome = new URLSearchParams(window.location.search).get("square");
    if (outcome) {
      setSquareNotice(
        {
          connected: "✓ Square connected — online payments now run through the club's authorised connection.",
          denied: "The Square connection was declined. Payments continue through the existing setup.",
          state_mismatch: "The connection attempt expired or didn't start from this page — please try again.",
          migration_needed: "Square approved the connection, but the database needs migration schema-v31 before it can be saved. Run it, then connect again.",
          failed: "Connecting to Square didn't work. Please try again or contact support.",
        }[outcome] ?? ""
      );
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [session]);

  const connectSquare = async () => {
    setConnecting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const res = await fetch("/api/square/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionData?.session?.access_token ?? ""}` },
      });
      const data = await res.json();
      if (data.error) { alert("Error: " + data.error); setConnecting(false); return; }
      window.location.href = data.url; // off to Square to sign in as the club and approve
    } catch {
      alert("Could not reach Square. Please try again.");
      setConnecting(false);
    }
  };

  const disconnectSquare = async () => {
    if (!confirm("Disconnect Square?\n\nPayments will go back to using the club's own Square access token. You can reconnect at any time.")) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch("/api/square/connect", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${sessionData?.session?.access_token ?? ""}` },
    });
    const data = await res.json();
    if (data.error) { alert("Error: " + data.error); return; }
    window.location.reload();
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
  const pending = registrations.filter((r) => r.status === "pending");
  const revenue = paid.reduce((s, r) => s + (r.total_cents ?? 0), 0);
  const entryCount = registrations.reduce((s, r) => s + (r.registration_entries?.length ?? 0), 0);
  const dayMembershipCount = paid.filter((r) => r.day_membership).length;
  const replacementNumbersCount = paid.filter((r) => r.replacement_numbers).length;

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
        {squareNotice && (
          <div className="card" style={{ padding: "12px 14px", marginBottom: 14, borderColor: squareNotice.startsWith("✓") ? "#2D7A52" : "#E0B15A", background: squareNotice.startsWith("✓") ? "#EAF5EE" : "#FFF7D6" }}>
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "var(--leather)" }}>{squareNotice}</p>
          </div>
        )}

        {/* Square connection — how online payments are authorised */}
        {squareStatus && (
          <section className="card" style={{ marginBottom: 20 }}>
            <div className="card-head">
              <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Square connection</div>
              {squareStatus.connected && (
                <span style={{ fontSize: 12.5, fontWeight: 800, color: "#2D7A52" }}>● Connected</span>
              )}
            </div>
            <div style={{ paddingBottom: 10, fontSize: 13.5, color: "var(--quiet)" }}>
              {squareStatus.connected ? (
                <p style={{ margin: "0 0 10px" }}>
                  Online payments run through the club&apos;s authorised Square connection
                  (merchant {squareStatus.merchant_id}
                  {squareStatus.connected_at ? `, connected ${fmtDate(squareStatus.connected_at)}` : ""}).
                  {squareStatus.fee_bps > 0
                    ? ` A ${(squareStatus.fee_bps / 100).toFixed(2)}% platform fee applies to each payment.`
                    : " No platform fee is currently configured."}
                </p>
              ) : (
                <p style={{ margin: "0 0 10px" }}>
                  {squareStatus.fallback_token
                    ? "Online payments currently use the club's own Square access token."
                    : "Online payments are not configured yet."}
                  {" "}Connecting Square authorises this app with the club&apos;s Square account
                  {squareStatus.fee_bps > 0
                    ? ` and enables the ${(squareStatus.fee_bps / 100).toFixed(2)}% platform fee per payment.`
                    : "."}
                </p>
              )}
              {squareStatus.diagnostics && (
                <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", marginBottom: 10, background: "#fff", fontSize: 12.5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontWeight: 800, color: "var(--leather)" }}>Health check (live from Square)</span>
                    <button className="btn-ghost" onClick={loadSquareStatus} style={{ padding: "2px 8px", fontSize: 11.5 }}>
                      ↻ Re-check
                    </button>
                  </div>
                  <div>Mode: <strong>{squareStatus.diagnostics.environment}</strong> · Credentials in use: <strong>{
                    { oauth: "connected Square account", fallback_token: "club's own access token", none: "none — payments can't run" }[squareStatus.diagnostics.source]
                  }</strong></div>
                  {squareStatus.diagnostics.square_error ? (
                    <div style={{ color: "var(--clay)", fontWeight: 700, marginTop: 4 }}>
                      ✗ Square rejected these credentials: {squareStatus.diagnostics.square_error}
                    </div>
                  ) : squareStatus.diagnostics.location_ok === false ? (
                    <div style={{ color: "var(--clay)", fontWeight: 700, marginTop: 4 }}>
                      ✗ These credentials can NOT see the configured location {squareStatus.diagnostics.configured_location} — this is exactly what causes &quot;Invalid location id&quot; at checkout. They belong to{" "}
                      {squareStatus.diagnostics.locations.length
                        ? `a Square account whose locations are: ${squareStatus.diagnostics.locations.map((l) => `${l.name} (${l.id})`).join(", ")}`
                        : "a Square account with no locations — almost certainly the wrong account"}.
                    </div>
                  ) : squareStatus.diagnostics.location_ok === true ? (
                    <div style={{ color: "#2D7A52", fontWeight: 700, marginTop: 4 }}>
                      ✓ Location {squareStatus.diagnostics.configured_location} is visible to these credentials — payments should work.
                    </div>
                  ) : (
                    <div style={{ marginTop: 4 }}>No location configured (SQUARE_LOCATION_ID).</div>
                  )}
                </div>
              )}
              {squareStatus.app_configured ? (
                <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn-ghost" onClick={connectSquare} disabled={connecting} style={{ fontSize: 13 }}>
                    {connecting ? "Opening Square…" : squareStatus.connected ? "Reconnect Square" : "Connect Square"}
                  </button>
                  {squareStatus.connected && (
                    <button className="btn-ghost" onClick={disconnectSquare} style={{ fontSize: 13, color: "var(--clay)", borderColor: "var(--clay)" }}>
                      Disconnect
                    </button>
                  )}
                </span>
              ) : (
                <p style={{ margin: 0, fontSize: 12.5 }}>
                  To enable connecting, add SQUARE_APP_ID and SQUARE_APP_SECRET in Vercel first.
                </p>
              )}
            </div>
          </section>
        )}

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
              { label: "Day memberships", value: dayMembershipCount },
              { label: "Replacement numbers", value: replacementNumbersCount },
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
          const isCancelled = reg.status === "cancelled";
          return (
            <section key={reg.id} className="card" style={{ opacity: isPaid ? 1 : isCancelled ? 0.55 : 0.75 }}>
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
                    {reg.day_membership && ` · day membership ${fmtMoney(reg.day_membership_cents ?? 2000)}`}
                    {reg.replacement_numbers && ` · replacement numbers ${fmtMoney(reg.replacement_numbers_cents ?? 500)}`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: 14, textDecoration: isCancelled ? "line-through" : "none" }}>{fmtMoney(reg.total_cents)}</span>
                  {isCancelled ? (
                    <span className="badge" style={{ background: "#8B8073", color: "#fff" }}>
                      {reg.cancel_reason === "expired" ? "expired" : "cancelled"}
                    </span>
                  ) : (
                    <span className={`badge ${isPaid ? "live" : "upcoming"}`}>
                      {isPaid ? "paid" : "pending"}
                    </span>
                  )}
                  <span style={{ fontSize: 13, color: "var(--quiet)" }}>{isExpanded ? "▲" : "▼"}</span>
                </div>
              </div>

              {isExpanded && (
                <div style={{ paddingBottom: 12 }}>
                  {reg.day_membership && (
                    <p style={{ color: "var(--leather)", fontSize: 13, fontWeight: 700, padding: "4px 0 0", margin: 0 }}>
                      Includes day membership for this event ({fmtMoney(reg.day_membership_cents ?? 2000)}).
                    </p>
                  )}
                  {reg.replacement_numbers && (
                    <p style={{ color: "var(--leather)", fontSize: 13, fontWeight: 700, padding: "4px 0 0", margin: 0 }}>
                      Includes replacement numbers ({fmtMoney(reg.replacement_numbers_cents ?? 500)}).
                    </p>
                  )}
                  {(reg.fees_cents ?? 0) > 0 && (
                    <p style={{ color: "var(--leather)", fontSize: 13, fontWeight: 700, padding: "4px 0 0", margin: 0 }}>
                      Includes one-off ground/admin fees for this event ({fmtMoney(reg.fees_cents)}).
                    </p>
                  )}
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
                              {e.back_number != null ? `#${String(e.back_number).padStart(3, "0")}` : "new"}
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

                  {!isPaid && !isCancelled && (
                    <div style={{ padding: "10px 0 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        className="btn-ghost"
                        style={{ fontSize: 12 }}
                        onClick={() => forceApprove(reg.id)}
                        disabled={approving === reg.id}
                      >
                        {approving === reg.id ? "Creating entries…" : "Force-create entries (Square payment confirmed manually)"}
                      </button>
                      <button
                        className="btn-ghost"
                        style={{ fontSize: 12, color: "var(--clay)", borderColor: "var(--clay)" }}
                        onClick={() => cancelRegistration(reg)}
                      >
                        Cancel registration
                      </button>
                    </div>
                  )}
                  {isCancelled && (
                    <p style={{ color: "var(--quiet)", fontSize: 12.5, padding: "8px 0 0", margin: 0 }}>
                      {reg.cancel_reason === "expired"
                        ? "Expired automatically after 48 hours unpaid — the checkout link no longer works."
                        : "Cancelled by staff — the checkout link no longer works."}
                      {" "}No entries were created.
                    </p>
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
