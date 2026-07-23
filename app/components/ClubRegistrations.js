"use client";

// A small editor for a member's (or family member's) association memberships:
// a list of { club, number } rows — AQHA, PHAA (Paint), AAA (Appaloosa) or any
// other club, each with the member number. Mirrors how a horse lists multiple
// registrations. `value` is the array; `onChange` gets the new array.
const CLUB_SUGGESTIONS = ["AQHA", "PHAA", "AAA", "ApHCA", "APHA"];

export default function ClubRegistrations({ value, onChange, label = "Association memberships", hint }) {
  const rows = Array.isArray(value) ? value : [];
  const update = (i, key, v) => onChange(rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));
  const add = () => onChange([...rows, { club: "", number: "" }]);
  const remove = (i) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div>
      {label && <label className="modal-label">{label}</label>}
      {hint && <p style={{ fontSize: 12, color: "var(--quiet)", margin: "0 0 6px" }}>{hint}</p>}
      {rows.map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 6, marginBottom: 6, alignItems: "center" }}>
          <input className="field" list="club-suggestions" style={{ fontSize: 15 }} placeholder="Club (e.g. PHAA)"
            value={r.club ?? ""} onChange={(e) => update(i, "club", e.target.value)} />
          <input className="field" style={{ fontSize: 15 }} placeholder="Member number"
            value={r.number ?? ""} onChange={(e) => update(i, "number", e.target.value)} />
          <button type="button" className="btn-ghost" aria-label="Remove club"
            style={{ padding: "6px 11px", color: "var(--clay)", borderColor: "var(--clay)", fontSize: 16, lineHeight: 1 }}
            onClick={() => remove(i)}>×</button>
        </div>
      ))}
      <datalist id="club-suggestions">
        {CLUB_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
      </datalist>
      <button type="button" className="btn-ghost" style={{ fontSize: 13 }} onClick={add}>
        + Add {rows.length ? "another " : ""}club
      </button>
    </div>
  );
}

// Turn stored data into rows to edit — seeds from the legacy single AQHA number
// so nothing is lost the first time a member is edited.
export function registrationsToRows(member) {
  const list = member?.association_registrations;
  if (Array.isArray(list) && list.length) {
    return list.map((r) => ({ club: r?.club ?? "", number: r?.number ?? "" }));
  }
  const rows = [];
  if (member?.aqha_member_number) rows.push({ club: "AQHA", number: String(member.aqha_member_number) });
  return rows;
}

// Clean rows for saving: drop blanks, trim; null when empty.
export function cleanRows(rows) {
  if (!Array.isArray(rows)) return null;
  const cleaned = rows
    .map((r) => ({ club: String(r?.club ?? "").trim(), number: String(r?.number ?? "").trim() }))
    .filter((r) => r.club || r.number);
  return cleaned.length ? cleaned : null;
}
