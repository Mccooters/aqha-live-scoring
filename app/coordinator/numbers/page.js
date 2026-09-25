"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";

const fmtMoney = (cents) => (cents != null ? `$${(cents / 100).toFixed(2)}` : "—");
const fmtBack = (n) => (n != null ? `#${String(n).padStart(3, "0")}` : "—");
const fmtDate = (s) =>
  s ? new Date(s).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" }) : "—";
const STATUS_LABEL = { pending: "pending payment", paid: "awaiting approval", approved: "approved", rejected: "rejected" };

export default function NewNumbersPage() {
  const [session, setSession] = useState(null);
  const [memberHorses, setMemberHorses] = useState([]);
  const [showEntries, setShowEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [owingOnly, setOwingOnly] = useState(false);
  const [registryNumbers, setRegistryNumbers] = useState(null); // Set of back numbers in `horses`
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    // Member horses — every new member needs numbers; the "additional" ones
    // carry a $5 fee (number_fee_* arrive with schema-v39; select * so this
    // still loads without it). club_member_horses is staff-readable.
    const { data: horses } = await supabase
      .from("club_member_horses")
      .select("*, club_members(member_name, email, season, status)")
      .order("created_at", { ascending: false });
    setMemberHorses((horses ?? []).filter((h) => h.club_members));

    // Which of those numbers are actually in the public registry? Member
    // horses used to reserve a number without a registry row, which left
    // gaps in the Horses tab — the "Add to registry" button below fixes them.
    const { data: reg } = await supabase.from("horses").select("back_number");
    setRegistryNumbers(new Set((reg ?? []).map((h) => h.back_number)));

    // Show-entry new-number requests (schema-v39 flag). Guarded: on an older
    // database the column doesn't exist and there simply are none.
    const { data: se, error: seErr } = await supabase
      .from("registration_entries")
      .select("id, horse_name, back_number, created_at, registrations(contact_name, status, event_id, events(name))")
      .eq("new_number", true)
      .order("created_at", { ascending: false });
    setShowEntries(seErr ? [] : (se ?? []).filter((e) => e.registrations));
    setLoading(false);
  }, [session]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel("new-numbers")
      .on("postgres_changes", { event: "*", schema: "public", table: "club_member_horses" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "registration_entries" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, load]);

  if (!session) {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <h1 className="display" style={{ fontWeight: 700, fontSize: 22 }}>Staff only</h1>
        <Link href="/coordinator" style={{ color: "var(--brass)" }}>← Sign in at coordinator dashboard</Link>
      </main>
    );
  }

  const missingFromRegistry = registryNumbers
    ? memberHorses.filter((h) => h.back_number != null && !registryNumbers.has(h.back_number))
    : [];

  // "AQHA Q-12345, PHAA 678" → rows for horse_registrations (best effort).
  const parseRegs = (text) => String(text ?? "").split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean)
    .map((t) => { const m = t.match(/^([A-Za-z]{2,10})[\s:#-]*([A-Za-z0-9-]+)$/); return m ? { club: m[1].toUpperCase(), registration_number: m[2] } : null; })
    .filter(Boolean);

  const addToRegistry = async (list) => {
    if (!list.length) return;
    if (!window.confirm(`Add ${list.length} member ${list.length === 1 ? "horse" : "horses"} to the Horses registry with the number${list.length === 1 ? "" : "s"} already assigned?\n\nNumbers are kept exactly as they are — this only fills in the missing registry rows.`)) return;
    setSyncing(true);
    let added = 0; const failed = [];
    // Dedupe by number: two member rows can share one horse (e.g. renewals).
    const seen = new Set();
    for (const h of list) {
      if (seen.has(h.back_number)) continue;
      seen.add(h.back_number);
      const { data: horse, error } = await supabase
        .from("horses")
        .insert({ back_number: h.back_number, name: h.horse_name, owner: h.club_members?.member_name ?? null })
        .select("id").single();
      if (error) { if (!/duplicate|23505/i.test(error.message ?? "")) failed.push(`${fmtBack(h.back_number)} ${h.horse_name}: ${error.message}`); continue; }
      added += 1;
      const regs = parseRegs(h.registrations);
      if (regs.length) await supabase.from("horse_registrations").insert(regs.map((r) => ({ horse_id: horse.id, ...r })));
    }
    setSyncing(false);
    if (failed.length) window.alert(`Added ${added}. Could not add:\n${failed.join("\n")}`);
    await load();
  };

  // A member horse "owes" when its additional-number fee isn't paid.
  const horseOwes = (h) => (h.number_fee_cents ?? 0) > 0 && !h.number_fee_paid;
  const owingCents = memberHorses.reduce((s, h) => s + (horseOwes(h) ? (h.number_fee_cents ?? 0) : 0), 0);
  const owingCount = memberHorses.filter(horseOwes).length;

  const shownMemberHorses = owingOnly ? memberHorses.filter(horseOwes) : memberHorses;
  const shownEntries = owingOnly ? [] : showEntries;

  const feeBadge = (h) => {
    if ((h.number_fee_cents ?? 0) === 0) return { label: "Included", bg: "#8B8073" };
    return h.number_fee_paid
      ? { label: "$5 paid", bg: "#2D7A52" }
      : { label: "$5 owing", bg: "var(--clay)" };
  };

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>
              Coordinator
            </div>
            <h1 className="display" style={{ fontWeight: 700, fontSize: 22, margin: "2px 0", color: "#F2EADB" }}>
              New Numbers
            </h1>
          </div>
          <Link href="/coordinator" style={{ color: "var(--brass-soft)", fontSize: 13, alignSelf: "center" }}>
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="wrap">
        <p style={{ fontSize: 13.5, color: "var(--quiet)", marginTop: 0 }}>
          Everyone who needs a back number made up — new members&apos; horses, and exhibitors who asked for
          a brand-new number when entering a show. A member&apos;s first number is covered by their membership;
          each additional horse is $5.
        </p>

        {/* Summary */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          {[
            { label: "Member horses", value: memberHorses.length },
            { label: "Show-entry numbers", value: showEntries.length },
            { label: "$5 fees owing", value: owingCount, warn: owingCount > 0 },
            { label: "Amount owing", value: fmtMoney(owingCents), warn: owingCents > 0 },
          ].map((s) => (
            <div key={s.label} className="card" style={{ flex: "1 1 130px", padding: "12px 16px", margin: 0, borderColor: s.warn ? "var(--clay)" : undefined }}>
              <div className="display" style={{ fontWeight: 700, fontSize: 22, color: s.warn ? "var(--clay)" : undefined }}>{s.value}</div>
              <div style={{ fontSize: 12, color: "var(--quiet)", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <label style={{ display: "inline-flex", gap: 8, alignItems: "center", marginBottom: 18, cursor: "pointer", fontSize: 13.5 }}>
          <input type="checkbox" checked={owingOnly} onChange={(e) => setOwingOnly(e.target.checked)} />
          Show only horses with a $5 fee still owing
        </label>

        {loading && <p style={{ color: "var(--quiet)" }}>Loading…</p>}

        {!loading && missingFromRegistry.length > 0 && (
          <div className="card" style={{ borderColor: "var(--clay)", marginBottom: 18, padding: "12px 16px" }}>
            <div style={{ fontWeight: 700, color: "var(--clay)", marginBottom: 4 }}>
              ⚠ {missingFromRegistry.length} member {missingFromRegistry.length === 1 ? "horse has" : "horses have"} a number but {missingFromRegistry.length === 1 ? "isn't" : "aren't"} in the Horses registry
            </div>
            <p style={{ fontSize: 12.5, color: "var(--quiet)", margin: "0 0 8px" }}>
              Their numbers are reserved, which is why the registry looks like it skips them. Add them so the
              registry is complete and the entry form recognises the horse by its number. (Rows marked "Missing" below.)
            </p>
            <button className="btn" style={{ background: "var(--leather)" }} onClick={() => addToRegistry(missingFromRegistry)} disabled={syncing}>
              {syncing ? "Adding…" : `Add ${missingFromRegistry.length === 1 ? "it" : "all " + missingFromRegistry.length} to the registry`}
            </button>
          </div>
        )}

        {/* Member horses */}
        <section className="card" style={{ marginBottom: 18 }}>
          <div className="card-head">
            <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Members&apos; horses</div>
          </div>
          {shownMemberHorses.length === 0 ? (
            <p style={{ color: "var(--quiet)", fontSize: 13, padding: "0 0 12px", margin: 0 }}>
              {owingOnly ? "No member horses with a fee owing." : "No member horses yet."}
            </p>
          ) : (
            <div style={{ overflowX: "auto", paddingBottom: 8 }}>
              <table>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Horse</th>
                    <th style={{ width: 70 }}>Number</th>
                    <th>Season</th>
                    <th>Number fee</th>
                    <th>Registry</th>
                  </tr>
                </thead>
                <tbody>
                  {shownMemberHorses.map((h) => {
                    const b = feeBadge(h);
                    const m = h.club_members ?? {};
                    return (
                      <tr key={h.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{m.member_name}</div>
                          <div style={{ fontSize: 11.5, color: "var(--quiet)" }}>
                            {m.email}{m.status && m.status !== "approved" ? ` · ${STATUS_LABEL[m.status] ?? m.status}` : ""}
                          </div>
                        </td>
                        <td style={{ fontWeight: 600 }}>{h.horse_name}</td>
                        <td className="display" style={{ fontWeight: 700, color: "var(--brass)" }}>{fmtBack(h.back_number)}</td>
                        <td style={{ color: "var(--quiet)", fontSize: 12.5 }}>{m.season}</td>
                        <td>
                          <span style={{ display: "inline-block", fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: b.bg, color: "#fff" }}>
                            {b.label}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                          {h.back_number == null || !registryNumbers ? "—"
                            : registryNumbers.has(h.back_number) ? <span style={{ color: "#2D7A52", fontWeight: 700 }}>✓ In registry</span>
                            : (
                              <button className="btn-ghost" style={{ padding: "2px 8px", fontSize: 11.5, borderColor: "var(--clay)", color: "var(--clay)" }}
                                onClick={() => addToRegistry([h])} disabled={syncing}>Missing — add</button>
                            )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Show-entry new numbers */}
        <section className="card">
          <div className="card-head">
            <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Show-entry new numbers</div>
          </div>
          {shownEntries.length === 0 ? (
            <p style={{ color: "var(--quiet)", fontSize: 13, padding: "0 0 12px", margin: 0 }}>
              {owingOnly ? "Hidden while showing fees owing only." : "No show entrants have asked for a new number."}
            </p>
          ) : (
            <div style={{ overflowX: "auto", paddingBottom: 8 }}>
              <table>
                <thead>
                  <tr>
                    <th>Exhibitor</th>
                    <th>Horse</th>
                    <th style={{ width: 70 }}>Number</th>
                    <th>Event</th>
                    <th>Requested</th>
                  </tr>
                </thead>
                <tbody>
                  {shownEntries.map((e) => {
                    const r = e.registrations ?? {};
                    return (
                      <tr key={e.id}>
                        <td style={{ fontWeight: 600 }}>{r.contact_name}</td>
                        <td>{e.horse_name}</td>
                        <td className="display" style={{ fontWeight: 700, color: "var(--brass)" }}>
                          {e.back_number != null ? fmtBack(e.back_number) : <span style={{ color: "var(--quiet)", fontWeight: 400, fontSize: 12 }}>pending</span>}
                        </td>
                        <td style={{ color: "var(--quiet)", fontSize: 12.5 }}>{r.events?.name ?? "—"}</td>
                        <td style={{ color: "var(--quiet)", fontSize: 12.5 }}>{fmtDate(e.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
