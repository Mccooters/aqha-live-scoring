"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import ReadOnlyBanner from "../../components/ReadOnlyBanner";
import { balancePaidCents } from "../../../lib/clinicPayments";

// Staff: the club's revenue, month by month (owner's request, Oct 2026).
// Every payment the club has received through the site — show entries,
// clinic bookings (deposits and balances), camping & yards, day memberships,
// event fees, annual memberships, raffle tickets — plus cash / transfer
// amounts staff recorded by hand, and refunds taken off. Nothing here is a
// new record: it is read straight from registrations, club_members and
// raffle_orders. Months use Sydney time. Dates come from paid_at
// (schema-v67) and fall back to the created / approved dates before that.

const SYD = "Australia/Sydney";
const monthKeyOf = (iso) => {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: SYD, year: "numeric", month: "2-digit" }).formatToParts(new Date(iso));
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}`;
};
const monthLabel = (key, short = false) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-AU", { month: short ? "short" : "long", year: short ? "2-digit" : "numeric", timeZone: "UTC" });
};
const fmtDay = (iso) => new Date(iso).toLocaleDateString("en-AU", { timeZone: SYD, day: "2-digit", month: "short", year: "numeric" });
const fmtMoney = (cents) => { const n = (cents ?? 0) / 100; return `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`; };

// Where the money came from. Order = how the breakdown is listed.
const KINDS = [
  ["entries",     "Show entries"],
  ["clinic",      "Clinic bookings"],
  ["balance",     "Clinic balances"],
  ["extras",      "Camping & yards"],
  ["event_fees",  "Ground / admin fees"],
  ["day_member",  "Day memberships"],
  ["numbers",     "Replacement numbers"],
  ["membership",  "Memberships"],
  ["raffle",      "Raffle tickets"],
  ["refund",      "Refunds"],
];
const KIND_LABEL = Object.fromEntries(KINDS);
const VIA = { square: "Square", paypal: "PayPal", manual: "Cash / transfer", credit: "Club credit", free: "Free" };
const viaOf = (provider, manual) => (manual ? "manual" : provider === "credit" ? "credit" : provider === "paypal" ? "paypal" : "square");

// Turn the raw rows into one line per payment received (or refund given).
function buildLines({ registrations, members, raffleOrders }) {
  const lines = [];
  const push = (l) => { if (l.at && l.amount_cents) lines.push(l); };

  for (const r of registrations) {
    const ev = r.event ?? {};
    const isClinic = ev.event_type === "clinic";
    const who = r.contact_name ?? "";
    const where = ev.name ?? "Event";
    const total = r.total_cents ?? 0;
    const paidAt = r.paid_at ?? r.created_at;
    const onlineVia = total > 0 ? viaOf(r.payment_provider) : "free";
    const extras = (r.registration_extras ?? []).reduce((s, x) => s + (x.amount_cents ?? 0), 0);
    const fees = r.fees_cents ?? 0;
    const day = r.day_membership ? (r.day_membership_cents ?? 0) : 0;
    const numbers = r.replacement_numbers ? (r.replacement_numbers_cents ?? 0) : 0;
    const depositPlan = r.deposit_cents > 0;

    if (r.status === "paid") {
      // The first payment: everything, or (deposit plan) the deposits plus
      // the add-ons that are always charged up front.
      let firstPayment = depositPlan ? Math.min(total, r.deposit_cents) : total;
      // Club credit (schema-v68) that paid part of the first payment is shown
      // under "Club credit", so the Square / PayPal totals match the money
      // that actually arrived.
      let creditLeft = Math.min(firstPayment, Math.max(0, Number(r.credit_cents) || 0));
      const pushPaid = (line) => {
        const fromCredit = Math.min(creditLeft, line.amount_cents);
        creditLeft -= fromCredit;
        if (fromCredit > 0) push({ ...line, amount_cents: fromCredit, via: "credit", note: `${line.note} (club credit)` });
        if (line.amount_cents - fromCredit > 0) push({ ...line, amount_cents: line.amount_cents - fromCredit });
      };
      const parts = [
        ["extras", extras], ["event_fees", fees], ["day_member", day], ["numbers", numbers],
      ];
      for (const [kind, cents] of parts) {
        const c = Math.min(cents, firstPayment);
        if (c > 0) pushPaid({ at: paidAt, kind, amount_cents: c, via: onlineVia, who, where, note: KIND_LABEL[kind] });
        firstPayment -= c;
      }
      if (firstPayment > 0) {
        pushPaid({
          at: paidAt, kind: isClinic ? "clinic" : "entries", amount_cents: firstPayment, via: onlineVia, who, where,
          note: depositPlan ? "Deposit" : (isClinic ? "Booking" : `${(r.registration_entries ?? []).length || ""} ${(r.registration_entries ?? []).length === 1 ? "entry" : "entries"}`.trim()),
        });
      }
      // Balance payments on a deposit plan (schema-v50 log; or the single
      // all-at-once balance recorded before that log existed).
      if (depositPlan) {
        const log = Array.isArray(r.balance_payments) ? r.balance_payments : [];
        for (const p of log) {
          push({ at: p.at ?? r.balance_paid_at ?? paidAt, kind: "balance", amount_cents: Number(p.amount_cents) || 0, via: viaOf(p.method, p.method === "manual"), who, where, note: "Balance payment" });
        }
        const owedFull = Math.max(0, total - r.deposit_cents);
        const logged = balancePaidCents(r);
        if (r.balance_paid_at && logged < owedFull) {
          push({ at: r.balance_paid_at, kind: "balance", amount_cents: owedFull - logged, via: viaOf(r.balance_payment_provider ?? r.payment_provider), who, where, note: "Balance paid" });
        }
      }
    }
    // Refunds (any status — a cancelled registration can still have been
    // refunded). Each logged refund has its own date; anything refunded
    // before the log existed (pre-v52) is dated with the payment.
    const refunds = Array.isArray(r.refund_log) ? r.refund_log : [];
    let loggedRefunds = 0;
    for (const f of refunds) {
      const c = Number(f.amount_cents) || 0;
      loggedRefunds += c;
      push({ at: f.at ?? paidAt, kind: "refund", amount_cents: -c, via: viaOf(f.method, f.method === "manual"), who, where, note: f.reason ? `Refund — ${f.reason}` : "Refund" });
    }
    const unlogged = (r.refunded_cents ?? 0) - loggedRefunds;
    if (unlogged > 0) push({ at: paidAt, kind: "refund", amount_cents: -unlogged, via: viaOf(r.payment_provider), who, where, note: "Refund (date not recorded — dated with the payment)" });
  }

  for (const m of members) {
    if (!["paid", "approved"].includes(m.status) || !(m.total_cents > 0)) continue;
    const online = Boolean(m.square_order_id);
    const at = m.paid_at ?? (online ? m.created_at : (m.approved_at ?? m.created_at));
    push({
      at, kind: "membership", amount_cents: m.total_cents, via: online ? viaOf(m.payment_provider) : "manual",
      who: m.member_name ?? "", where: m.season ? `${m.season} season` : "", note: m.membership_type_name ?? "Membership",
    });
  }

  for (const o of raffleOrders) {
    if (o.status !== "paid" || !(o.total_cents > 0)) continue;
    const n = Array.isArray(o.numbers) ? o.numbers.length : 0;
    push({
      at: o.paid_at ?? o.created_at, kind: "raffle", amount_cents: o.total_cents, via: o.method === "manual" ? "manual" : viaOf(o.payment_provider),
      who: o.buyer_name ?? "", where: o.raffle?.name ?? "Raffle", note: n ? `${n} ticket${n === 1 ? "" : "s"}` : "Tickets",
    });
  }

  return lines.sort((a, b) => new Date(a.at) - new Date(b.at));
}

const sumBy = (lines, keyFn) => {
  const out = {};
  for (const l of lines) { const k = keyFn(l); out[k] = (out[k] ?? 0) + l.amount_cents; }
  return out;
};
const total = (lines) => lines.reduce((s, l) => s + l.amount_cents, 0);

function Styles() {
  return (
    <style jsx global>{`
      .rev-sheet { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 22px 24px; }
      .rev-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .rev-table th { text-align: left; border-bottom: 1.5px solid var(--leather); padding: 6px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--quiet); }
      .rev-table td { border-bottom: 1px solid var(--line); padding: 7px 6px; vertical-align: top; }
      .rev-table .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .rev-table tfoot td { font-weight: 800; border-bottom: none; border-top: 2px solid var(--leather); }
      .rev-table tr.clickable { cursor: pointer; }
      .rev-table tr.clickable:hover td { background: var(--paper); }
      .rev-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 0 0 18px; }
      .rev-stat { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; background: var(--paper); }
      .rev-stat .k { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--quiet); }
      .rev-stat .v { font-family: 'Zilla Slab', serif; font-size: 22px; font-weight: 700; color: var(--leather); }
      .rev-wide { overflow-x: auto; }
      @page { size: A4 landscape; margin: 12mm; }
      @media print {
        body { background: #fff !important; }
        .header, .bottom-nav, nav, .no-print { display: none !important; }
        .wrap { padding: 0; max-width: none; }
        .hp-layout { display: block; }
        .rev-sheet { border: none; border-radius: 0; padding: 0; }
        .rev-table { font-size: 11px; }
        .rev-table thead { display: table-header-group; }
        .rev-table tr { break-inside: avoid; }
      }
      @media screen and (max-width: 760px) { .rev-sheet { padding: 14px; } }
    `}</style>
  );
}

export default function RevenuePage() {
  const [session, setSession] = useState(null);
  const [data, setData] = useState(null);     // { registrations, members, raffleOrders }
  const [missing, setMissing] = useState([]); // tables the database doesn't have yet
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("all");
  const [hasPaidAt, setHasPaidAt] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: d }) => setSession(d.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    setError("");
    const gone = [];
    const isMissing = (err) => /does not exist|schema cache|relation/i.test(err?.message ?? "");

    let regs = await supabase.from("registrations")
      .select("*, event:events(name, event_type, starts_on), registration_entries(id), registration_extras(amount_cents)")
      .in("status", ["paid", "cancelled"]);
    if (regs.error && /registration_extras|event_extras/i.test(`${regs.error.message ?? ""} ${regs.error.details ?? ""}`)) {
      regs = await supabase.from("registrations")
        .select("*, event:events(name, event_type, starts_on), registration_entries(id)")
        .in("status", ["paid", "cancelled"]);
    }
    if (regs.error) { setError(regs.error.message); setData({ registrations: [], members: [], raffleOrders: [] }); return; }
    setHasPaidAt(!regs.data?.length || "paid_at" in regs.data[0]);

    const mem = await supabase.from("club_members").select("*").in("status", ["paid", "approved"]);
    if (mem.error && !isMissing(mem.error)) { setError(mem.error.message); }
    if (mem.error && isMissing(mem.error)) gone.push("memberships (schema-v23)");

    const raf = await supabase.from("raffle_orders").select("*, raffle:raffles(name)").eq("status", "paid");
    if (raf.error && isMissing(raf.error)) gone.push("raffles (schema-v56)");
    else if (raf.error) setError(raf.error.message);

    setMissing(gone);
    setData({ registrations: regs.data ?? [], members: mem.data ?? [], raffleOrders: raf.data ?? [] });
  }, [session]);
  useEffect(() => { load(); }, [load]);

  const lines = useMemo(() => (data ? buildLines(data) : []), [data]);
  const byMonth = useMemo(() => {
    const out = {};
    for (const l of lines) { const k = monthKeyOf(l.at); (out[k] ??= []).push(l); }
    return out;
  }, [lines]);
  const thisMonth = monthKeyOf(new Date().toISOString());
  const monthKeys = useMemo(() => [...new Set([thisMonth, ...Object.keys(byMonth)])].sort().reverse(), [byMonth, thisMonth]);
  const shown = selected === "all" ? lines : (byMonth[selected] ?? []);
  const kindsUsed = KINDS.filter(([k]) => lines.some((l) => l.kind === k));
  const monthKindTotals = useMemo(() => {
    const out = {};
    for (const k of monthKeys) out[k] = sumBy(byMonth[k] ?? [], (l) => l.kind);
    return out;
  }, [byMonth, monthKeys]);
  const shownByKind = sumBy(shown, (l) => l.kind);
  const shownByVia = sumBy(shown, (l) => l.via);
  const shownByEvent = sumBy(shown.filter((l) => l.where), (l) => l.where);
  const grand = total(shown);
  const received = total(shown.filter((l) => l.amount_cents > 0));
  const refunded = -total(shown.filter((l) => l.amount_cents < 0));

  const downloadCsv = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Date", "Type", "What", "Who", "Event / raffle / season", "Paid via", "Amount"];
    const body = shown.map((l) => [fmtDay(l.at), KIND_LABEL[l.kind] ?? l.kind, l.note ?? "", l.who, l.where, VIA[l.via] ?? l.via, (l.amount_cents / 100).toFixed(2)]);
    const rowsOut = [head, ...body, [], ["Total", "", "", "", "", "", (grand / 100).toFixed(2)]];
    const csv = rowsOut.map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `revenue-${selected}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (!session) {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <h1 className="display" style={{ fontWeight: 700, fontSize: 22 }}>Staff only</h1>
        <Link href="/coordinator" style={{ color: "var(--brass)" }}>← Sign in at coordinator dashboard</Link>
      </main>
    );
  }

  const title = selected === "all" ? "All months" : monthLabel(selected);

  return (
    <>
      <Styles />
      <header className="header">
        <div style={{ maxWidth: 1040, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>Coordinator</div>
            <h1 className="display" style={{ fontWeight: 700, fontSize: 22, margin: "2px 0", color: "#F2EADB" }}>Revenue</h1>
          </div>
          <Link href="/coordinator" style={{ color: "var(--brass-soft)", fontSize: 13, alignSelf: "center" }}>← Dashboard</Link>
        </div>
      </header>
      <main className="wrap" style={{ maxWidth: 1040 }}>
        <div className="no-print"><ReadOnlyBanner /></div>
        <p className="no-print" style={{ fontSize: 13.5, color: "var(--quiet)", marginTop: 0 }}>
          Everything the club has been paid through the site, month by month — show entries, clinic bookings and balances,
          camping &amp; yards, memberships and raffle tickets, including cash and bank-transfer amounts staff recorded by hand.
          Refunds are taken off in the month they were given. Online payments are shown at the amount the person paid;
          Square and PayPal processing fees are not deducted here.
        </p>
        {!hasPaidAt && (
          <div className="no-print card" style={{ padding: "10px 14px", border: "1px solid #E0B15A", background: "#FFF7D6" }}>
            <p style={{ margin: 0, fontSize: 13 }}>
              <strong>Database update needed:</strong> run <code>supabase/schema-v67-paid-at.sql</code> in the Supabase SQL Editor so
              each payment is dated when it was received. Until then entries and memberships are dated when they were created.
            </p>
          </div>
        )}
        {missing.length > 0 && (
          <p className="no-print" style={{ fontSize: 12.5, color: "var(--quiet)" }}>Not included yet (database update not run): {missing.join(", ")}.</p>
        )}
        {error && <p style={{ color: "var(--clay)", fontWeight: 700 }}>{error}</p>}

        <div className="hp-layout">
          <aside className="hp-seasons no-print">
            <div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--quiet)", fontWeight: 800 }}>Months</div>
            {[["all", "All months", total(lines)], ...monthKeys.map((k) => [k, monthLabel(k), total(byMonth[k] ?? [])])].map(([k, label, cents]) => {
              const active = selected === k;
              return (
                <button key={k} type="button" className="hp-season-btn" onClick={() => setSelected(k)}
                  style={{
                    border: `2px solid ${active ? "var(--leather)" : "var(--line)"}`,
                    background: active ? "var(--leather)" : "#fff",
                    color: active ? "#F2EADB" : "var(--ink)",
                  }}>
                  <span className="display" style={{ fontWeight: 700, fontSize: 15 }}>{label}</span>
                  <span style={{ display: "block", fontSize: 11, color: active ? "var(--brass-soft)" : "var(--quiet)", marginTop: 1 }}>{fmtMoney(cents)}</span>
                </button>
              );
            })}
          </aside>

          <section className="rev-sheet">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              <h2 className="display" style={{ margin: 0, fontSize: 24 }}>{title}</h2>
              <div className="no-print" style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => window.print()}>🖨 Print</button>
                <button type="button" className="btn-ghost" onClick={downloadCsv} disabled={!shown.length}>⇩ CSV</button>
              </div>
            </div>

            {!data ? (
              <p style={{ color: "var(--quiet)" }}>Loading…</p>
            ) : (
              <>
                <div className="rev-stats">
                  <div className="rev-stat"><div className="k">Net revenue</div><div className="v">{fmtMoney(grand)}</div></div>
                  <div className="rev-stat"><div className="k">Received</div><div className="v">{fmtMoney(received)}</div></div>
                  <div className="rev-stat"><div className="k">Refunded</div><div className="v">{fmtMoney(refunded)}</div></div>
                  <div className="rev-stat"><div className="k">Payments</div><div className="v">{shown.filter((l) => l.amount_cents > 0).length}</div></div>
                </div>

                {selected === "all" ? (
                  <>
                    <h3 style={{ fontSize: 14, margin: "6px 0 8px" }}>Month by month</h3>
                    <div className="rev-wide">
                      <table className="rev-table">
                        <thead>
                          <tr>
                            <th>Month</th>
                            {kindsUsed.map(([k, label]) => <th key={k} className="num">{label}</th>)}
                            <th className="num">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthKeys.map((k) => (
                            <tr key={k} className="clickable" onClick={() => setSelected(k)} title="Show this month">
                              <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{monthLabel(k, true)}</td>
                              {kindsUsed.map(([kind]) => (
                                <td key={kind} className="num" style={{ color: monthKindTotals[k][kind] ? "inherit" : "var(--line)" }}>
                                  {monthKindTotals[k][kind] ? fmtMoney(monthKindTotals[k][kind]) : "–"}
                                </td>
                              ))}
                              <td className="num" style={{ fontWeight: 800 }}>{fmtMoney(total(byMonth[k] ?? []))}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td>Total</td>
                            {kindsUsed.map(([kind]) => <td key={kind} className="num">{fmtMoney(shownByKind[kind] ?? 0)}</td>)}
                            <td className="num">{fmtMoney(grand)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    {!lines.length && <p style={{ color: "var(--quiet)" }}>No payments recorded yet.</p>}
                  </>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18, marginBottom: 18 }}>
                      <div>
                        <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>By type</h3>
                        <table className="rev-table">
                          <tbody>
                            {KINDS.filter(([k]) => shownByKind[k]).map(([k, label]) => (
                              <tr key={k}><td>{label}</td><td className="num">{fmtMoney(shownByKind[k])}</td></tr>
                            ))}
                          </tbody>
                          <tfoot><tr><td>Total</td><td className="num">{fmtMoney(grand)}</td></tr></tfoot>
                        </table>
                      </div>
                      <div>
                        <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>By payment method</h3>
                        <table className="rev-table">
                          <tbody>
                            {Object.entries(shownByVia).map(([v, c]) => (
                              <tr key={v}><td>{VIA[v] ?? v}</td><td className="num">{fmtMoney(c)}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {Object.keys(shownByEvent).length > 0 && (
                        <div>
                          <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>By event / raffle / season</h3>
                          <table className="rev-table">
                            <tbody>
                              {Object.entries(shownByEvent).sort((a, b) => b[1] - a[1]).map(([w, c]) => (
                                <tr key={w}><td>{w}</td><td className="num">{fmtMoney(c)}</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    <h3 style={{ fontSize: 14, margin: "6px 0 8px" }}>Every payment</h3>
                    <div className="rev-wide">
                      <table className="rev-table">
                        <thead>
                          <tr><th>Date</th><th>Type</th><th>What</th><th>Who</th><th>Event / raffle / season</th><th>Paid via</th><th className="num">Amount</th></tr>
                        </thead>
                        <tbody>
                          {shown.map((l, i) => (
                            <tr key={i} style={l.amount_cents < 0 ? { color: "var(--clay)" } : undefined}>
                              <td style={{ whiteSpace: "nowrap" }}>{fmtDay(l.at)}</td>
                              <td>{KIND_LABEL[l.kind] ?? l.kind}</td>
                              <td>{l.note}</td>
                              <td>{l.who}</td>
                              <td>{l.where}</td>
                              <td>{VIA[l.via] ?? l.via}</td>
                              <td className="num">{fmtMoney(l.amount_cents)}</td>
                            </tr>
                          ))}
                          {!shown.length && <tr><td colSpan={7} style={{ color: "var(--quiet)" }}>No payments this month.</td></tr>}
                        </tbody>
                        <tfoot><tr><td colSpan={6}>Total</td><td className="num">{fmtMoney(grand)}</td></tr></tfoot>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
