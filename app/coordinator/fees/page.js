"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import ReadOnlyBanner from "../../components/ReadOnlyBanner";

// Staff: the website fees statement (schema-v60). Every online payment
// (Square or PayPal) leaves a line in website_fees with the fee it earned;
// this page groups the lines by month (Sydney time) into a statement the
// site's developer bills the club with — instead of the old Square app fee
// that was taken out of each payment (owner's decision, Oct 2026).

const SYD = "Australia/Sydney";
const monthKeyOf = (iso) => {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: SYD, year: "numeric", month: "2-digit" }).formatToParts(new Date(iso));
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}`;
};
const monthLabel = (key) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });
};
const todaySydney = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: SYD, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const fmtDay = (iso) => new Date(iso).toLocaleDateString("en-AU", { timeZone: SYD, day: "2-digit", month: "short", year: "numeric" });
const fmtMoney = (cents) => { const n = (cents ?? 0) / 100; return `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`; };
const fmtPct = (bps) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
const PROVIDER = { square: "Square", paypal: "PayPal", manual: "By hand" };
const KIND = { entry: "Entries", balance: "Clinic balance", membership: "Membership", raffle: "Raffle tickets", refund: "Refund / credit", other: "Other" };
const STATUS = {
  open:   { label: "Open",   color: "var(--quiet)" },
  billed: { label: "Billed", color: "#B5651D" },
  paid:   { label: "Paid",   color: "#2D7A52" },
};

function summarise(lines) {
  const t = { amount: 0, fee: 0, percent: 0, flat: 0, count: 0, byProvider: {} };
  for (const l of lines) {
    t.amount += l.amount_cents ?? 0;
    t.fee += l.fee_cents ?? 0;
    t.percent += l.percent_fee_cents ?? 0;
    t.flat += l.flat_fee_cents ?? 0;
    if ((l.amount_cents ?? 0) > 0) {
      t.count += 1;
      t.byProvider[l.provider] = (t.byProvider[l.provider] ?? 0) + 1;
    }
  }
  return t;
}

function PrintStyles() {
  return (
    <style jsx global>{`
      .fee-sheet { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 22px 24px; }
      .fee-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .fee-table th { text-align: left; border-bottom: 1.5px solid var(--leather); padding: 6px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--quiet); }
      .fee-table td { border-bottom: 1px solid var(--line); padding: 7px 6px; vertical-align: top; }
      .fee-table .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .fee-table tfoot td { font-weight: 800; border-bottom: none; border-top: 2px solid var(--leather); }
      .fee-form label { display: grid; gap: 4px; font-size: 12px; font-weight: 700; color: var(--quiet); }
      .fee-form .field { font-size: 14px; padding: 8px 10px; width: 100%; box-sizing: border-box; }
      @page { size: A4; margin: 12mm; }
      @media print {
        body { background: #fff !important; }
        .header, .bottom-nav, nav, .no-print { display: none !important; }
        .wrap { padding: 0; max-width: none; }
        .hp-layout { display: block; }
        .fee-sheet { border: none; border-radius: 0; padding: 0; }
        .fee-table { font-size: 11.5px; }
        .fee-table thead { display: table-header-group; }
        .fee-table tr { break-inside: avoid; }
      }
      @media screen and (max-width: 760px) { .fee-sheet { padding: 14px; } }
    `}</style>
  );
}

export default function WebsiteFeesPage() {
  const [session, setSession] = useState(null);
  const [rows, setRows] = useState(null);       // every ledger line
  const [months, setMonths] = useState([]);     // website_fee_months (billed / paid status)
  const [rates, setRates] = useState(null);     // rates in use, from /api/health
  const [selected, setSelected] = useState(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);       // "add a line by hand"
  const [noteDraft, setNoteDraft] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    const { data, error: err } = await supabase.from("website_fees").select("*").order("paid_at", { ascending: true });
    if (err) {
      if (/does not exist|schema cache/i.test(err.message ?? "")) setTableMissing(true);
      else setError(err.message);
      setRows([]);
      return;
    }
    setRows(data ?? []);
    const { data: m } = await supabase.from("website_fee_months").select("*");
    setMonths(m ?? []);
  }, [session]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/health", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((d) => setRates(d.website_fee ?? { configured: false, bps: 0, flat_cents: 0 }))
      .catch(() => setRates(null));
  }, [session]);

  const thisMonth = monthKeyOf(new Date().toISOString());
  const current = selected ?? thisMonth;
  const monthKeys = useMemo(() => {
    const keys = new Set([thisMonth, ...(rows ?? []).map((r) => monthKeyOf(r.paid_at)), ...months.map((m) => m.month)]);
    return [...keys].sort().reverse();
  }, [rows, months, thisMonth]);
  const lines = useMemo(() => (rows ?? []).filter((r) => monthKeyOf(r.paid_at) === current), [rows, current]);
  const totals = useMemo(() => summarise(lines), [lines]);
  const monthTotals = useMemo(() => {
    const t = {};
    for (const r of rows ?? []) { const k = monthKeyOf(r.paid_at); t[k] = (t[k] ?? 0) + (r.fee_cents ?? 0); }
    return t;
  }, [rows]);
  const statusOf = (key) => months.find((m) => m.month === key)?.status ?? "open";
  const monthRow = months.find((m) => m.month === current) ?? null;
  useEffect(() => { setNoteDraft(monthRow?.note ?? ""); }, [monthRow?.note, current]);

  const saveMonth = async (patch) => {
    setBusy(true); setError("");
    const { error: err } = await supabase
      .from("website_fee_months")
      .upsert({ month: current, ...patch, updated_at: new Date().toISOString() }, { onConflict: "month" });
    if (err) setError(err.message); else await load();
    setBusy(false);
  };
  const setStatus = (status) => {
    const now = new Date().toISOString();
    if (status === "billed") return saveMonth({ status, billed_at: now, paid_at: null });
    if (status === "paid") return saveMonth({ status, paid_at: now, billed_at: monthRow?.billed_at ?? now });
    return saveMonth({ status: "open", billed_at: null, paid_at: null });
  };
  const saveNote = () => {
    if ((monthRow?.note ?? "") === noteDraft.trim()) return;
    return saveMonth({ note: noteDraft.trim() || null, status: monthRow?.status ?? "open" });
  };

  const feeFor = (amountStr) => {
    const cents = Math.round(Number(amountStr) * 100);
    if (!Number.isFinite(cents) || !rates || !(rates.bps > 0)) return "";
    const pct = Math.round((Math.abs(cents) * rates.bps) / 10000) * (cents < 0 ? -1 : 1);
    return (pct / 100).toFixed(2);
  };
  const openAdd = () => {
    setError("");
    setForm({ date: todaySydney(), description: "", payer: "", provider: "square", amount: "", fee: "", note: "" });
  };
  const submitAdd = async (e) => {
    e.preventDefault();
    const amountCents = Math.round(Number(form.amount) * 100);
    const feeCents = Math.round(Number(form.fee || 0) * 100);
    if (!form.description.trim() || !form.date || !Number.isFinite(amountCents) || !Number.isFinite(feeCents)) {
      setError("Give the line a date, a description, an amount and a fee.");
      return;
    }
    setBusy(true); setError("");
    const { error: err } = await supabase.from("website_fees").insert({
      paid_at: new Date(`${form.date}T12:00:00+10:00`).toISOString(),
      provider: form.provider,
      payment_id: null,
      kind: amountCents < 0 ? "refund" : "other",
      description: form.description.trim(),
      payer_name: form.payer.trim() || null,
      amount_cents: amountCents,
      percent_bps: rates?.bps ?? 0,
      percent_fee_cents: feeCents,
      flat_fee_cents: 0,
      fee_cents: feeCents,
      note: form.note.trim() || null,
      added_by: session.user?.email ?? "staff",
    });
    if (err) setError(err.message);
    else { setForm(null); setSelected(monthKeyOf(`${form.date}T12:00:00+10:00`)); await load(); }
    setBusy(false);
  };
  const removeLine = async (line) => {
    const ok = window.confirm(
      `Remove this by-hand line?\n\n${fmtDay(line.paid_at)} — ${line.description} — fee ${fmtMoney(line.fee_cents)}\n\nOnly lines added by hand can be removed. This can't be undone.`
    );
    if (!ok) return;
    setBusy(true); setError("");
    const { error: err } = await supabase.from("website_fees").delete().eq("id", line.id);
    if (err) setError(err.message); else await load();
    setBusy(false);
  };

  const downloadCsv = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Date", "What", "Who paid", "Paid via", "Type", "Amount paid", "Fee", "Note"];
    const body = lines.map((l) => [
      fmtDay(l.paid_at), l.description, l.payer_name ?? "", PROVIDER[l.provider] ?? l.provider, KIND[l.kind] ?? l.kind,
      ((l.amount_cents ?? 0) / 100).toFixed(2), ((l.fee_cents ?? 0) / 100).toFixed(2), l.note ?? "",
    ]);
    const rowsOut = [head, ...body, [], ["Total", "", "", "", "", (totals.amount / 100).toFixed(2), (totals.fee / 100).toFixed(2), ""]];
    const csv = rowsOut.map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `website-fees-${current}.csv`;
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

  const st = statusOf(current);
  const rateText = rates?.configured
    ? [
      rates.bps > 0 ? `${fmtPct(rates.bps)} of each online payment` : null,
      rates.flat_cents > 0 ? `${fmtMoney(rates.flat_cents)} once per person per event (from the admin fee)` : null,
    ].filter(Boolean).join(" + ")
    : null;

  return (
    <>
      <PrintStyles />
      <header className="header">
        <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>Coordinator</div>
            <h1 className="display" style={{ fontWeight: 700, fontSize: 22, margin: "2px 0", color: "#F2EADB" }}>Website fees</h1>
          </div>
          <Link href="/coordinator" style={{ color: "var(--brass-soft)", fontSize: 13, alignSelf: "center" }}>← Dashboard</Link>
        </div>
      </header>
      <main className="wrap" style={{ maxWidth: 980 }}>
        <div className="no-print"><ReadOnlyBanner /></div>
        <p className="no-print" style={{ fontSize: 13.5, color: "var(--quiet)", marginTop: 0 }}>
          Every online payment (Square and PayPal) adds a line here with the website fee it earned — nothing is taken out of
          the club&apos;s payments any more. Pick a month, print or download its statement, then mark it billed and paid as the
          invoice goes out and gets settled.
        </p>

        {tableMissing && (
          <section className="card" style={{ padding: 16, borderColor: "var(--clay)" }}>
            <div style={{ fontWeight: 800, color: "var(--clay)", marginBottom: 6 }}>The website fees table hasn&apos;t been created yet</div>
            <p style={{ margin: 0, fontSize: 13.5 }}>
              Run <code>supabase/schema-v60-website-fees.sql</code> in the Supabase SQL editor, then reload this page. Until
              then no fee lines are being recorded.
            </p>
          </section>
        )}
        {!tableMissing && rates && !rates.configured && (
          <section className="card no-print" style={{ padding: "12px 16px", border: "1px solid #E0B15A", background: "#FFF7D6" }}>
            <div style={{ fontWeight: 800, color: "var(--leather)" }}>⚠ No website fee rate is set, so new payments are not adding fee lines.</div>
            <p style={{ margin: "4px 0 0", fontSize: 13 }}>
              In Vercel add <code>WEBSITE_FEE_BPS</code> (e.g. 50 = 0.5% of each online payment) and/or <code>WEBSITE_FEE_FLAT_CENTS</code>{" "}
              (e.g. 500 = $5 once per person per event), then redeploy. The old <code>SQUARE_APP_FEE_BPS</code> / <code>SQUARE_APP_FLAT_FEE_CENTS</code> names still work too.
            </p>
          </section>
        )}
        {error && <p className="no-print" style={{ color: "var(--clay)", fontWeight: 700 }}>{error}</p>}

        {!tableMissing && (
          <div className="hp-layout">
            <aside className="hp-seasons no-print">
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--quiet)" }}>Months</div>
              {monthKeys.map((k) => {
                const active = k === current;
                const ms = statusOf(k);
                return (
                  <button
                    key={k}
                    className="hp-season-btn"
                    onClick={() => setSelected(k)}
                    style={{ border: `1px solid ${active ? "var(--leather)" : "var(--line)"}`, background: active ? "var(--leather)" : "#fff", color: active ? "#F2EADB" : "var(--leather)" }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 13.5 }}>{monthLabel(k)}</div>
                    <div style={{ fontSize: 12, opacity: 0.9 }}>
                      {fmtMoney(monthTotals[k] ?? 0)} · <span style={{ color: active ? "#F2EADB" : STATUS[ms].color, fontWeight: 700 }}>{STATUS[ms].label}</span>
                    </div>
                  </button>
                );
              })}
            </aside>

            <section>
              <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                <button className="btn-ghost" style={{ fontSize: 13 }} onClick={() => window.print()}>🖨 Print / save as PDF</button>
                <button className="btn-ghost" style={{ fontSize: 13 }} onClick={downloadCsv} disabled={!lines.length}>⇩ Download CSV</button>
                <button className="btn-ghost" style={{ fontSize: 13 }} onClick={openAdd} disabled={!!form}>+ Add a line by hand</button>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 12.5, fontWeight: 800, color: STATUS[st].color }}>
                  {STATUS[st].label}
                  {monthRow?.billed_at ? ` · billed ${fmtDay(monthRow.billed_at)}` : ""}
                  {monthRow?.paid_at ? ` · paid ${fmtDay(monthRow.paid_at)}` : ""}
                </span>
                {st === "open" && (
                  <button className="btn-ghost" style={{ fontSize: 13, borderColor: "#B5651D", color: "#B5651D" }} disabled={busy} onClick={() => setStatus("billed")}>Mark as billed</button>
                )}
                {st === "billed" && (
                  <button className="btn-ghost" style={{ fontSize: 13, borderColor: "#2D7A52", color: "#2D7A52" }} disabled={busy} onClick={() => setStatus("paid")}>Mark as paid</button>
                )}
                {st !== "open" && (
                  <button className="btn-ghost" style={{ fontSize: 13 }} disabled={busy} onClick={() => setStatus("open")}>Reopen</button>
                )}
              </div>
              <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                <input
                  className="field"
                  style={{ fontSize: 13, padding: "6px 10px", width: 300, maxWidth: "100%" }}
                  placeholder="Invoice number / note for this month"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onBlur={saveNote}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                />
                <span style={{ fontSize: 12, color: "var(--quiet)" }}>Shown on the statement. Saves when you click away.</span>
              </div>

              {form && (
                <form className="card no-print fee-form" onSubmit={submitAdd} style={{ padding: 14, marginBottom: 14 }}>
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>Add a line by hand</div>
                  <p style={{ fontSize: 12.5, color: "var(--quiet)", margin: "0 0 10px" }}>
                    For a payment the site didn&apos;t record itself — e.g. an entry you force-approved after confirming the Square
                    payment by hand. Use a minus amount for a credit. The fee is pre-filled from the current rate; change it if needed.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                    <label>Date<input type="date" className="field" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></label>
                    <label style={{ gridColumn: "span 2" }}>What<input className="field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Spring Classic — entries" required /></label>
                    <label>Who paid<input className="field" value={form.payer} onChange={(e) => setForm({ ...form, payer: e.target.value })} /></label>
                    <label>Paid via
                      <select className="field" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                        <option value="square">Square</option>
                        <option value="paypal">PayPal</option>
                        <option value="manual">Other</option>
                      </select>
                    </label>
                    <label>Amount paid ($)<input type="number" step="0.01" className="field" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value, fee: feeFor(e.target.value) })} required /></label>
                    <label>Fee ($)<input type="number" step="0.01" className="field" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} required /></label>
                    <label style={{ gridColumn: "span 2" }}>Note<input className="field" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button className="btn" type="submit" disabled={busy} style={{ fontSize: 14, padding: "8px 16px" }}>Add line</button>
                    <button className="btn-ghost" type="button" style={{ fontSize: 13 }} onClick={() => setForm(null)}>Cancel</button>
                  </div>
                </form>
              )}

              <div className="fee-sheet">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--quiet)" }}>Website fees statement</div>
                    <h2 className="display" style={{ margin: "2px 0 0", fontSize: 24, fontWeight: 700 }}>{monthLabel(current)}</h2>
                    <div style={{ fontSize: 13, color: "var(--quiet)", marginTop: 4 }}>
                      To: Hunter Coast Quarter Horse Association · for hcqha.com (HCQHA Live Scoring)
                    </div>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--quiet)", textAlign: "right" }}>
                    <div>Prepared {fmtDay(new Date().toISOString())}</div>
                    {monthRow?.note && <div>Ref: {monthRow.note}</div>}
                    {rateText && <div>Rate: {rateText}</div>}
                  </div>
                </div>

                <table className="fee-table" style={{ marginTop: 16 }}>
                  <thead>
                    <tr>
                      <th>Date</th><th>What</th><th>Who paid</th><th>Via</th>
                      <th className="num">Amount paid</th><th className="num">Fee</th><th className="no-print" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows === null && (
                      <tr><td colSpan={7} style={{ color: "var(--quiet)", textAlign: "center", padding: 18 }}>Loading…</td></tr>
                    )}
                    {rows !== null && lines.length === 0 && (
                      <tr><td colSpan={7} style={{ color: "var(--quiet)", textAlign: "center", padding: 18 }}>No online payments recorded for {monthLabel(current)}.</td></tr>
                    )}
                    {lines.map((l) => (
                      <tr key={l.id} style={(l.amount_cents ?? 0) < 0 ? { color: "#B5651D" } : undefined}>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtDay(l.paid_at)}</td>
                        <td>
                          {l.description}
                          <div style={{ fontSize: 11.5, color: "var(--quiet)" }}>
                            {KIND[l.kind] ?? l.kind}
                            {l.added_by ? ` · added by hand (${l.added_by})` : ""}
                            {l.note ? ` · ${l.note}` : ""}
                          </div>
                        </td>
                        <td>{l.payer_name ?? ""}</td>
                        <td>{PROVIDER[l.provider] ?? l.provider}</td>
                        <td className="num">{fmtMoney(l.amount_cents)}</td>
                        <td className="num">
                          {fmtMoney(l.fee_cents)}
                          {(l.flat_fee_cents ?? 0) !== 0 && (
                            <div style={{ fontSize: 11, color: "var(--quiet)", fontWeight: 400 }}>{fmtMoney(l.percent_fee_cents)} + {fmtMoney(l.flat_fee_cents)} flat</div>
                          )}
                        </td>
                        <td className="no-print">
                          {l.added_by && (
                            <button className="btn-ghost danger" style={{ fontSize: 11.5 }} disabled={busy} onClick={() => removeLine(l)}>Remove</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}>Total for {monthLabel(current)}</td>
                      <td className="num">{fmtMoney(totals.amount)}</td>
                      <td className="num">{fmtMoney(totals.fee)}</td>
                      <td className="no-print" />
                    </tr>
                  </tfoot>
                </table>

                <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--quiet)" }}>
                  {totals.count} online payment{totals.count === 1 ? "" : "s"}
                  {Object.keys(totals.byProvider).length
                    ? ` (${Object.entries(totals.byProvider).map(([p, n]) => `${n} ${PROVIDER[p] ?? p}`).join(", ")})`
                    : ""}.
                  {totals.flat !== 0
                    ? ` Fee made up of ${fmtMoney(totals.percent)} percentage + ${fmtMoney(totals.flat)} flat once-per-event.`
                    : ""}
                </div>
                <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--quiet)" }}>
                  Online payments only (Square and PayPal). Cash and bank-transfer amounts staff record by hand carry no website fee.
                  Refunds appear as credits. Dates are Sydney time.
                </div>
                <div style={{ marginTop: 14, fontSize: 15, fontWeight: 800, color: "var(--leather)" }}>Amount due: {fmtMoney(totals.fee)}</div>
              </div>
            </section>
          </div>
        )}
      </main>
    </>
  );
}
