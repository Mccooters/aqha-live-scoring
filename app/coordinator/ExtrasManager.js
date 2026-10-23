"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import { EXTRA_KINDS, EXTRA_UNITS, KIND_ICON, extraNights, nightLabel, priceLabel, addDays, isDated, unitNoun } from "../../lib/eventExtras";

// Staff: what exhibitors can book with their entry for this event — yards
// per day, camping sites per night, or anything with one price for the whole
// event (schema-v61). Opened from the dashboard's "🏕 Camping & yards"
// button; rendered inside the dashboard's modal sheet.

const blankDraft = () => ({ name: "", kind: "yard", unit: "day", price: "", capacity: "", first_night: "", last_night: "", description: "", pool: "", share: "" });

// Events that can still sell yards or sites — the dropdown of "other active
// events" leaves out finished, archived and cancelled ones.
const ACTIVE_STATUSES = new Set(["pre_open", "open", "closed", "live"]);

// Shared name used when the chosen item on the other event doesn't have one
// yet: both items get it, so they count as one pool from now on.
const autoPoolName = (item) => `${item.name} · ${item.event?.name ?? "shared"}`.slice(0, 80);

// What the "Shared with" dropdown should show for an existing item: the
// matching item on another event when its shared name is in use there, else
// "custom" so the typed name stays visible, else not shared.
function shareFor(pool, otherItems) {
  const p = String(pool ?? "").trim();
  if (!p) return "";
  const match = otherItems.find((i) => String(i.pool ?? "").trim() === p);
  return match ? `item:${match.id}` : "custom";
}

function draftFrom(row, otherItems = []) {
  return {
    name: row.name ?? "",
    kind: row.kind ?? "other",
    unit: EXTRA_UNITS[row.unit] ? row.unit : "night",
    price: row.price_cents ? (row.price_cents / 100).toFixed(2) : "",
    capacity: row.capacity == null ? "" : String(row.capacity),
    first_night: row.first_night ?? "",
    last_night: row.last_night ?? "",
    description: row.description ?? "",
    pool: row.pool ?? "",
    share: shareFor(row.pool, otherItems),
  };
}

function ExtraForm({ title, draft, setDraft, onSubmit, onCancel, submitLabel, busy, event, poolNames = [], otherItems = [] }) {
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  // Yards are per day, camping per night (owner's rule): picking the type
  // switches the pricing to match unless it's one price for the event.
  const setKind = (e) => {
    const kind = e.target.value;
    setDraft((d) => ({ ...d, kind, unit: d.unit === "event" ? "event" : kind === "camping" ? "night" : kind === "yard" ? "day" : d.unit }));
  };
  const noun = unitNoun(draft);
  const defaultFirst = event?.starts_on ? addDays(event.starts_on, -1) : "";
  const defaultLast = event?.ends_on || event?.starts_on || "";
  // Other active events' bookable items, grouped per event for the dropdown.
  const otherEvents = [];
  for (const i of otherItems) {
    let ev = otherEvents.find((e) => e.id === i.event_id);
    if (!ev) { ev = { id: i.event_id, name: i.event?.name ?? "Another event", items: [] }; otherEvents.push(ev); }
    ev.items.push(i);
  }
  const setShare = (e) => {
    const share = e.target.value;
    setDraft((d) => ({ ...d, share, pool: share === "custom" ? d.pool : "" }));
  };
  return (
    <div style={{ border: "1px dashed var(--line)", borderRadius: 10, padding: "10px 12px", background: "var(--paper)" }}>
      <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 6 }}>{title}</div>
      <label className="modal-label" style={{ marginTop: 6 }}>Name *</label>
      <input className="field" style={{ width: "100%", fontSize: 15 }} value={draft.name} onChange={set("name")} placeholder="e.g. Yard, Powered camping site" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label className="modal-label">Type</label>
          <select className="field" style={{ width: "100%", fontSize: 15 }} value={draft.kind} onChange={setKind}>
            {Object.entries(EXTRA_KINDS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        <div>
          <label className="modal-label">Priced</label>
          <select className="field" style={{ width: "100%", fontSize: 15 }} value={draft.unit} onChange={set("unit")}>
            {Object.entries(EXTRA_UNITS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        <div>
          <label className="modal-label">Price ($)</label>
          <input className="field" type="number" step="0.01" min="0" style={{ width: "100%", fontSize: 15 }} value={draft.price} onChange={set("price")} placeholder="0.00" />
        </div>
        <div>
          <label className="modal-label">How many exist{isDated(draft) ? ` (per ${noun})` : ""}</label>
          <input className="field" type="number" min="0" style={{ width: "100%", fontSize: 15 }} value={draft.capacity} onChange={set("capacity")} placeholder="blank = no limit" />
        </div>
        {isDated(draft) && (
          <>
            <div>
              <label className="modal-label">First {noun}</label>
              <input className="field" type="date" style={{ width: "100%", fontSize: 14 }} value={draft.first_night} onChange={set("first_night")} />
              <div style={{ fontSize: 11.5, color: "var(--quiet)", marginTop: 3 }}>Blank = {defaultFirst ? nightLabel(defaultFirst) : `the ${noun} before the event`}</div>
            </div>
            <div>
              <label className="modal-label">Last {noun}</label>
              <input className="field" type="date" style={{ width: "100%", fontSize: 14 }} value={draft.last_night} onChange={set("last_night")} />
              <div style={{ fontSize: 11.5, color: "var(--quiet)", marginTop: 3 }}>Blank = {defaultLast ? nightLabel(defaultLast) : "the event's last day"}</div>
            </div>
          </>
        )}
      </div>
      <label className="modal-label">Description (optional)</label>
      <input className="field" style={{ width: "100%", fontSize: 14 }} value={draft.description} onChange={set("description")} placeholder="e.g. Steel yards near the arena. Bring your own feed bins." maxLength={200} />
      <label className="modal-label">Shared with another event (optional)</label>
      <select className="field" style={{ width: "100%", fontSize: 14 }} value={draft.share ?? ""} onChange={setShare}>
        <option value="">Not shared</option>
        {otherEvents.map((ev) => (
          <optgroup key={ev.id} label={ev.name}>
            {ev.items.map((i) => (
              <option key={i.id} value={`item:${i.id}`}>
                {KIND_ICON[i.kind] ?? ""} {i.name}{i.pool ? ` — shared as "${i.pool}"` : ""}
              </option>
            ))}
          </optgroup>
        ))}
        <option value="custom">Type a shared name…</option>
      </select>
      {draft.share === "custom" && (
        <>
          <input className="field" list="extra-pool-names" style={{ width: "100%", fontSize: 14, marginTop: 6 }} value={draft.pool ?? ""} onChange={set("pool")} placeholder="e.g. November weekend yards" maxLength={80} />
          <datalist id="extra-pool-names">{poolNames.map((p) => <option key={p} value={p} />)}</datalist>
        </>
      )}
      <div style={{ fontSize: 11.5, color: "var(--quiet)", marginTop: 3 }}>
        {draft.share?.startsWith("item:") ? (
          <>Picking an item on another event links the two: what&apos;s left is counted across both events, and someone
          entering the second event sees what they already booked with the first. Give both the same number available.</>
        ) : otherEvents.length ? (
          <>Two events on the same weekend selling the same yards or sites? Pick the matching item on the other event
          and the two are counted as one.</>
        ) : (
          <>Two events on the same weekend selling the same yards or sites? Once the other event has its own item,
          pick it here and the two are counted as one.</>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn" style={{ fontSize: 14, padding: "8px 16px" }} onClick={onSubmit} disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
        {onCancel && <button className="btn-ghost" style={{ fontSize: 13 }} onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
    </div>
  );
}

// Keep items whose event is still on the go, soonest event first.
function sortOthers(data) {
  return (data ?? [])
    .map((r) => ({ id: r.id, name: r.name, kind: r.kind, pool: r.pool ?? null, event_id: r.event_id, event: r.events ?? null }))
    .filter((r) => r.event && ACTIVE_STATUSES.has(r.event.status))
    .sort((a, b) => String(a.event.starts_on ?? "").localeCompare(String(b.event.starts_on ?? "")) || a.event.name.localeCompare(b.event.name) || a.name.localeCompare(b.name));
}

export default function ExtrasManager({ event, onClose }) {
  const [rows, setRows] = useState(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(blankDraft());
  const [editing, setEditing] = useState(null); // { id, draft }
  const [busy, setBusy] = useState(false);
  const [poolNames, setPoolNames] = useState([]); // shared names already in use on any event (schema-v62)
  const [otherItems, setOtherItems] = useState([]); // bookable items on OTHER active events, for the dropdown
  const loadOthers = useCallback(async () => {
    if (!event?.id) return;
    const { data, error } = await supabase.from("event_extras")
      .select("id, name, kind, pool, event_id, events(name, status, starts_on)")
      .neq("event_id", event.id);
    if (error) {
      // Pre-v62 database (no pool column): the dropdown still works for
      // picking, the save then says the update is needed.
      if (!/pool/i.test(error.message ?? "")) return;
      const retry = await supabase.from("event_extras").select("id, name, kind, event_id, events(name, status, starts_on)").neq("event_id", event.id);
      if (retry.error) return;
      setOtherItems(sortOthers(retry.data));
      return;
    }
    setPoolNames([...new Set((data ?? []).map((r) => String(r.pool ?? "").trim()).filter(Boolean))].sort());
    setOtherItems(sortOthers(data));
  }, [event?.id]);
  useEffect(() => { loadOthers(); }, [loadOthers]);

  const load = useCallback(async () => {
    if (!event?.id) return;
    const { data, error: err } = await supabase
      .from("event_extras").select("*").eq("event_id", event.id)
      .order("sort_order").order("created_at");
    if (err) {
      if (/does not exist|schema cache/i.test(err.message ?? "")) setMissing(true); else setError(err.message);
      setRows([]);
      return;
    }
    setRows(data ?? []);
  }, [event?.id]);
  useEffect(() => { load(); }, [load]);

  const toRow = (d) => ({
    name: d.name.trim(),
    kind: EXTRA_KINDS[d.kind] ? d.kind : "other",
    unit: EXTRA_UNITS[d.unit] ? d.unit : "day",
    price_cents: Math.max(0, Math.round(parseFloat(d.price || "0") * 100) || 0),
    capacity: d.capacity === "" ? null : Math.max(0, parseInt(d.capacity, 10) || 0),
    first_night: isDated(d) && d.first_night ? d.first_night : null,
    last_night: isDated(d) && d.last_night ? d.last_night : null,
    description: d.description.trim() || null,
    pool: poolFor(d),
  });
  // The shared name to store: the picked item's existing name, a fresh
  // name for both when it has none yet, the typed name, or nothing.
  const pickedItem = (d) => (d.share?.startsWith("item:") ? otherItems.find((i) => `item:${i.id}` === d.share) : null);
  const poolFor = (d) => {
    const item = pickedItem(d);
    if (item) return String(item.pool ?? "").trim() || autoPoolName(item);
    if (d.share === "custom") return String(d.pool ?? "").trim() || null;
    return null;
  };
  // When the picked item on the other event has no shared name yet, give it
  // the same one so the two really are counted together.
  const linkOther = async (d, pool) => {
    const item = pickedItem(d);
    if (!item || !pool || String(item.pool ?? "").trim() === pool) return null;
    const { error: err } = await supabase.from("event_extras").update({ pool }).eq("id", item.id);
    return err ? `Saved, but the item on ${item.event?.name ?? "the other event"} couldn't be linked: ${err.message}` : null;
  };
  // A database without schema-v62 has no "pool" column: save the rest and
  // say so when a shared name was typed.
  const POOL_HINT = "Saved, but sharing with another event needs the database update — run supabase/schema-v62-extras-pool.sql, then edit the item and set the shared name again.";
  const writeRow = async (run, row) => {
    let { error: err } = await run(row);
    if (err && /pool/i.test(err.message ?? "")) {
      const { pool, ...rest } = row;
      ({ error: err } = await run(rest));
      if (!err && pool) err = { message: POOL_HINT, soft: true };
    }
    return err;
  };
  const validate = (d) => {
    if (!d.name.trim()) return "Give it a name, e.g. Yard or Powered camping site.";
    if (isDated(d) && d.first_night && d.last_night && d.first_night > d.last_night) return `The first ${unitNoun(d)} must be before the last ${unitNoun(d)}.`;
    return "";
  };

  const add = async () => {
    const msg = validate(draft); if (msg) { setError(msg); return; }
    setBusy(true); setError("");
    const row = { ...toRow(draft), event_id: event.id, sort_order: (rows?.length ?? 0) + 1 };
    const err = await writeRow((r) => supabase.from("event_extras").insert(r), row);
    const linkErr = err ? null : await linkOther(draft, row.pool);
    setBusy(false);
    if (err && !err.soft) { setError(err.message); return; }
    if (err?.soft || linkErr) setError(err?.message || linkErr);
    setDraft(blankDraft());
    await Promise.all([load(), loadOthers()]);
  };
  const saveEdit = async () => {
    const msg = validate(editing.draft); if (msg) { setError(msg); return; }
    setBusy(true); setError("");
    const id = editing.id;
    const row = toRow(editing.draft);
    const err = await writeRow((r) => supabase.from("event_extras").update(r).eq("id", id), row);
    const linkErr = err ? null : await linkOther(editing.draft, row.pool);
    setBusy(false);
    if (err && !err.soft) { setError(err.message); return; }
    if (err?.soft || linkErr) setError(err?.message || linkErr);
    setEditing(null);
    await Promise.all([load(), loadOthers()]);
  };
  const toggle = async (row) => {
    setBusy(true); setError("");
    const { error: err } = await supabase.from("event_extras").update({ active: !row.active }).eq("id", row.id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    await load();
  };
  const remove = async (row) => {
    const ok = window.confirm(
      `Delete "${row.name}"?\n\nIf anyone has already booked it the delete is refused — switch it off instead, which stops new bookings and keeps the existing ones.`
    );
    if (!ok) return;
    setBusy(true); setError("");
    const { error: err } = await supabase.from("event_extras").delete().eq("id", row.id);
    setBusy(false);
    if (err) {
      setError(/foreign key|violates|registration_extras/i.test(err.message ?? "")
        ? `"${row.name}" has bookings, so it can't be deleted. Switch it off instead.`
        : err.message);
      return;
    }
    await load();
  };

  // "shared with Winter Show" (the other events using the same shared name),
  // falling back to the name itself when no active event carries it.
  const sharedWith = (pool) => {
    const p = String(pool ?? "").trim();
    const names = [...new Set(otherItems.filter((i) => String(i.pool ?? "").trim() === p).map((i) => i.event?.name).filter(Boolean))];
    return names.length ? names.join(", ") : `"${p}"`;
  };

  return (
    <>
      <h2 className="display modal-title">🏕 Camping &amp; yards</h2>
      <p style={{ fontSize: 13, color: "var(--quiet)", margin: "-8px 0 12px" }}>
        What exhibitors can book with their entry for <strong>{event?.name}</strong>: yards per day, camping sites per
        night, or anything with one price for the whole event. Say how many exist and the site stops selling when they
        are gone. Per-day and per-night items are offered from the day before the event (arrival day) to its last day
        unless you set the dates.
      </p>
      {missing && <p className="modal-error">Run <code>supabase/schema-v61-event-extras.sql</code> in the Supabase SQL editor first, then reopen this.</p>}
      {error && <p className="modal-error">{error}</p>}

      {rows === null ? (
        <p style={{ color: "var(--quiet)", fontSize: 13 }}>Loading…</p>
      ) : rows.length === 0 ? (
        !missing && <p style={{ color: "var(--quiet)", fontSize: 13 }}>Nothing bookable yet — add the first item below.</p>
      ) : (
        <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
          {rows.map((r) => {
            if (editing?.id === r.id) {
              return (
                <ExtraForm key={r.id} title={`Edit ${r.name}`} draft={editing.draft}
                  setDraft={(fn) => setEditing((e) => ({ ...e, draft: typeof fn === "function" ? fn(e.draft) : fn }))}
                  onSubmit={saveEdit} onCancel={() => setEditing(null)} submitLabel="Save" busy={busy} event={event} poolNames={poolNames} otherItems={otherItems} />
              );
            }
            const nights = extraNights(r, event);
            return (
              <div key={r.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "8px 10px", background: r.active ? "#fff" : "var(--paper)", opacity: r.active ? 1 : 0.75 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                  <div style={{ fontWeight: 800, color: "var(--leather)" }}>
                    {KIND_ICON[r.kind] ?? ""} {r.name}
                    {!r.active && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--clay)" }}>Off</span>}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{priceLabel(r)}</div>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 2 }}>
                  {r.capacity == null ? "No limit" : `${r.capacity} available${isDated(r) ? ` each ${unitNoun(r)}` : ""}`}
                  {isDated(r) && nights.length ? ` · ${nights.length === 1 ? nightLabel(nights[0]) : `${nightLabel(nights[0])} to ${nightLabel(nights[nights.length - 1])} (${nights.length} ${unitNoun(r, nights.length)})`}` : ""}
                  {r.description ? ` · ${r.description}` : ""}
                  {r.pool ? ` · shared with ${sharedWith(r.pool)}` : ""}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  <button className="btn-ghost" onClick={() => { setError(""); setEditing({ id: r.id, draft: draftFrom(r, otherItems) }); }} disabled={busy}>Edit</button>
                  <button className="btn-ghost" onClick={() => toggle(r)} disabled={busy}>{r.active ? "Switch off" : "Switch on"}</button>
                  <button className="btn-ghost danger" onClick={() => remove(r)} disabled={busy}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!missing && !editing && (
        <ExtraForm title="Add something bookable" draft={draft} setDraft={setDraft} onSubmit={add} submitLabel="Add" busy={busy} event={event} poolNames={poolNames} otherItems={otherItems} />
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
        {event?.id && (
          <Link href={`/coordinator/extras?event=${event.id}`} className="btn-ghost" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", padding: "8px 12px" }}>
            🖨 Who booked what
          </Link>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={onClose}>Close</button>
      </div>
    </>
  );
}
