"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import ReadOnlyBanner from "../../components/ReadOnlyBanner";
import { activeSeasons } from "../../../lib/membershipSeason";
import { balanceDueDate, balanceDueLabel } from "../../../lib/clinicPayments";

const fmtMoney = (cents) => (cents != null ? `$${(cents / 100).toFixed(2)}` : "—");
// "AQHA 12345 · PHAA 678" from an entry's stored registration numbers.
// [] = the entrant declared "not registered"; null = collected before this
// feature existed (or a clinic), shown as a dash.
const regNumbersLabel = (list, noneLabel) => {
  if (!Array.isArray(list)) return "—";
  if (!list.length) return noneLabel;
  return list.map((r) => `${r.club} ${r.number}`).join(" · ");
};
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
  const [refunding, setRefunding] = useState(null); // registration id mid-refund
  const [balanceBusy, setBalanceBusy] = useState(null); // reg id mid balance action
  const [refundAmount, setRefundAmount] = useState({}); // reg id -> typed dollars
  const [squareStatus, setSquareStatus] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [squareNotice, setSquareNotice] = useState("");
  // "Why was this entry allowed in?" cross-reference: approved members for the
  // event's season(s), memberships bought on the same Square order (join /
  // renew at checkout), and whether membership is currently required.
  const [approvedEmails, setApprovedEmails] = useState(() => new Set());
  const [checkoutOrderIds, setCheckoutOrderIds] = useState(() => new Set());
  const [membershipRequired, setMembershipRequired] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    supabase
      .from("events")
      .select("id, name, status, starts_on, event_type")
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

  // Work out, for each paid registration, how it satisfied the membership
  // rule. Reads approved members for the event's active season(s) and any
  // membership bought on the same Square order as an entry. Staff-only tables,
  // readable here because this page runs under a signed-in staff session.
  useEffect(() => {
    if (!session || !eventId) return;
    const event = events.find((e) => e.id === eventId);
    if (!event) return;
    let cancelled = false;
    (async () => {
      const seasons = activeSeasons(event.starts_on ? new Date(event.starts_on) : new Date());
      const orderIds = [...new Set(registrations.map((r) => r.square_order_id).filter(Boolean))];
      const [settingRes, approvedRes, checkoutRes] = await Promise.all([
        supabase.from("site_settings").select("value").eq("key", "membership_required").maybeSingle(),
        supabase.from("club_members").select("email").eq("status", "approved").in("season", seasons),
        orderIds.length
          ? supabase.from("club_members").select("square_order_id").in("square_order_id", orderIds)
          : Promise.resolve({ data: [] }),
      ]);
      if (cancelled) return;
      const value = settingRes.data?.value ?? {};
      const required = Boolean(value.enabled) && !(event.event_type === "clinic" && !value.include_clinics);
      setMembershipRequired(required);
      setApprovedEmails(new Set((approvedRes.data ?? []).map((m) => String(m.email ?? "").trim().toLowerCase())));
      setCheckoutOrderIds(new Set((checkoutRes.data ?? []).map((m) => m.square_order_id).filter(Boolean)));
    })();
    return () => { cancelled = true; };
  }, [session, eventId, events, registrations]);

  // Clinic deposit plans (schema-v47): what's still owing on a registration.
  const balanceInfo = (reg) => {
    if (!(reg?.deposit_cents > 0)) return null;
    const owing = Math.max(0, (reg.total_cents ?? 0) - reg.deposit_cents);
    if (owing <= 0) return null;
    const ev = events.find((e) => e.id === eventId);
    const due = balanceDueDate(ev?.starts_on);
    return {
      owing,
      paid: Boolean(reg.balance_paid_at),
      dueLabel: balanceDueLabel(ev?.starts_on),
      overdue: !reg.balance_paid_at && due ? new Date() > due : false,
    };
  };

  const copyBalanceLink = async (reg) => {
    setBalanceBusy(reg.id);
    try {
      const res = await fetch("/api/registrations/pay-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_id: reg.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.checkout_url) {
        window.alert(data.error ?? "Could not create the balance payment link.");
        return;
      }
      try {
        await navigator.clipboard.writeText(data.checkout_url);
        window.alert("Balance payment link copied — paste it into a text or email to " + reg.contact_name + ".");
      } catch {
        window.prompt("Copy the balance payment link:", data.checkout_url);
      }
      await load();
    } finally {
      setBalanceBusy(null);
    }
  };

  const recordBalancePaid = async (reg, info) => {
    if (!window.confirm(`Record ${reg.contact_name}'s ${fmtMoney(info.owing)} balance as paid outside Square (cash / bank transfer)?`)) return;
    setBalanceBusy(reg.id);
    try {
      const { error } = await supabase
        .from("registrations")
        .update({ balance_paid_at: new Date().toISOString() })
        .eq("id", reg.id);
      if (error) { window.alert(error.message); return; }
      await load();
    } finally {
      setBalanceBusy(null);
    }
  };

  // The badge shown on a paid registration explaining why it was allowed in.
  const membershipBadge = (reg) => {
    // Prefer the stamp recorded when the entry was created (schema-v37) — the
    // exact truth, no guessing. Older rows have no stamp and fall through to
    // the live cross-reference below.
    switch (reg.membership_basis) {
      case "member":
        return { label: "Member ✓", bg: "#2D7A52", title: "This email had an approved club membership when they entered." };
      case "annual_join":
        return { label: "Joined at checkout", bg: "#3A6EA5", title: "Bought a club membership as part of this entry — check the Memberships page to approve it if you haven't already." };
      case "renewal":
        return { label: "Renewed at checkout", bg: "#3A6EA5", title: "A signed-in member renewed their membership as part of this entry." };
      case "day_membership":
        return { label: "Day membership", bg: "var(--brass)", title: "Entered with a one-day membership for this event only — this person is not a club member." };
      case "not_required":
        return membershipRequired
          ? { label: "Entered — rule was off", bg: "#8B8073", title: "The membership requirement is on now, but it was switched OFF at the moment this person entered — that's how they got in without a membership." }
          : null;
      default:
        break; // no stamp (entry predates schema-v37) — work it out below
    }
    const email = String(reg.contact_email ?? "").trim().toLowerCase();
    if (approvedEmails.has(email)) {
      return { label: "Member ✓", bg: "#2D7A52", title: "This email has an approved club membership covering this event." };
    }
    if (reg.square_order_id && checkoutOrderIds.has(reg.square_order_id)) {
      return { label: "Joined at checkout", bg: "#3A6EA5", title: "Bought a club membership as part of this entry — check the Memberships page to approve it if you haven't already." };
    }
    if (reg.day_membership) {
      return { label: "Day membership", bg: "var(--brass)", title: "Entered with a one-day membership for this event only — this person is not a club member." };
    }
    if (membershipRequired) {
      return { label: "⚠ No membership on file", bg: "var(--clay)", title: "Membership is required for this event, but this entry has no approved membership, day membership, or checkout join on record. It may have been added by staff or predate the membership rule — worth checking." };
    }
    return null;
  };

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

  const refund = async (reg, refundableCents, { manual = false } = {}) => {
    const dollars = refundAmount[reg.id];
    const cents = Math.round(parseFloat(dollars) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      alert("Enter a refund amount (in dollars).");
      return;
    }
    if (cents > refundableCents) {
      alert(`That's more than is left to refund (${fmtMoney(refundableCents)}).`);
      return;
    }
    const confirmMsg = manual
      ? `Record a ${fmtMoney(cents)} refund for ${reg.contact_name} that you gave OUTSIDE Square (cash, bank transfer, etc.)?\n\nThis does NOT move any money — it just records the refund so your totals are right.`
      : `Refund ${fmtMoney(cents)} to ${reg.contact_name} via Square?\n\nThis sends the money back to their card and can't be undone here. Remember to also Delete or Scratch the affected entry on the dashboard if they're out of a class.`;
    if (!confirm(confirmMsg)) return;
    setRefunding(reg.id);
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch("/api/registrations/refund", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionData?.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ registration_id: reg.id, amount_cents: cents, manual }),
    });
    const data = await res.json();
    if (data.error) alert((manual ? "Could not record refund: " : "Refund not completed: ") + data.error);
    else {
      setRefundAmount((prev) => ({ ...prev, [reg.id]: "" }));
      if (!manual && data.recorded === false) {
        alert("Refunded at Square, but the amount couldn't be recorded in the app — run schema-v36 so it shows here.");
      }
      await load();
    }
    setRefunding(null);
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
  // Net of any refunds issued (refunded_cents is 0/absent before schema-v36).
  // Money actually received: a deposit-plan registration only counts its
  // deposit until the balance is paid (schema-v47).
  const revenue = paid.reduce((s, r) => {
    const received = r.deposit_cents > 0 && !r.balance_paid_at ? r.deposit_cents : (r.total_cents ?? 0);
    return s + received - (r.refunded_cents ?? 0);
  }, 0);
  const balancesOwing = paid.reduce((s, r) =>
    s + (r.deposit_cents > 0 && !r.balance_paid_at ? Math.max(0, (r.total_cents ?? 0) - r.deposit_cents) : 0), 0);
  // Only paid registrations become real entries in the show — pending and
  // cancelled ones must not inflate the count.
  const entryCount = paid.reduce((s, r) => s + (r.registration_entries?.length ?? 0), 0);
  // Count unique PEOPLE (by email), so someone who checks out again to add
  // more classes — a second registration row — isn't counted twice.
  const confirmedPeople = new Set(
    paid.map((r) => String(r.contact_email ?? "").trim().toLowerCase()).filter(Boolean)
  ).size;
  const dayMembershipCount = paid.filter((r) => r.day_membership).length;
  const replacementNumbersCount = paid.filter((r) => r.replacement_numbers).length;
  // Paid entries flagged with no membership on record (only meaningful when
  // membership is required) — the audit number for "how did they get in?".
  const noMembershipCount = membershipRequired
    ? paid.filter((r) => membershipBadge(r)?.label.startsWith("⚠")).length
    : 0;

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
        <ReadOnlyBanner />
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
              { label: "People confirmed", value: confirmedPeople },
              { label: "Pending payment", value: pending.length },
              { label: "Confirmed entries", value: entryCount },
              { label: "Day memberships", value: dayMembershipCount },
              { label: "Replacement numbers", value: replacementNumbersCount },
              ...(membershipRequired ? [{ label: "No membership on file", value: noMembershipCount, warn: noMembershipCount > 0 }] : []),
              { label: "Revenue", value: fmtMoney(revenue) },
              ...(balancesOwing > 0 ? [{ label: "Balances owing", value: fmtMoney(balancesOwing) }] : []),
            ].map((s) => (
              <div key={s.label} className="card" style={{ flex: "1 1 120px", padding: "12px 16px", margin: 0, borderColor: s.warn ? "var(--clay)" : undefined }}>
                <div className="display" style={{ fontWeight: 700, fontSize: 22, color: s.warn ? "var(--clay)" : undefined }}>{s.value}</div>
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
                  {isPaid && (() => {
                    const b = membershipBadge(reg);
                    return b ? (
                      <span
                        title={b.title}
                        style={{ display: "inline-block", marginTop: 5, fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: b.bg, color: "#fff", letterSpacing: ".02em" }}
                      >
                        {b.label}
                      </span>
                    ) : null;
                  })()}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: 14, textDecoration: isCancelled ? "line-through" : "none" }}>{fmtMoney(reg.total_cents)}</span>
                  {isPaid && (() => {
                    const b = balanceInfo(reg);
                    if (!b) return null;
                    return b.paid ? (
                      <span className="badge" style={{ background: "var(--green)" }}>balance paid</span>
                    ) : (
                      <span className="badge" style={{ background: b.overdue ? "var(--clay)" : "#A05000" }}>
                        {b.overdue ? "balance overdue" : `${fmtMoney(b.owing)} owing`}
                      </span>
                    );
                  })()}
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
                          <th>Registration numbers</th>
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
                            <td style={{ fontSize: 12, color: "var(--quiet)", whiteSpace: "nowrap" }}>
                              <div>Horse: {regNumbersLabel(e.horse_registrations, "not registered")}</div>
                              <div>Rider: {regNumbersLabel(e.rider_registrations, "not a member")}</div>
                            </td>
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

                  {isPaid && (() => {
                    const b = balanceInfo(reg);
                    if (!b) return null;
                    return (
                      <div style={{ padding: "10px 12px", marginTop: 10, borderRadius: 10, border: `1px solid ${b.paid ? "var(--line)" : b.overdue ? "var(--clay)" : "#E0B15A"}`, background: b.paid ? "#F4F8F4" : b.overdue ? "#FDEEE9" : "#FFF7D6" }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--leather)" }}>
                          {b.paid
                            ? `✓ Deposit ${fmtMoney(reg.deposit_cents)} + balance ${fmtMoney(b.owing)} both paid.`
                            : `Deposit ${fmtMoney(reg.deposit_cents)} paid (non-refundable) — ${fmtMoney(b.owing)} balance ${b.overdue ? "OVERDUE" : "owing"}${b.dueLabel ? `, due by ${b.dueLabel}` : ""}.`}
                        </div>
                        {!b.paid && (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                            <button className="btn-ghost" style={{ fontSize: 12 }} disabled={balanceBusy === reg.id}
                              onClick={() => copyBalanceLink(reg)}>
                              {balanceBusy === reg.id ? "Working…" : "Copy balance payment link"}
                            </button>
                            <button className="btn-ghost" style={{ fontSize: 12 }} disabled={balanceBusy === reg.id}
                              onClick={() => recordBalancePaid(reg, b)}>
                              Record balance paid outside Square
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {isPaid && (() => {
                    const refundedCents = reg.refunded_cents ?? 0;
                    const refundableCents = (reg.total_cents ?? 0) - refundedCents;
                    const hasSquarePayment = Boolean(reg.square_payment_id);
                    const canRefund = refundableCents > 0;
                    return (
                      <div style={{ padding: "12px 0 0", borderTop: "1px solid var(--line)", marginTop: 10 }}>
                        {refundedCents > 0 && (
                          <p style={{ fontSize: 12.5, color: "var(--clay)", fontWeight: 700, margin: "0 0 8px" }}>
                            Refunded so far: {fmtMoney(refundedCents)}{refundableCents > 0 ? ` of ${fmtMoney(reg.total_cents)}` : " (fully refunded)"}.
                          </p>
                        )}
                        {canRefund && (
                          <>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <span style={{ fontSize: 12.5, color: "var(--quiet)" }}>Refund</span>
                              <span style={{ fontWeight: 700 }}>$</span>
                              <input
                                type="number" min="0" step="0.50"
                                className="field"
                                style={{ width: 90, fontSize: 14, padding: "6px 8px" }}
                                placeholder={(refundableCents / 100).toFixed(2)}
                                value={refundAmount[reg.id] ?? ""}
                                onChange={(e) => setRefundAmount((prev) => ({ ...prev, [reg.id]: e.target.value }))}
                              />
                              <button
                                className="btn-ghost"
                                style={{ fontSize: 12 }}
                                onClick={() => setRefundAmount((prev) => ({ ...prev, [reg.id]: (refundableCents / 100).toFixed(2) }))}
                                disabled={refunding === reg.id}
                              >
                                Full ({fmtMoney(refundableCents)})
                              </button>
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                              {hasSquarePayment && (
                                <button
                                  className="btn-ghost"
                                  style={{ fontSize: 12, color: "var(--clay)", borderColor: "var(--clay)" }}
                                  onClick={() => refund(reg, refundableCents)}
                                  disabled={refunding === reg.id}
                                >
                                  {refunding === reg.id ? "Working…" : "Refund via Square"}
                                </button>
                              )}
                              <button
                                className="btn-ghost"
                                style={{ fontSize: 12 }}
                                onClick={() => refund(reg, refundableCents, { manual: true })}
                                disabled={refunding === reg.id}
                                title="Record a refund you already gave by cash, bank transfer, etc."
                              >
                                {refunding === reg.id ? "Working…" : "Record refund given outside Square"}
                              </button>
                            </div>
                          </>
                        )}
                        {!hasSquarePayment && canRefund && (
                          <p style={{ fontSize: 11.5, color: "var(--quiet)", margin: "8px 0 0" }}>
                            No Square payment on file, so this can only be recorded as a refund given outside Square.
                          </p>
                        )}
                        <p style={{ fontSize: 11.5, color: "var(--quiet)", margin: "8px 0 0" }}>
                          A Square refund sends money back to the card; recording an outside refund just logs it. Removing an entry from a class is separate — Delete or Scratch it on the dashboard.
                        </p>
                      </div>
                    );
                  })()}
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
