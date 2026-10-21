"use client";
import { useEffect, useState, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import { KIND_ICON, extraNights, nightLabel, priceLabel } from "../../../lib/eventExtras";

// Staff: who has booked which yards and camping sites for an event, night
// by night (schema-v61) — the list the ground steward works from. Paid
// bookings only. Printable (A4) like the member list.

const fmtMoney = (cents) => `$${((cents ?? 0) / 100).toFixed(2)}`;

function PrintStyles() {
  return (
    <style jsx global>{`
      .x-toolbar { max-width: 980px; margin: 0 auto; padding: 14px 18px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .x-toolbar a, .x-toolbar button, .x-toolbar select { text-decoration: none; border: 1px solid #d8d0c3; background: #fff; color: #3A2A1C; border-radius: 7px; padding: 7px 11px; font: 700 12px Archivo, sans-serif; }
      .x-sheet { max-width: 980px; margin: 0 auto 40px; padding: 12mm 10mm; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; box-shadow: 0 12px 30px rgba(42,30,18,.14); }
      .x-sheet h1 { margin: 0; font-size: 16px; font-weight: 800; }
      .x-sheet .sub { margin: 2px 0 12px; font-size: 10.5px; color: #333; }
      .x-sheet h2 { font-size: 13px; margin: 16px 0 4px; border-bottom: 1.5px solid #000; padding-bottom: 3px; }
      .x-sheet h3 { font-size: 11.5px; margin: 10px 0 3px; color: #222; }
      .x-table { width: 100%; border-collapse: collapse; font-size: 10.5px; line-height: 1.3; }
      .x-table th { text-align: left; border-bottom: 1px solid #000; padding: 3px 5px; font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em; }
      .x-table td { border-bottom: 1px solid #ccc; padding: 3px 5px; vertical-align: top; }
      .x-table tr { break-inside: avoid; }
      .x-table .n { width: 36px; text-align: right; font-weight: 700; }
      .x-sheet .foot { margin-top: 10px; font-size: 9px; color: #555; text-align: right; }
      @page { size: A4; margin: 10mm; }
      @media print {
        body { background: #fff !important; }
        .header, .x-toolbar, .bottom-nav, nav { display: none !important; }
        .x-sheet { max-width: none; margin: 0; padding: 0; box-shadow: none; }
        .x-table thead { display: table-header-group; }
      }
      @media screen and (max-width: 760px) { .x-sheet { padding: 16px; } }
    `}</style>
  );
}

function ExtrasListInner() {
  const params = useSearchParams();
  const [session, setSession] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState(params.get("event") || "");
  const [event, setEvent] = useState(null);
  const [extras, setExtras] = useState([]);
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    supabase.from("events").select("id, name, starts_on, event_type, status")
      .neq("status", "archived").order("starts_on", { ascending: false })
      .then(({ data }) => setEvents(data ?? []));
  }, [session]);

  const load = useCallback(async () => {
    if (!session || !eventId) { setBookings(null); return; }
    setError("");
    const [{ data: ev }, { data: ex, error: exErr }] = await Promise.all([
      supabase.from("events").select("*").eq("id", eventId).maybeSingle(),
      supabase.from("event_extras").select("*").eq("event_id", eventId).order("sort_order").order("created_at"),
    ]);
    if (exErr) {
      setError(/does not exist|schema cache/i.test(exErr.message ?? "") ? "Run supabase/schema-v61-event-extras.sql in Supabase first." : exErr.message);
      setBookings([]); return;
    }
    // Bookings of this event's items, plus — for items shared with another
    // event (schema-v62) — that event's bookings of the same yards, so the
    // steward's list covers the whole weekend.
    const ids = (ex ?? []).map((x) => x.id);
    const pools = [...new Set((ex ?? []).map((x) => String(x.pool ?? "").trim()).filter(Boolean))];
    const withPool = "*, event_extras!inner(id, name, unit, pool, event_id), registrations!inner(id, contact_name, contact_email, status, event_id)";
    const noPool = "*, event_extras!inner(id, name, unit, event_id), registrations!inner(id, contact_name, contact_email, status, event_id)";
    let rows = [];
    if (ids.length) {
      let { data, error } = await supabase.from("registration_extras").select(withPool).in("extra_id", ids);
      if (error && /pool/i.test(error.message ?? "")) ({ data, error } = await supabase.from("registration_extras").select(noPool).in("extra_id", ids));
      if (error) { setError(error.message); setBookings([]); return; }
      rows = data ?? [];
    }
    if (pools.length) {
      const { data, error } = await supabase.from("registration_extras").select(withPool).in("event_extras.pool", pools);
      if (!error) for (const r of data ?? []) if (!rows.some((q) => q.id === r.id)) rows.push(r);
    }
    setEvent(ev ?? null);
    setExtras(ex ?? []);
    setBookings(rows.filter((b) => b.registrations?.status === "paid"));
  }, [session, eventId]);
  useEffect(() => { load(); }, [load]);

  if (!session) {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <h1 className="display" style={{ fontWeight: 700, fontSize: 22 }}>Staff only</h1>
        <Link href="/coordinator" style={{ color: "var(--brass)" }}>← Sign in at coordinator dashboard</Link>
      </main>
    );
  }

  const samePool = (x, b) => x.pool && String(b.event_extras?.pool ?? "").trim() === String(x.pool).trim();
  const forExtra = (x) => (bookings ?? []).filter((b) => b.extra_id === x.id || samePool(x, b));
  const eventName = (id) => events.find((e) => e.id === id)?.name ?? "another event";
  const totalBooked = (list) => list.reduce((s, b) => s + (Number(b.quantity) || 0), 0);
  const who = (b) => `${b.registrations?.contact_name ?? "—"}${b.registrations?.contact_email ? ` · ${b.registrations.contact_email}` : ""}`
    + (b.event_extras?.event_id && b.event_extras.event_id !== eventId ? ` (${eventName(b.event_extras.event_id)})` : "");

  return (
    <>
      <PrintStyles />
      <header className="header">
        <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>Coordinator</div>
            <h1 className="display" style={{ fontWeight: 700, fontSize: 22, margin: "2px 0", color: "#F2EADB" }}>Camping &amp; yards bookings</h1>
          </div>
          <Link href="/coordinator" style={{ color: "var(--brass-soft)", fontSize: 13, alignSelf: "center" }}>← Dashboard</Link>
        </div>
      </header>
      <div className="x-toolbar">
        <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
          <option value="">Choose an event…</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.name}{e.starts_on ? ` — ${e.starts_on}` : ""}</option>)}
        </select>
        <button onClick={() => window.print()} disabled={!eventId}>🖨 Print</button>
        <Link href="/coordinator/registrations">Registrations</Link>
      </div>
      {error && <p style={{ maxWidth: 980, margin: "0 auto 10px", padding: "0 18px", color: "var(--clay)", fontWeight: 700 }}>{error}</p>}
      {eventId && bookings && (
        <div className="x-sheet">
          <h1>{event?.name ?? "Event"} — camping &amp; yards</h1>
          <div className="sub">
            {event?.starts_on}{event?.ends_on && event.ends_on !== event.starts_on ? ` to ${event.ends_on}` : ""}{event?.location ? ` · ${event.location}` : ""} · paid bookings only · printed {new Date().toLocaleDateString("en-AU")}
          </div>
          {extras.length === 0 && <p style={{ fontSize: 12 }}>Nothing bookable has been set up for this event yet (dashboard → 🏕 Camping &amp; yards).</p>}
          {extras.map((x) => {
            const list = forExtra(x);
            const nights = extraNights(x, event);
            return (
              <section key={x.id}>
                <h2>
                  {KIND_ICON[x.kind] ?? ""} {x.name} — {priceLabel(x)}
                  {x.capacity != null ? ` · ${x.capacity} available${x.unit === "night" ? " each night" : ""}` : ""}
                  {!x.active ? " · switched off" : ""}
                  {x.pool ? ` · shared: ${x.pool}` : ""}
                </h2>
                {list.length === 0 && <p style={{ fontSize: 11, color: "#555", margin: "4px 0" }}>No bookings yet.</p>}
                {x.unit === "night" ? nights.map((n) => {
                  const rows = list.filter((b) => Array.isArray(b.nights) && b.nights.includes(n));
                  if (!rows.length) return null;
                  const booked = totalBooked(rows);
                  return (
                    <div key={n}>
                      <h3>{nightLabel(n)} — {booked} booked{x.capacity != null ? ` of ${x.capacity}` : ""}</h3>
                      <table className="x-table">
                        <thead><tr><th className="n">Qty</th><th>Who</th><th>Notes</th><th>Paid</th></tr></thead>
                        <tbody>
                          {rows.map((b) => (
                            <tr key={b.id}>
                              <td className="n">{b.quantity}</td>
                              <td>{who(b)}</td>
                              <td>{b.notes ?? ""}</td>
                              <td>{fmtMoney(b.amount_cents)} for {b.nights.length} night{b.nights.length === 1 ? "" : "s"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                }) : list.length > 0 && (
                  <>
                    <h3>{totalBooked(list)} booked{x.capacity != null ? ` of ${x.capacity}` : ""}</h3>
                    <table className="x-table">
                      <thead><tr><th className="n">Qty</th><th>Who</th><th>Notes</th><th>Paid</th></tr></thead>
                      <tbody>
                        {list.map((b) => (
                          <tr key={b.id}>
                            <td className="n">{b.quantity}</td>
                            <td>{who(b)}</td>
                            <td>{b.notes ?? ""}</td>
                            <td>{fmtMoney(b.amount_cents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </section>
            );
          })}
          <div className="foot">HCQHA Live Scoring · hcqha.com</div>
        </div>
      )}
    </>
  );
}

export default function ExtrasListPage() {
  return <Suspense fallback={null}><ExtrasListInner /></Suspense>;
}
