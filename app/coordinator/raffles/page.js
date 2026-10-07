"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import ReadOnlyBanner from "../../components/ReadOnlyBanner";

// Staff: run fundraising raffles (schema-v56). Separate from shows — a raffle
// is prizes + a fixed set of ticket numbers that people buy online. Staff
// create/edit the raffle here, open it (which publishes the fair-draw
// fingerprint), watch sales, record cash sales, and draw the winners.

const fmtMoney = (cents) => `$${((cents ?? 0) / 100).toFixed(2)}`;
const fmtDate = (s) => (s ? new Date(s).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" }) : "—");
const ORDINAL = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
const STATUS = {
  draft:  { label: "Draft", cls: "pre_open" },
  open:   { label: "On sale", cls: "open" },
  closed: { label: "Sales closed", cls: "closed" },
  drawn:  { label: "Drawn", cls: "completed" },
};
const ORDER_STATUS = { pending: "pending payment", paid: "paid", cancelled: "cancelled", expired: "expired" };

const blankForm = () => ({
  name: "", description: "", ticket_price_cents: 500, ticket_count: 100, draw_date: "",
  prizes: [{ title: "", detail: "" }],
});

export default function RafflesPage() {
  const [session, setSession] = useState(null);
  const [raffles, setRaffles] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [orders, setOrders] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [form, setForm] = useState(null);       // editing/creating
  const [busy, setBusy] = useState(false);
  const [sale, setSale] = useState({ numbers: "", name: "", email: "", phone: "" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadRaffles = useCallback(async () => {
    if (!session) return;
    const { data, error } = await supabase.from("raffles").select("*").order("created_at", { ascending: false });
    if (error) { setTableMissing(true); setLoading(false); return; }
    setRaffles(data ?? []);
    setSelectedId((cur) => cur ?? data?.[0]?.id ?? null);
    setLoading(false);
  }, [session]);

  const loadDetail = useCallback(async () => {
    if (!session || !selectedId) { setOrders([]); setTickets([]); return; }
    const [{ data: o }, { data: t }] = await Promise.all([
      supabase.from("raffle_orders").select("*").eq("raffle_id", selectedId).order("created_at", { ascending: false }),
      supabase.from("raffle_tickets").select("*").eq("raffle_id", selectedId),
    ]);
    setOrders(o ?? []); setTickets(t ?? []);
  }, [session, selectedId]);

  useEffect(() => { loadRaffles(); }, [loadRaffles]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel("raffles-staff")
      .on("postgres_changes", { event: "*", schema: "public", table: "raffles" }, loadRaffles)
      .on("postgres_changes", { event: "*", schema: "public", table: "raffle_orders" }, loadDetail)
      .on("postgres_changes", { event: "*", schema: "public", table: "raffle_tickets" }, loadDetail)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadRaffles, loadDetail]);

  const staffPost = async (path, body) => {
    const { data: s } = await supabase.auth.getSession();
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s?.session?.access_token ?? ""}` },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data;
  };

  if (!session) {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <h1 className="display" style={{ fontWeight: 700, fontSize: 22 }}>Staff only</h1>
        <Link href="/coordinator" style={{ color: "var(--brass)" }}>← Sign in at coordinator dashboard</Link>
      </main>
    );
  }

  const raffle = raffles.find((r) => r.id === selectedId) ?? null;
  const prizes = Array.isArray(raffle?.prizes) ? raffle.prizes : [];
  const sold = tickets.filter((t) => t.status === "sold");
  const held = tickets.filter((t) => t.status === "reserved");
  const revenue = orders.filter((o) => o.status === "paid").reduce((s, o) => s + (o.total_cents ?? 0), 0);
  const ticketByNumber = Object.fromEntries(tickets.map((t) => [t.number, t]));
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = raffle ? `${baseUrl}/raffle/${raffle.id}` : "";

  // ---- create / edit ----------------------------------------------------
  const startCreate = () => setForm({ ...blankForm(), id: null });
  const startEdit = () => raffle && setForm({
    id: raffle.id, name: raffle.name, description: raffle.description ?? "",
    ticket_price_cents: raffle.ticket_price_cents ?? 0, ticket_count: raffle.ticket_count ?? 100,
    draw_date: raffle.draw_date ?? "",
    prizes: prizes.length ? prizes.map((p) => ({ title: p.title ?? "", detail: p.detail ?? "" })) : [{ title: "", detail: "" }],
  });
  const setPrize = (i, key, val) => setForm((f) => ({ ...f, prizes: f.prizes.map((p, j) => (j === i ? { ...p, [key]: val } : p)) }));

  const saveForm = async (e) => {
    e.preventDefault();
    const cleanPrizes = form.prizes.map((p) => ({ title: p.title.trim(), detail: p.detail.trim() })).filter((p) => p.title);
    if (!form.name.trim()) { window.alert("Give the raffle a name."); return; }
    const count = parseInt(form.ticket_count, 10);
    if (!Number.isInteger(count) || count < 1 || count > 1000) { window.alert("Ticket count must be between 1 and 1000."); return; }
    if (form.id && raffle && count < raffle.ticket_count && tickets.some((t) => t.number > count)) {
      window.alert(`Numbers above ${count} are already sold or held — you can't reduce the count below them.`); return;
    }
    const row = {
      name: form.name.trim(), description: form.description.trim() || null,
      ticket_price_cents: Math.max(0, Math.round(Number(form.ticket_price_cents) || 0)),
      ticket_count: count, draw_date: form.draw_date.trim() || null, prizes: cleanPrizes,
    };
    setBusy(true);
    const q = form.id
      ? supabase.from("raffles").update(row).eq("id", form.id).select().single()
      : supabase.from("raffles").insert(row).select().single();
    const { data, error } = await q;
    setBusy(false);
    if (error) { window.alert(error.message); return; }
    setForm(null);
    await loadRaffles();
    if (data?.id) setSelectedId(data.id);
  };

  // ---- status changes ---------------------------------------------------
  const setStatus = async (status) => {
    if (!raffle) return;
    if (status === "open" && !prizes.length && !window.confirm("No prizes are listed yet. Open ticket sales anyway?")) return;
    setBusy(true);
    try {
      if (status === "open") {
        // Publishes the fair-draw fingerprint before the first ticket sells.
        await staffPost(`/api/raffle/${raffle.id}/draw`, { action: "commit" });
      }
      const { error } = await supabase.from("raffles").update({ status }).eq("id", raffle.id);
      if (error) throw error;
      await loadRaffles();
    } catch (err) { window.alert(err.message); }
    setBusy(false);
  };

  const drawWinners = async () => {
    if (!raffle) return;
    if (!sold.length) { window.alert("No tickets have been sold yet."); return; }
    if (!prizes.length) { window.alert("Add the prizes first (Edit raffle)."); return; }
    if (!window.confirm(`Draw the winners now?\n\n${prizes.length} prize${prizes.length === 1 ? "" : "s"} will be drawn from the ${sold.length} sold ticket${sold.length === 1 ? "" : "s"} using the verifiable random draw. The result is final and published on the raffle page straight away.`)) return;
    setBusy(true);
    try {
      await staffPost(`/api/raffle/${raffle.id}/draw`, {});
      await loadRaffles();
    } catch (err) { window.alert(err.message); }
    setBusy(false);
  };

  const deleteRaffle = async () => {
    if (!raffle) return;
    if (!window.confirm(`Delete "${raffle.name}"?\n\nThis removes the raffle, its ${orders.length} order${orders.length === 1 ? "" : "s"} and all ticket records. Money already taken through Square is NOT refunded by this. This can't be undone.`)) return;
    const { error } = await supabase.from("raffles").delete().eq("id", raffle.id);
    if (error) { window.alert(error.message); return; }
    setSelectedId(null);
    await loadRaffles();
  };

  // ---- orders -----------------------------------------------------------
  const release = async (order) => {
    if (!window.confirm(`Release numbers ${(order.numbers ?? []).join(", ")} held by ${order.buyer_name}? Their payment link will stop working.`)) return;
    try { await staffPost(`/api/raffle/${raffle.id}/sell`, { action: "release", order_id: order.id }); await loadDetail(); }
    catch (err) { window.alert(err.message); }
  };
  const markPaid = async (order) => {
    if (!window.confirm(`Mark ${order.buyer_name}'s order (${fmtMoney(order.total_cents)}) as paid outside Square?`)) return;
    try { await staffPost(`/api/raffle/${raffle.id}/sell`, { action: "mark_paid", order_id: order.id }); await loadDetail(); }
    catch (err) { window.alert(err.message); }
  };
  const recordSale = async (e) => {
    e.preventDefault();
    const numbers = sale.numbers.split(/[\s,;]+/).map((s) => parseInt(s, 10)).filter(Number.isInteger);
    if (!numbers.length) { window.alert("Enter the ticket numbers, e.g. 4, 17, 23"); return; }
    setBusy(true);
    try {
      await staffPost(`/api/raffle/${raffle.id}/sell`, { numbers, name: sale.name, email: sale.email, phone: sale.phone });
      setSale({ numbers: "", name: "", email: "", phone: "" });
      await loadDetail();
    } catch (err) { window.alert(err.message); }
    setBusy(false);
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt("Copy this link:", shareUrl); }
  };

  const btn = { border: "1px solid var(--line)", background: "#fff", color: "var(--leather)", borderRadius: 10, padding: "8px 14px", fontSize: 14, fontWeight: 700, fontFamily: "inherit" };

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>Coordinator</div>
            <h1 className="display" style={{ fontWeight: 700, fontSize: 22, margin: "2px 0", color: "#F2EADB" }}>Raffles</h1>
          </div>
          <Link href="/coordinator" style={{ color: "var(--brass-soft)", fontSize: 13, alignSelf: "center" }}>← Dashboard</Link>
        </div>
      </header>

      <main className="wrap">
        <ReadOnlyBanner />

        {tableMissing && (
          <section className="card" style={{ borderColor: "var(--clay)" }}>
            <div style={{ padding: 16 }}>
              <strong>The raffle tables haven't been created yet.</strong>
              <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--quiet)" }}>
                Run <code>supabase/schema-v56-raffles.sql</code> in the Supabase SQL Editor (see <Link href="/coordinator/health" style={{ color: "var(--brass)" }}>Health</Link>), then reload this page.
              </p>
            </div>
          </section>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          {raffles.length > 0 && (
            <select className="field" style={{ fontSize: 15, flex: "1 1 220px" }} value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value || null)}>
              {raffles.map((r) => <option key={r.id} value={r.id}>{r.name} — {STATUS[r.status]?.label ?? r.status}</option>)}
            </select>
          )}
          <button style={btn} onClick={startCreate} disabled={tableMissing}>+ New raffle</button>
        </div>

        {form && (
          <section className="card">
            <div className="card-head"><strong className="display" style={{ fontSize: 17 }}>{form.id ? "Edit raffle" : "New raffle"}</strong></div>
            <form onSubmit={saveForm} style={{ padding: 16, display: "grid", gap: 10 }}>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>Name
                <input className="field" style={{ fontSize: 16 }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Spring Classic fundraising raffle" required />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>Ticket price ($)
                  <input className="field" style={{ fontSize: 16 }} type="number" step="0.5" min="0" value={(form.ticket_price_cents / 100).toString()}
                    onChange={(e) => setForm({ ...form, ticket_price_cents: Math.round(parseFloat(e.target.value || "0") * 100) })} />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>Tickets
                  <input className="field" style={{ fontSize: 16 }} type="number" min="1" max="1000" value={form.ticket_count} onChange={(e) => setForm({ ...form, ticket_count: e.target.value })} />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>Draw date
                  <input className="field" style={{ fontSize: 16 }} value={form.draw_date} onChange={(e) => setForm({ ...form, draw_date: e.target.value })} placeholder="e.g. Sat 14 Nov at the show" />
                </label>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Prizes (in order — 1st prize first)</div>
                {form.prizes.map((p, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr auto", gap: 6, alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "var(--brass)", letterSpacing: ".08em" }}>{ORDINAL[i] ?? `${i + 1}th`}</span>
                    <input className="field" style={{ fontSize: 15 }} value={p.title} onChange={(e) => setPrize(i, "title", e.target.value)} placeholder="Prize, e.g. $500 saddlery voucher" />
                    <input className="field" style={{ fontSize: 15 }} value={p.detail} onChange={(e) => setPrize(i, "detail", e.target.value)} placeholder="Details / donated by (optional)" />
                    <button type="button" className="btn-ghost danger" onClick={() => setForm({ ...form, prizes: form.prizes.filter((_, j) => j !== i) })} disabled={form.prizes.length === 1}>✕</button>
                  </div>
                ))}
                <button type="button" className="btn-ghost" onClick={() => setForm({ ...form, prizes: [...form.prizes, { title: "", detail: "" }] })}>+ Add prize</button>
              </div>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>Description (optional — shown under the prizes)
                <textarea className="field" style={{ fontSize: 15, minHeight: 70 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What the money is going towards, terms, who to contact…" />
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save raffle"}</button>
                <button type="button" style={btn} onClick={() => setForm(null)}>Cancel</button>
              </div>
            </form>
          </section>
        )}

        {loading && !tableMissing && <p style={{ color: "var(--quiet)" }}>Loading…</p>}
        {!loading && !raffle && !form && !tableMissing && (
          <p style={{ color: "var(--quiet)" }}>No raffles yet. Click <strong>+ New raffle</strong> to set one up.</p>
        )}

        {raffle && !form && (
          <>
            <section className="card">
              <div className="card-head">
                <div>
                  <strong className="display" style={{ fontSize: 18 }}>{raffle.name}</strong>
                  <div style={{ fontSize: 12, color: "var(--quiet)" }}>
                    {fmtMoney(raffle.ticket_price_cents)} a ticket · {raffle.ticket_count} tickets{raffle.draw_date ? ` · Drawn ${raffle.draw_date}` : ""}
                  </div>
                </div>
                <span className={`badge ${STATUS[raffle.status]?.cls ?? "pre_open"}`}>{STATUS[raffle.status]?.label ?? raffle.status}</span>
              </div>
              <div style={{ padding: "12px 16px", display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                  {[["Sold", `${sold.length} / ${raffle.ticket_count}`], ["Being paid for", held.length], ["Unsold", Math.max(0, raffle.ticket_count - sold.length - held.length)], ["Raised", fmtMoney(revenue)]].map(([k, v]) => (
                    <div key={k} style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px" }}>
                      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--quiet)" }}>{k}</div>
                      <div className="display" style={{ fontWeight: 700, fontSize: 20 }}>{v}</div>
                    </div>
                  ))}
                </div>

                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--quiet)", marginBottom: 4 }}>Prizes</div>
                  {prizes.length === 0 && <div style={{ fontSize: 14, color: "var(--quiet)" }}>None yet — add them with Edit raffle.</div>}
                  {prizes.map((p, i) => (
                    <div key={i} style={{ fontSize: 14 }}><strong style={{ color: "var(--brass)" }}>{ORDINAL[i] ?? `${i + 1}th`}</strong> {p.title}{p.detail ? <span style={{ color: "var(--quiet)" }}> — {p.detail}</span> : null}</div>
                  ))}
                </div>

                {raffle.status === "drawn" && Array.isArray(raffle.draw_results) && (
                  <div style={{ background: "#FFF6DA", border: "1px solid var(--brass)", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--brass)", marginBottom: 4 }}>🏆 Winners · drawn {fmtDate(raffle.drawn_at)}</div>
                    {raffle.draw_results.map((r) => {
                      const o = orders.find((x) => x.status === "paid" && (x.numbers ?? []).includes(r.number));
                      return (
                        <div key={r.prize_index} style={{ fontSize: 14, padding: "3px 0" }}>
                          <strong>{ORDINAL[r.prize_index] ?? `${r.prize_index + 1}th`}</strong> {r.prize} — ticket <strong>#{r.number}</strong> · {r.buyer_name || "—"}
                          {o && <span style={{ color: "var(--quiet)" }}>{o.buyer_email ? ` · ${o.buyer_email}` : ""}{o.buyer_phone ? ` · ${o.buyer_phone}` : ""}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button style={btn} onClick={startEdit} disabled={busy}>✎ Edit raffle</button>
                  <button style={btn} onClick={copyLink}>{copied ? "✓ Link copied" : "🔗 Copy link to share"}</button>
                  <Link href={`/raffle/${raffle.id}`} target="_blank" style={{ ...btn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>View public page ↗</Link>
                  {raffle.status === "draft" && <button className="btn" onClick={() => setStatus("open")} disabled={busy}>▶ Open ticket sales</button>}
                  {raffle.status === "open" && <button style={{ ...btn, borderColor: "#9A6A1A", color: "#9A6A1A" }} onClick={() => setStatus("closed")} disabled={busy}>■ Close sales</button>}
                  {raffle.status === "closed" && <button style={btn} onClick={() => setStatus("open")} disabled={busy}>▶ Reopen sales</button>}
                  {(raffle.status === "open" || raffle.status === "closed") && <button className="btn" onClick={drawWinners} disabled={busy}>🎲 Draw winners</button>}
                  {raffle.status === "open" && <button className="btn-ghost" onClick={() => setStatus("draft")} disabled={busy || tickets.length > 0} title={tickets.length ? "Tickets are already sold or held" : ""}>← Back to draft</button>}
                  <button className="btn-ghost danger" onClick={deleteRaffle} disabled={busy}>Delete raffle</button>
                </div>
                {raffle.status === "open" && (
                  <div style={{ fontSize: 12, color: "var(--quiet)" }}>
                    Share this link on Facebook: <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{shareUrl}</span>
                    {raffle.seed_hash && <> · Fair-draw fingerprint published ✓</>}
                  </div>
                )}
              </div>
            </section>

            {raffle.status !== "drawn" && (
              <section className="card">
                <div className="card-head"><strong className="display" style={{ fontSize: 17 }}>Record a cash / bank-transfer sale</strong></div>
                <form onSubmit={recordSale} style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>Ticket numbers
                    <input className="field" style={{ fontSize: 16 }} value={sale.numbers} onChange={(e) => setSale({ ...sale, numbers: e.target.value })} placeholder="e.g. 4, 17, 23" required />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>Buyer's name
                    <input className="field" style={{ fontSize: 16 }} value={sale.name} onChange={(e) => setSale({ ...sale, name: e.target.value })} required />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>Email (optional)
                    <input className="field" style={{ fontSize: 16 }} type="email" value={sale.email} onChange={(e) => setSale({ ...sale, email: e.target.value })} />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>Phone (optional)
                    <input className="field" style={{ fontSize: 16 }} value={sale.phone} onChange={(e) => setSale({ ...sale, phone: e.target.value })} />
                  </label>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <button className="btn" type="submit" disabled={busy}>Record sale</button>
                    <span style={{ fontSize: 12, color: "var(--quiet)", marginLeft: 10 }}>Marks those numbers sold straight away — no Square payment.</span>
                  </div>
                </form>
              </section>
            )}

            <section className="card">
              <div className="card-head">
                <strong className="display" style={{ fontSize: 17 }}>Ticket board</strong>
                <span style={{ fontSize: 12, color: "var(--quiet)" }}>tap a number to see who has it</span>
              </div>
              <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(44px, 1fr))", gap: 4 }}>
                {Array.from({ length: raffle.ticket_count }, (_, i) => i + 1).map((n) => {
                  const t = ticketByNumber[n];
                  const isWin = (raffle.draw_results ?? []).some((r) => r.number === n);
                  return (
                    <div key={n} title={t ? `${t.status === "sold" ? "Sold" : "Held"} · ${t.buyer_name ?? ""}` : "Available"}
                      style={{ textAlign: "center", padding: "6px 0", borderRadius: 6, fontSize: 13, fontWeight: 700,
                        background: isWin ? "#FFF6DA" : t?.status === "sold" ? "#2D7A52" : t?.status === "reserved" ? "#FBF3E6" : "#fff",
                        color: isWin ? "var(--leather)" : t?.status === "sold" ? "#fff" : t?.status === "reserved" ? "#9A6A1A" : "var(--quiet)",
                        border: `1px solid ${isWin ? "var(--brass)" : t?.status === "sold" ? "#2D7A52" : t?.status === "reserved" ? "#E8D9B8" : "var(--line)"}` }}>
                      {n}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <strong className="display" style={{ fontSize: 17 }}>Orders</strong>
                <span style={{ fontSize: 12, color: "var(--quiet)" }}>{orders.length}</span>
              </div>
              {orders.length === 0 && <p style={{ padding: 16, margin: 0, color: "var(--quiet)" }}>No tickets bought yet.</p>}
              {orders.map((o) => (
                <div key={o.id} style={{ padding: "10px 16px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center",
                  opacity: o.status === "cancelled" || o.status === "expired" ? 0.55 : 1 }}>
                  <div style={{ flex: "1 1 240px" }}>
                    <div style={{ fontWeight: 700 }}>{o.buyer_name} <span style={{ fontWeight: 400, color: "var(--quiet)", fontSize: 13 }}>{o.buyer_email ?? ""}{o.buyer_phone ? ` · ${o.buyer_phone}` : ""}</span></div>
                    <div style={{ fontSize: 13 }}>
                      Numbers <strong>{(o.numbers ?? []).join(", ")}</strong> · {fmtMoney(o.total_cents)} · {o.method === "manual" ? "cash/transfer" : "Square"} · {fmtDate(o.paid_at ?? o.created_at)}
                    </div>
                  </div>
                  <span className={`badge ${o.status === "paid" ? "completed" : o.status === "pending" ? "closed" : "archived"}`}>{ORDER_STATUS[o.status] ?? o.status}</span>
                  {o.status === "pending" && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn-ghost" onClick={() => markPaid(o)}>Mark paid</button>
                      <button className="btn-ghost danger" onClick={() => release(o)}>Release</button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          </>
        )}
      </main>
    </>
  );
}
