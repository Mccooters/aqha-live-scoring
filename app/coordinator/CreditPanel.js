"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../lib/supabaseClient";
import { normalizeCreditEmail, creditSummary, CREDIT_KIND_LABEL } from "../../lib/memberCredits";

// Staff: one person's club credit (schema-v68) — balance, history, and a
// form to give credit or take it back. Keyed by email like memberships.
// Writes member_credits directly with the staff login (read-only committee
// logins are refused by the database). Shown inside a member's expanded
// row on the Memberships page.

const fmtMoney = (c) => `$${((c ?? 0) / 100).toFixed(2)}`;
const fmtWhen = (s) => (s ? new Date(s).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" }) : "");
const escapeIlike = (v) => String(v).replace(/([\\%_])/g, "\\$1");

export default function CreditPanel({ email, name, onChanged }) {
  const e = normalizeCreditEmail(email);
  const [rows, setRows] = useState(null);
  const [held, setHeld] = useState(0);
  const [missing, setMissing] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [direction, setDirection] = useState("give"); // give | take
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!e) { setRows([]); return; }
    const { data, error: err } = await supabase
      .from("member_credits").select("*, event:events(name)")
      .ilike("email", escapeIlike(e)).order("created_at", { ascending: false });
    if (err) { setMissing(/does not exist|schema cache/i.test(err.message ?? "")); setRows([]); return; }
    setRows(data ?? []);
    const { data: pend } = await supabase
      .from("registrations").select("credit_cents")
      .eq("status", "pending").gt("credit_cents", 0).ilike("contact_email", escapeIlike(e));
    setHeld((pend ?? []).reduce((s, r) => s + (Number(r.credit_cents) || 0), 0));
  }, [e]);
  useEffect(() => { load(); }, [load]);

  const summary = creditSummary(rows ?? [], [{ credit_cents: held }]);

  const save = async () => {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) { setError("Enter an amount in dollars."); return; }
    if (direction === "take" && cents > summary.balance_cents) { setError(`They only have ${fmtMoney(summary.balance_cents)} of credit.`); return; }
    if (!reason.trim()) { setError("Say why — the committee will want to follow it later."); return; }
    setBusy(true); setError("");
    const { data: s } = await supabase.auth.getSession();
    const { error: err } = await supabase.from("member_credits").insert({
      email: e,
      amount_cents: direction === "give" ? cents : -cents,
      kind: direction === "give" ? "credit" : "adjust",
      reason: reason.trim().slice(0, 300),
      created_by: s?.session?.user?.email ?? null,
    });
    setBusy(false);
    if (err) {
      setError(/row-level security|permission denied|policy/i.test(err.message ?? "")
        ? "This login is read-only — a full-access staff login is needed to change credits."
        : /does not exist|schema cache/i.test(err.message ?? "")
          ? "Member credits need the database update — run schema-v68-member-credits.sql in Supabase first."
          : err.message);
      return;
    }
    setAmount(""); setReason("");
    await load();
    onChanged?.();
  };

  if (missing) {
    return <p style={{ fontSize: 12.5, color: "var(--quiet)", margin: "6px 0" }}>Club credits need the database update — run <code>supabase/schema-v68-member-credits.sql</code> in Supabase.</p>;
  }

  return (
    <div style={{ margin: "8px 0 10px", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px", background: summary.balance_cents > 0 ? "#E6F2EA" : "#fff", fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <strong style={{ color: "var(--leather)" }}>Club credit: {fmtMoney(summary.balance_cents)}</strong>
          {held > 0 && <span style={{ color: "var(--quiet)" }}> · {fmtMoney(held)} held by an unpaid checkout · {fmtMoney(summary.available_cents)} available</span>}
          {rows === null && <span style={{ color: "var(--quiet)" }}> · loading…</span>}
        </div>
        <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setOpen((o) => !o)}>{open ? "Close" : rows?.length ? "History / add credit" : "+ Give credit"}</button>
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          {(rows ?? []).length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginBottom: 8 }}>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "4px 6px 4px 0", whiteSpace: "nowrap", color: "var(--quiet)" }}>{fmtWhen(r.created_at)}</td>
                    <td style={{ padding: "4px 6px", fontWeight: 700, color: (r.amount_cents ?? 0) < 0 ? "var(--clay)" : "#2D7A52", whiteSpace: "nowrap" }}>
                      {(r.amount_cents ?? 0) < 0 ? "−" : "+"}{fmtMoney(Math.abs(r.amount_cents ?? 0))}
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      {CREDIT_KIND_LABEL[r.kind] ?? r.kind}{r.event?.name ? ` · ${r.event.name}` : ""}{r.reason ? ` — ${r.reason}` : ""}
                      {r.created_by && r.created_by !== "system" ? <span style={{ color: "var(--quiet)" }}> · by {r.created_by}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select className="field" style={{ fontSize: 13, padding: "6px 8px" }} value={direction} onChange={(ev) => setDirection(ev.target.value)} disabled={busy}>
              <option value="give">Give credit</option>
              <option value="take">Take credit back</option>
            </select>
            <span style={{ fontWeight: 700 }}>$</span>
            <input className="field" type="number" inputMode="decimal" min="0" step="0.01" style={{ width: 100, fontSize: 14, padding: "6px 8px" }}
              value={amount} onChange={(ev) => setAmount(ev.target.value)} placeholder="0.00" disabled={busy} />
            <input className="field" style={{ flex: "1 1 220px", fontSize: 14, padding: "6px 8px" }}
              value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Why — e.g. over-booked camping at the Nov clinic" maxLength={300} disabled={busy} />
            <button className="btn" style={{ fontSize: 13, padding: "7px 14px" }} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
          {error && <p style={{ color: "var(--clay)", fontWeight: 700, margin: "6px 0 0" }}>{error}</p>}
          <p style={{ color: "var(--quiet)", fontSize: 12, margin: "6px 0 0" }}>
            {name ? `${name} spends` : "They spend"} it by entering an event signed in to the member portal — the entry form offers the credit at checkout. It is tied to {e}.
          </p>
        </div>
      )}
    </div>
  );
}
