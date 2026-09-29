"use client";
import { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "../../../../lib/supabaseClient";
import { activeSeasons, currentSeason, seasonLabel } from "../../../../lib/membershipSeason";

// Printable list of the club's current members (owner's request, Sept 2026):
// every APPROVED membership for the chosen season, in name order, with the
// people covered by each one. Staff only (club_members is staff-readable).

const regLabel = (list, fallback) =>
  Array.isArray(list) && list.length
    ? list.map((r) => [r.club, r.number].filter(Boolean).join(" ").trim()).filter(Boolean).join(", ")
    : (fallback ? `AQHA ${fallback}` : "");

function PrintStyles() {
  return (
    <style jsx global>{`
      .print-toolbar { max-width: 980px; margin: 0 auto; padding: 14px 18px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .print-toolbar a, .print-toolbar button, .print-toolbar select { text-decoration: none; border: 1px solid #d8d0c3; background: #fff; color: #3A2A1C; border-radius: 7px; padding: 7px 11px; font: 700 12px Archivo, sans-serif; }
      .member-sheet { max-width: 980px; margin: 0 auto 40px; padding: 12mm 10mm; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; box-shadow: 0 12px 30px rgba(42,30,18,.14); }
      .member-sheet h1 { margin: 0; text-align: center; font-size: 15px; font-weight: 800; }
      .member-sheet .sub { margin: 2px 0 12px; text-align: center; font-size: 10.5px; color: #333; }
      .member-table { width: 100%; border-collapse: collapse; font-size: 10px; line-height: 1.25; }
      .member-table th { text-align: left; border-bottom: 1.5px solid #000; padding: 4px 5px; font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em; }
      .member-table td { border-bottom: 1px solid #ccc; padding: 4px 5px; vertical-align: top; }
      .member-table tr { break-inside: avoid; }
      .member-table .n { width: 22px; color: #666; text-align: right; }
      .member-table .people { color: #333; }
      .member-table .people span { display: block; }
      .member-sheet .foot { margin-top: 10px; font-size: 9px; color: #555; text-align: right; }
      @page { size: A4; margin: 10mm; }
      @media print {
        body { background: #fff !important; }
        .header, .print-toolbar, .bottom-nav, nav { display: none !important; }
        .member-sheet { max-width: none; margin: 0; padding: 0; box-shadow: none; }
        .member-table thead { display: table-header-group; }
      }
      @media screen and (max-width: 760px) { .member-sheet { padding: 16px; } }
    `}</style>
  );
}

function MemberListInner() {
  const params = useSearchParams();
  const [session, setSession] = useState(null);
  const [members, setMembers] = useState(null);
  const [people, setPeople] = useState([]);
  const [season, setSeason] = useState(params.get("season") || currentSeason());
  const [seasons, setSeasons] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    const [{ data: m, error: mErr }, { data: p }] = await Promise.all([
      supabase.from("club_members").select("*").eq("status", "approved").order("member_name"),
      supabase.from("club_member_people").select("*").order("sort_order"),
    ]);
    if (mErr) { setError(mErr.message); setMembers([]); return; }
    setMembers(m ?? []);
    setPeople(p ?? []);
    const found = [...new Set((m ?? []).map((r) => r.season).filter(Boolean))];
    activeSeasons().forEach((s) => { if (!found.includes(s)) found.push(s); });
    setSeasons(found.sort().reverse());
  }, [session]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const list = (members ?? []).filter((m) => season === "all" || m.season === season);
    // One row per person: the applicant first, then each person on a family
    // membership indented under them — so the printed list is a headcount.
    return list
      .sort((a, b) => String(a.member_name ?? "").localeCompare(String(b.member_name ?? ""), "en", { sensitivity: "base" }))
      .map((m) => ({
        m,
        extras: people.filter((p) => p.member_id === m.id && String(p.name ?? "").trim()),
      }));
  }, [members, people, season]);

  if (!session) {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <h1 className="display" style={{ fontWeight: 700, fontSize: 22 }}>Staff only</h1>
        <Link href="/coordinator" style={{ color: "var(--brass)" }}>← Sign in at coordinator dashboard</Link>
      </main>
    );
  }

  const headcount = rows.reduce((s, r) => s + 1 + r.extras.length, 0);
  const printedAt = new Date().toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <PrintStyles />
      <div className="print-toolbar">
        <Link href="/coordinator/memberships">← Memberships</Link>
        <select value={season} onChange={(e) => setSeason(e.target.value)}>
          {seasons.map((s) => <option key={s} value={s}>{s}{s === currentSeason() ? " (current)" : ""}</option>)}
          <option value="all">All seasons</option>
        </select>
        <button onClick={() => window.print()}>🖨 Print / Save PDF</button>
        <span style={{ fontSize: 12, color: "var(--quiet)" }}>
          {rows.length} {rows.length === 1 ? "membership" : "memberships"} · {headcount} {headcount === 1 ? "person" : "people"}
        </span>
      </div>

      <div className="member-sheet">
        <h1>HUNTER COAST QUARTER HORSE ASSOCIATION — Members</h1>
        <div className="sub">{season === "all" ? "All seasons" : seasonLabel(season)} · approved memberships only · {rows.length} memberships, {headcount} people</div>
        {error && <p style={{ color: "#C24A2E", fontWeight: 700 }}>{error}</p>}
        {members === null ? <p>Loading…</p> : rows.length === 0 ? (
          <p style={{ textAlign: "center", color: "#555" }}>No approved members for this season.</p>
        ) : (
          <table className="member-table">
            <thead>
              <tr>
                <th className="n">#</th>
                <th>Member</th>
                <th>Membership</th>
                <th>Association nos.</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Also covers</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, extras }, i) => (
                <tr key={m.id}>
                  <td className="n">{i + 1}</td>
                  <td><strong>{m.member_name}</strong>{season === "all" ? <span style={{ display: "block", color: "#666" }}>{m.season}</span> : null}</td>
                  <td>{m.membership_type_name ?? "—"}</td>
                  <td>{regLabel(m.association_registrations, m.aqha_member_number) || "—"}</td>
                  <td>{m.email ?? "—"}</td>
                  <td>{m.phone ?? "—"}</td>
                  <td className="people">
                    {extras.length ? extras.map((p) => (
                      <span key={p.id}>
                        {p.name}{p.person_type === "child" ? " (child)" : ""}{regLabel(p.association_registrations, p.aqha_member_number) ? ` · ${regLabel(p.association_registrations, p.aqha_member_number)}` : ""}
                      </span>
                    )) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="foot">Printed {printedAt} · HCQHA Live Scoring</div>
      </div>
    </>
  );
}

export default function MemberListPage() {
  return (
    <Suspense fallback={<main className="wrap"><p style={{ color: "var(--quiet)" }}>Loading…</p></main>}>
      <MemberListInner />
    </Suspense>
  );
}
