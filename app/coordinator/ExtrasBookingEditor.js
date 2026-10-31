"use client";
import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { extraNights, nightLabel, extraAmountCents, isDated, unitNoun, quantityLabel, MAX_QUANTITY } from "../../lib/eventExtras";

// Staff: fix a camping / yard booking after the fact — how many, which
// dates, the note — or remove it. Owner's report, Oct 2026: every camper at
// a clinic had booked 2 sites when they meant 2 nights. Writes
// registration_extras directly with the staff login (read-only committee
// logins are refused by the database). The booking's amount is worked out
// again from the item's price so the steward's list and the "n left" counts
// are right; money already paid is refunded separately with the Refund
// button on the registration.

const fmtMoney = (cents) => `$${((cents ?? 0) / 100).toFixed(2)}`;

export default function ExtrasBookingEditor({ booking, event, onDone }) {
  const item = booking?.event_extras ?? {};
  const dated = isDated(item);
  const [quantity, setQuantity] = useState(Math.max(1, Number(booking?.quantity) || 1));
  const [nights, setNights] = useState(Array.isArray(booking?.nights) ? [...booking.nights].sort() : []);
  const [notes, setNotes] = useState(booking?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The dates on offer now, plus any stored date outside that run so an
  // older booking isn't silently trimmed.
  const dates = [...new Set([...extraNights(item, event), ...nights])].sort();
  const newAmount = extraAmountCents(item, quantity, dated ? nights : []);
  const noun = item.kind === "camping" ? "sites" : item.kind === "yard" ? "yards" : "";
  const friendly = (msg) =>
    /row-level security|permission denied|policy/i.test(msg ?? "")
      ? "This login is read-only — a full-access staff login is needed to change bookings."
      : msg ?? "Could not save.";

  const save = async () => {
    if (dated && !nights.length) { setError(`Pick at least one ${unitNoun(item)}, or remove the booking.`); return; }
    setBusy(true); setError("");
    const { error: err } = await supabase
      .from("registration_extras")
      .update({ quantity, nights: dated ? nights : [], amount_cents: newAmount, notes: notes.trim() || null })
      .eq("id", booking.id);
    setBusy(false);
    if (err) { setError(friendly(err.message)); return; }
    onDone?.(true);
  };

  const remove = async () => {
    if (!window.confirm(`Remove this ${item.name ?? "camping/yard"} booking from the registration?\n\nMoney already paid is NOT refunded by this — use the Refund button for that. The entries on the registration are not touched.`)) return;
    setBusy(true); setError("");
    const { error: err } = await supabase.from("registration_extras").delete().eq("id", booking.id);
    setBusy(false);
    if (err) { setError(friendly(err.message)); return; }
    onDone?.(true);
  };

  const toggle = (n) => setNights((cur) => (cur.includes(n) ? cur.filter((d) => d !== n) : [...cur, n].sort()));

  return (
    <div style={{ marginTop: 6, border: "1px dashed var(--line)", borderRadius: 10, padding: "10px 12px", background: "var(--paper)", fontSize: 13 }}>
      <div style={{ fontWeight: 800, color: "var(--leather)", marginBottom: 6 }}>Edit {item.name ?? "booking"}</div>
      {dated && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--quiet)", marginBottom: 6 }}>Which {unitNoun(item, 2)}?</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {dates.map((n) => {
              const on = nights.includes(n);
              return (
                <button key={n} type="button" aria-pressed={on} onClick={() => toggle(n)} disabled={busy}
                  style={{ fontFamily: "inherit", fontSize: 13, fontWeight: 700, padding: "6px 10px", borderRadius: 9, cursor: "pointer",
                    border: `2px solid ${on ? "var(--leather)" : "var(--line)"}`, background: on ? "var(--leather)" : "#fff",
                    color: on ? "#F2EADB" : "var(--leather)" }}>
                  {nightLabel(n)}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <label style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        How many{noun ? ` ${noun}` : ""}{dated ? ` each ${unitNoun(item)}` : ""}?
        <select className="field" style={{ fontSize: 14, padding: "6px 10px" }} value={quantity}
          onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))} disabled={busy}>
          {Array.from({ length: MAX_QUANTITY }, (_, i) => i + 1).map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
      </label>
      <input className="field" style={{ width: "100%", fontSize: 14, padding: "7px 10px", marginTop: 8, boxSizing: "border-box" }}
        placeholder={item.kind === "yard" ? "Horse name(s) — optional" : item.kind === "camping" ? "Vehicle / float details — optional" : "Notes — optional"}
        value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} disabled={busy} />
      <div style={{ marginTop: 8, color: "var(--quiet)" }}>
        New price: <strong style={{ color: "var(--leather)" }}>{fmtMoney(newAmount)}</strong>
        {newAmount !== (booking?.amount_cents ?? 0) ? ` (was ${fmtMoney(booking?.amount_cents)})` : ""}
        {" — "}{quantityLabel(item, quantity)}{dated ? ` × ${nights.length} ${unitNoun(item, nights.length)}` : ""}.
        {" "}If they already paid more than this, refund the difference with the Refund button after saving.
      </div>
      {error && <p style={{ color: "var(--clay)", fontWeight: 700, margin: "6px 0 0" }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn" style={{ fontSize: 13, padding: "7px 14px" }} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button className="btn-ghost" style={{ fontSize: 13 }} onClick={() => onDone?.(false)} disabled={busy}>Cancel</button>
        <button className="btn-ghost" style={{ fontSize: 13, color: "var(--clay)", marginLeft: "auto" }} onClick={remove} disabled={busy}>Remove booking</button>
      </div>
    </div>
  );
}
