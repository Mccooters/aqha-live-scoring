"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { currentSeason, signupSeason, seasonLabel } from "../../../lib/membershipSeason";

const fmtMoney = (cents) => (cents != null ? `$${(cents / 100).toFixed(2)}` : "—");
const fmtDate = (s) =>
  s ? new Date(s).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" }) : "—";

const STATUS_LABEL = {
  pending: "pending payment",
  paid: "awaiting approval",
  approved: "approved",
  rejected: "rejected",
};

export default function MembershipsPage() {
  const [session, setSession] = useState(null);
  const [members, setMembers] = useState([]);
  const [types, setTypes] = useState([]);
  // Default to the CURRENT season (the one today's shows belong to), not the
  // coming season — so staff don't look at an empty/next-season list and think
  // this year's members are missing. "all" shows every season at once.
  const [season, setSeason] = useState(currentSeason());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [tableError, setTableError] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [acting, setActing] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [formError, setFormError] = useState("");

  // "membership required to enter" switch
  const [requireSetting, setRequireSetting] = useState({ enabled: false, include_clinics: false });
  const [settingReady, setSettingReady] = useState(false);
  const [settingSaving, setSettingSaving] = useState(false);
  const [settingUpdatedAt, setSettingUpdatedAt] = useState(null);
  const [bulkRenewing, setBulkRenewing] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    // club_member_people arrives with v25 — queried separately so this page
    // keeps working (with no people shown) until that migration is run.
    const [{ data: memberData, error: memberErr }, { data: typeData }, { data: peopleData }] = await Promise.all([
      supabase
        .from("club_members")
        .select("*, club_member_horses(*)")
        .order("created_at", { ascending: false }),
      supabase.from("membership_types").select("*").order("sort_order").order("name"),
      supabase.from("club_member_people").select("*").order("sort_order"),
    ]);
    if (memberErr?.message?.includes("does not exist")) {
      setTableError(true);
      setLoading(false);
      return;
    }
    const peopleByMember = {};
    (peopleData ?? []).forEach((p) => {
      (peopleByMember[p.member_id] ??= []).push(p);
    });
    setMembers((memberData ?? []).map((m) => ({ ...m, people: peopleByMember[m.id] ?? [] })));
    setTypes(typeData ?? []);
    setLoading(false);
  }, []);

  const loadSetting = useCallback(async () => {
    const { data, error } = await supabase
      .from("site_settings")
      .select("value, updated_at")
      .eq("key", "membership_required")
      .maybeSingle();
    if (error) { setSettingReady(false); return; }
    setSettingReady(true);
    setRequireSetting({
      enabled: Boolean(data?.value?.enabled),
      include_clinics: Boolean(data?.value?.include_clinics),
    });
    setSettingUpdatedAt(data?.updated_at ?? null);
  }, []);

  useEffect(() => { if (session) { load(); loadSetting(); } }, [session, load, loadSetting]);

  // Keep the "membership required" switch showing the TRUE database value even
  // when a second staff member changes it: refresh it live, and whenever this
  // staff member returns to the tab. Without this, one screen can sit on a
  // stale "on"/"off" while the real setting (what entries obey) is the other.
  useEffect(() => {
    if (!session) return;
    const settingsChannel = supabase
      .channel("site-settings")
      .on("postgres_changes", { event: "*", schema: "public", table: "site_settings" }, loadSetting)
      .subscribe();
    const onFocus = () => loadSetting();
    window.addEventListener("focus", onFocus);
    return () => {
      supabase.removeChannel(settingsChannel);
      window.removeEventListener("focus", onFocus);
    };
  }, [session, loadSetting]);

  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel("club-members")
      .on("postgres_changes", { event: "*", schema: "public", table: "club_members" }, load)
      .subscribe();
    // Separate channel for the v25 tables: if that migration hasn't been run
    // yet, only this channel fails — new-application updates keep flowing.
    const detailsChannel = supabase
      .channel("club-member-details")
      .on("postgres_changes", { event: "*", schema: "public", table: "club_member_people" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "club_member_horses" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(detailsChannel);
    };
  }, [session, load]);

  // Flip one field of the switch. Re-reads the live value from the database
  // first and merges onto THAT — so if the other staff member changed the
  // setting since this page loaded, we honour this tap without silently
  // overwriting their change with a stale value.
  const setRequirement = async (patch) => {
    setSettingSaving(true);
    const { data, error: readErr } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "membership_required")
      .maybeSingle();
    if (readErr) { alert("Could not check the current setting: " + readErr.message); setSettingSaving(false); return; }
    const current = {
      enabled: Boolean(data?.value?.enabled),
      include_clinics: Boolean(data?.value?.include_clinics),
    };
    const next = { ...current, ...patch };
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from("site_settings")
      .upsert({ key: "membership_required", value: next, updated_at: nowIso }, { onConflict: "key" });
    if (error) { alert("Could not save the setting: " + error.message); setSettingSaving(false); return; }
    setRequireSetting(next);
    setSettingReady(true);
    setSettingUpdatedAt(nowIso);
    setSettingSaving(false);
  };

  const act = async (memberId, action) => {
    const confirmMsg = action === "approve"
      ? "Approve this membership? The member will get a welcome email and can enter events online."
      : "Reject this application? The applicant will NOT be emailed automatically — contact them about any refund.";
    if (!confirm(confirmMsg)) return;
    setActing(memberId);
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch("/api/memberships/approve", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionData?.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ member_id: memberId, action }),
    });
    const data = await res.json();
    if (data.error) alert("Error: " + data.error);
    else await load();
    setActing(null);
  };

  // Carry an approved member over to the next season without them
  // re-registering — copies details, people and horses into a fresh approved
  // membership. Use once they've paid their renewal.
  const renewMember = async (member, targetSeason) => {
    if (!confirm(`Renew ${member.member_name} into the ${seasonLabel(targetSeason)}?\n\nThis copies their details, people and horses into a new, approved membership for that season — they don't need to re-register. Do this once they've paid their renewal (record it like any manual member).`)) return;
    setActing(member.id);
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch("/api/memberships/renew", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionData?.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ member_id: member.id, season: targetSeason }),
    });
    const data = await res.json();
    if (data.error) alert("Error: " + data.error);
    else { setSeason(data.season ?? targetSeason); await load(); }
    setActing(null);
  };

  // Bulk carry-over: renew every approved member of the season being viewed
  // into a target season in one go (skips anyone who already has one).
  const renewAll = async (fromSeason, targetSeason, approvedCount) => {
    if (!confirm(`Renew all ${approvedCount} approved member${approvedCount === 1 ? "" : "s"} from ${fromSeason} into the ${seasonLabel(targetSeason)}?\n\nEach is copied over as an approved membership (details, people, horses). Anyone who already has a ${targetSeason} membership is skipped. Do this once they've renewed.`)) return;
    setBulkRenewing(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch("/api/memberships/renew", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionData?.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ source_season: fromSeason, season: targetSeason }),
    });
    const data = await res.json();
    if (data.error) alert("Error: " + data.error);
    else {
      alert(`Renewed ${data.created} member${data.created === 1 ? "" : "s"} into ${targetSeason}.${data.skipped ? ` ${data.skipped} already had one and were skipped.` : ""}`);
      setSeason(targetSeason);
      await load();
    }
    setBulkRenewing(false);
  };

  // Remove a stray application — only ever an unpaid pending one or a rejected
  // one (never a paid/approved membership, which is a record). Handy for
  // clearing a duplicate left behind by a double submission.
  const deleteApplication = async (member) => {
    if (!confirm(`Delete this ${member.status} application for ${member.member_name}?\n\nThis permanently removes it (and its horses/people). Only do this for a duplicate or mistaken entry — it does NOT refund anything.`)) return;
    setActing(member.id);
    const { error } = await supabase
      .from("club_members")
      .delete()
      .eq("id", member.id)
      .in("status", ["pending", "rejected"]);
    if (error) alert("Error: " + error.message);
    else await load();
    setActing(null);
  };

  const markPaidManually = async (member) => {
    if (!confirm(`Mark ${member.member_name}'s application as paid?\n\nOnly do this if the fee was received outside Square (cash, bank transfer, or a payment confirmed manually).`)) return;
    const { error } = await supabase
      .from("club_members")
      .update({ status: "paid" })
      .eq("id", member.id)
      .eq("status", "pending");
    if (error) alert(error.message);
    else await load();
  };

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const closeModal = () => { setModal(null); setForm({}); setFormError(""); };

  const saveManualMember = async () => {
    if (!form.member_name?.trim()) { setFormError("Name is required"); return; }
    if (!form.email?.trim() || !form.email.includes("@")) { setFormError("A valid email is required"); return; }
    const type = types.find((t) => t.id === form.type_id);
    // "all" is a view filter, not a real season — add to the current season.
    const addSeason = season === "all" ? currentSeason() : season;
    const { error } = await supabase.from("club_members").insert({
      season: addSeason,
      membership_type_id: type?.id ?? null,
      membership_type_name: type?.name ?? null,
      member_name: form.member_name.trim(),
      email: form.email.trim(),
      phone: form.phone?.trim() || null,
      total_cents: type?.fee_cents ?? 0,
      status: "approved",
      approved_at: new Date().toISOString(),
    });
    if (error) { setFormError(error.message); return; }
    await load();
    closeModal();
  };

  // The included_people column arrives with v25 — since types are loaded
  // with select *, its presence on a loaded row tells us the migration ran.
  const typesHavePeopleColumn =
    types.length > 0 && Object.prototype.hasOwnProperty.call(types[0], "included_people");

  const saveType = async () => {
    if (!form.name?.trim()) { setFormError("Name is required"); return; }
    const fee = form.fee === "" || form.fee == null ? 0 : Math.round(parseFloat(form.fee) * 100);
    if (isNaN(fee) || fee < 0) { setFormError("Enter a valid price (or 0 for free)"); return; }
    const row = {
      name: form.name.trim(),
      description: form.description?.trim() || null,
      fee_cents: fee,
      active: form.active !== "no",
      sort_order: parseInt(form.sort_order, 10) || 0,
    };
    if (typesHavePeopleColumn) {
      row.included_people = Math.max(1, parseInt(form.included_people, 10) || 1);
    }
    const { error } = modal.typeRow
      ? await supabase.from("membership_types").update(row).eq("id", modal.typeRow.id)
      : await supabase.from("membership_types").insert(row);
    if (error) { setFormError(error.message); return; }
    await load();
    closeModal();
  };

  if (!session) {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <h1 className="display" style={{ fontWeight: 700, fontSize: 22 }}>Staff only</h1>
        <Link href="/coordinator" style={{ color: "var(--brass)" }}>← Sign in at coordinator dashboard</Link>
      </main>
    );
  }

  if (tableError) {
    return (
      <main className="wrap" style={{ maxWidth: 640 }}>
        <h1 className="display" style={{ fontWeight: 700, fontSize: 24, margin: "0 0 12px" }}>Memberships</h1>
        <div className="card" style={{ padding: 20 }}>
          <p style={{ color: "var(--clay)", fontWeight: 700, margin: "0 0 8px" }}>One-time database setup required</p>
          <p style={{ fontSize: 13.5, margin: 0 }}>
            Run <strong>schema-v23-club-memberships.sql</strong> in the Supabase SQL Editor
            (see <code>supabase/MIGRATIONS.md</code> for the steps), then reload this page.
          </p>
        </div>
      </main>
    );
  }

  const dataSeasons = [...new Set(members.map((m) => m.season))];
  const seasons = [...new Set([signupSeason(), currentSeason(), ...dataSeasons])].sort().reverse();
  // A name/email search spans EVERY season (the point is "is this person a
  // member at all?"), so it overrides the season filter while typing.
  const q = query.trim().toLowerCase();
  const matchesQuery = (m) => !q || [m.member_name, m.email, ...((m.people ?? []).map((p) => p.name))]
    .some((v) => String(v ?? "").toLowerCase().includes(q));
  const searching = q.length > 0;
  const seasonMembers = members.filter((m) =>
    searching ? matchesQuery(m) : (season === "all" || m.season === season)
  );
  // Show which season each card belongs to when the list isn't pinned to one.
  const showCardSeason = searching || season === "all";
  // July heads-up: while viewing the current season, point out that next
  // season's early sign-ups live under a different tab.
  const nextSeason = signupSeason();
  const nextSeasonCount = nextSeason !== currentSeason()
    ? members.filter((m) => m.season === nextSeason).length
    : 0;
  const byStatus = (s) => seasonMembers.filter((m) => m.status === s);
  const revenue = seasonMembers
    .filter((m) => m.status === "paid" || m.status === "approved")
    .reduce((sum, m) => sum + (m.total_cents ?? 0), 0);
  // Awaiting-approval applications first, then pending payment, then the rest
  const statusRank = { paid: 0, pending: 1, approved: 2, rejected: 3 };
  const sortedMembers = [...seasonMembers].sort((a, b) =>
    (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
    new Date(b.created_at) - new Date(a.created_at)
  );

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>
              Coordinator
            </div>
            <h1 className="display" style={{ fontWeight: 700, fontSize: 22, margin: "2px 0", color: "#F2EADB" }}>
              Memberships
            </h1>
          </div>
          <Link href="/coordinator" style={{ color: "var(--brass-soft)", fontSize: 13, alignSelf: "center" }}>
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="wrap">
        {/* Season selector + search + add */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ flex: "1 1 200px" }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--quiet)", marginBottom: 4 }}>Season (1 Aug – 31 Jul)</label>
            <select className="field" value={season} onChange={(e) => setSeason(e.target.value)} disabled={searching} style={{ fontSize: 15, width: "100%", opacity: searching ? 0.5 : 1 }}>
              {seasons.map((s) => (
                <option key={s} value={s}>{s}{s === signupSeason() ? " (new sign-ups)" : s === currentSeason() ? " (current)" : ""}</option>
              ))}
              <option value="all">All seasons</option>
            </select>
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--quiet)", marginBottom: 4 }}>Find a member (all seasons)</label>
            <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or email…" style={{ fontSize: 15, width: "100%" }} />
          </div>
          <button className="btn-ghost" onClick={() => { setModal({ type: "addMember" }); setForm({ type_id: types[0]?.id ?? "" }); }}>
            + Add member manually
          </button>
        </div>
        {searching ? (
          <p style={{ fontSize: 12.5, color: "var(--quiet)", margin: "0 0 20px" }}>
            Showing all-season matches for “{query.trim()}”. <button onClick={() => setQuery("")} style={{ background: "none", border: "none", color: "var(--brass)", cursor: "pointer", padding: 0, fontSize: 12.5, textDecoration: "underline" }}>Clear search</button>
          </p>
        ) : season === currentSeason() && nextSeasonCount > 0 ? (
          <p style={{ fontSize: 12.5, color: "var(--quiet)", margin: "0 0 20px" }}>
            Viewing the current season. There {nextSeasonCount === 1 ? "is" : "are"} also <strong>{nextSeasonCount}</strong> for next season ({nextSeason}) — switch the season above, or search, to see {nextSeasonCount === 1 ? "them" : "those"}.
          </p>
        ) : (
          <div style={{ marginBottom: 20 }} />
        )}

        {/* Summary */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          {[
            { label: "Approved members", value: byStatus("approved").length },
            { label: "Awaiting approval", value: byStatus("paid").length },
            { label: "Pending payment", value: byStatus("pending").length },
            { label: "Membership revenue", value: fmtMoney(revenue) },
          ].map((s) => (
            <div key={s.label} className="card" style={{ flex: "1 1 120px", padding: "12px 16px", margin: 0 }}>
              <div className="display" style={{ fontWeight: 700, fontSize: 22 }}>{s.value}</div>
              <div style={{ fontSize: 12, color: "var(--quiet)", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Bulk renew — carry a whole season's approved members forward */}
        {!searching && season !== "all" && byStatus("approved").length > 0 &&
          [...new Set([currentSeason(), signupSeason()])].filter((s) => s !== season).length > 0 && (
          <section className="card" style={{ marginBottom: 20, borderColor: "var(--brass)" }}>
            <div style={{ padding: "12px 16px" }}>
              <div className="display" style={{ fontWeight: 600, fontSize: 15 }}>
                Renew the whole {season} season
              </div>
              <div style={{ fontSize: 12.5, color: "var(--quiet)", margin: "2px 0 10px" }}>
                Carry all {byStatus("approved").length} approved {season} member{byStatus("approved").length === 1 ? "" : "s"} over
                in one go (details, people and horses). Anyone who already has the target season is skipped.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[...new Set([currentSeason(), signupSeason()])].filter((s) => s !== season).map((s) => (
                  <button key={s} className="btn" style={{ background: "var(--brass)", fontSize: 13, padding: "8px 16px" }}
                    onClick={() => renewAll(season, s, byStatus("approved").length)} disabled={bulkRenewing}>
                    {bulkRenewing ? "Renewing…" : `↻ Renew all into ${s}`}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Membership-required switch */}
        <section className="card">
          <div className="card-head">
            <div>
              <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Require membership to enter events</div>
              <div style={{ fontSize: 12, color: "var(--quiet)", marginTop: 2 }}>
                When on, the online entry form only accepts entries from email addresses with an approved,
                current membership. Turn this on once your members have been signed up.
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingBottom: 10 }}>
            <button className="btn-ghost"
              style={requireSetting.enabled
                ? { background: "#2D7A52", borderColor: "#2D7A52", color: "#fff" }
                : {}}
              disabled={settingSaving}
              onClick={() => setRequirement({ enabled: !requireSetting.enabled })}>
              {settingSaving ? "Saving…" : requireSetting.enabled ? "✓ Required for shows" : "Not required (off)"}
            </button>
            <button className="btn-ghost"
              style={requireSetting.include_clinics
                ? { background: "#2D7A52", borderColor: "#2D7A52", color: "#fff" }
                : {}}
              disabled={settingSaving || !requireSetting.enabled}
              onClick={() => setRequirement({ include_clinics: !requireSetting.include_clinics })}>
              {requireSetting.include_clinics ? "✓ Also required for clinics" : "Clinics open to everyone"}
            </button>
          </div>
          {settingReady && (
            <p style={{ fontSize: 12, color: "var(--quiet)", margin: "0 0 10px" }}>
              This is a single club-wide switch — it updates live here for every staff member.
              {settingUpdatedAt ? ` Last changed ${fmtDate(settingUpdatedAt)}.` : ""}
            </p>
          )}
          {!settingReady && (
            <p style={{ fontSize: 12, color: "var(--quiet)", margin: "0 0 10px" }}>
              Run <code>schema-v22-site-settings.sql</code> and <code>schema-v23-club-memberships.sql</code> to enable this switch.
            </p>
          )}
        </section>

        {/* Membership types */}
        <section className="card">
          <div className="card-head">
            <div>
              <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Membership types & pricing</div>
              <div style={{ fontSize: 12, color: "var(--quiet)", marginTop: 2 }}>
                These appear on the public join form. Set prices here once they&apos;re decided — $0 means
                applications skip payment and go straight to approval.
              </div>
            </div>
            <button className="btn-ghost" onClick={() => { setModal({ type: "editType" }); setForm({ active: "yes", fee: "", sort_order: String(types.length + 1) }); }}>
              + Add type
            </button>
          </div>
          {types.length === 0 ? (
            <p style={{ padding: "0 0 12px", color: "var(--quiet)", fontSize: 13, margin: 0 }}>No membership types yet — add one so people can join.</p>
          ) : (
            <div style={{ overflowX: "auto", paddingBottom: 8 }}>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th style={{ textAlign: "right" }}>Price</th>
                    <th>Shown on form</th>
                    <th style={{ width: 1 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {types.map((t) => (
                    <tr key={t.id} style={{ opacity: t.active ? 1 : 0.55 }}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{t.name}</div>
                        {t.description && <div style={{ fontSize: 12, color: "var(--quiet)" }}>{t.description}</div>}
                        {(t.included_people ?? 1) > 1 && (
                          <div style={{ fontSize: 12, color: "var(--brass)", fontWeight: 700 }}>
                            covers {t.included_people} people
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{(t.fee_cents ?? 0) > 0 ? fmtMoney(t.fee_cents) : "Free"}</td>
                      <td>{t.active ? "Yes" : "Hidden"}</td>
                      <td>
                        <button className="btn-ghost" onClick={() => {
                          setModal({ type: "editType", typeRow: t });
                          setForm({
                            name: t.name,
                            description: t.description ?? "",
                            fee: ((t.fee_cents ?? 0) / 100).toFixed(2),
                            active: t.active ? "yes" : "no",
                            sort_order: String(t.sort_order ?? 0),
                            included_people: String(t.included_people ?? 1),
                          });
                        }}>Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Applications list */}
        {loading && <p style={{ color: "var(--quiet)" }}>Loading…</p>}

        {!loading && seasonMembers.length === 0 && (
          <div className="card" style={{ textAlign: "center", padding: "30px 20px" }}>
            <p className="display" style={{ fontSize: 18, color: "var(--quiet)", margin: 0 }}>
              {searching
                ? `No members match “${query.trim()}” in any season.`
                : season === "all"
                ? "No memberships yet."
                : `No memberships for the ${season} season yet.`}
            </p>
            <p style={{ fontSize: 13, color: "var(--quiet)", marginTop: 8 }}>
              {searching
                ? "Try part of the name or email, or check the spelling."
                : "Share the Members page so people can join online, or add members manually."}
            </p>
          </div>
        )}

        {sortedMembers.map((m) => {
          const isExpanded = expanded === m.id;
          const horses = m.club_member_horses ?? [];
          const people = m.people ?? [];
          // Green = done, clay = needs the committee's attention, amber = waiting on payment
          const badgeClass = m.status === "approved" ? "completed" : m.status === "paid" ? "live" : m.status === "pending" ? "closed" : "archived";
          return (
            <section key={m.id} className="card" style={{ opacity: m.status === "rejected" ? 0.6 : 1 }}>
              <div className="card-head" style={{ cursor: "pointer" }}
                onClick={() => setExpanded(isExpanded ? null : m.id)}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{m.member_name}</div>
                  <div style={{ fontSize: 12.5, color: "var(--quiet)" }}>
                    {showCardSeason && <><strong style={{ color: "var(--leather)" }}>{m.season}</strong> · </>}
                    {m.email} · {m.membership_type_name || "Membership"} · applied {fmtDate(m.created_at)}
                    {people.length > 0 && <> · {people.length + 1} people</>}
                    {horses.length > 0 && <> · {horses.length} {horses.length === 1 ? "horse" : "horses"}</>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{fmtMoney(m.total_cents)}</span>
                  <span className={`badge ${badgeClass}`}>{STATUS_LABEL[m.status] ?? m.status}</span>
                  <span style={{ fontSize: 13, color: "var(--quiet)" }}>{isExpanded ? "▲" : "▼"}</span>
                </div>
              </div>

              {isExpanded && (
                <div style={{ paddingBottom: 12 }}>
                  <div style={{ fontSize: 13.5, color: "var(--ink)", display: "grid", gap: 3 }}>
                    {m.phone && <div><strong>Phone:</strong> {m.phone}</div>}
                    {m.address && <div><strong>Address:</strong> {m.address}</div>}
                    {m.aqha_member_number && <div><strong>AQHA member number:</strong> {m.aqha_member_number}</div>}
                    {m.other_memberships && <div><strong>Other associations:</strong> {m.other_memberships}</div>}
                    {(m.emergency_contact_name || m.emergency_contact_phone) && (
                      <div><strong>Emergency contact:</strong> {[m.emergency_contact_name, m.emergency_contact_phone].filter(Boolean).join(" · ")}</div>
                    )}
                    {m.interests && <div><strong>Wants from the club:</strong> {m.interests}</div>}
                    {m.applicant_notes && <div><strong>Feedback:</strong> {m.applicant_notes}</div>}
                    {m.approved_at && <div><strong>Approved:</strong> {fmtDate(m.approved_at)}</div>}
                    {people.length > 0 && (
                      <div>
                        <strong>People on this membership:</strong>{" "}
                        {[`${m.member_name} (applicant)`, ...people.map((p) => `${p.name} (${p.person_type === "child" ? "child" : "adult"})`)].join(" · ")}
                      </div>
                    )}
                  </div>

                  {horses.length > 0 && (
                    <div style={{ marginTop: 10, overflowX: "auto" }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Horse</th>
                            <th>Back #</th>
                            <th>Breed / colour</th>
                            <th>Registrations</th>
                            <th>Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {horses.map((h) => (
                            <tr key={h.id}>
                              <td style={{ fontWeight: 600 }}>{h.horse_name}</td>
                              <td className="display" style={{ fontWeight: 700, color: "var(--brass)" }}>
                                {h.back_number != null ? `#${String(h.back_number).padStart(3, "0")}` : "—"}
                              </td>
                              <td>{h.breed || "—"}</td>
                              <td>{h.registrations || "—"}</td>
                              <td style={{ color: "var(--quiet)" }}>{h.notes || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p style={{ fontSize: 12, color: "var(--quiet)", margin: "6px 0 0" }}>
                        New horses aren&apos;t added to the registry automatically — add them on the{" "}
                        <Link href="/registry" style={{ color: "var(--brass)" }}>Registry page</Link> once approved.
                      </p>
                    </div>
                  )}

                  <div style={{ padding: "12px 0 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {(m.status === "paid" || m.status === "pending") && (
                      <button className="btn" style={{ background: "#2D7A52", fontSize: 13, padding: "8px 16px" }}
                        onClick={() => act(m.id, "approve")} disabled={acting === m.id}>
                        {acting === m.id ? "Working…" : "✓ Approve membership"}
                      </button>
                    )}
                    {m.status === "approved" && [...new Set([currentSeason(), signupSeason()])]
                      .filter((s) => s !== m.season)
                      .map((s) => (
                        <button key={s} className="btn" style={{ background: "var(--brass)", fontSize: 13, padding: "8px 16px" }}
                          onClick={() => renewMember(m, s)} disabled={acting === m.id}
                          title="Carry this member over without re-registering">
                          {acting === m.id ? "Working…" : `↻ Renew into ${s}`}
                        </button>
                      ))}
                    {m.status === "pending" && (m.total_cents ?? 0) > 0 && (
                      <button className="btn-ghost" style={{ fontSize: 13 }}
                        onClick={() => markPaidManually(m)}>
                        Mark paid (received outside Square)
                      </button>
                    )}
                    {(m.status === "paid" || m.status === "pending") && (
                      <button className="btn-ghost" style={{ color: "var(--clay)", borderColor: "var(--clay)", fontSize: 13 }}
                        onClick={() => act(m.id, "reject")} disabled={acting === m.id}>
                        Reject
                      </button>
                    )}
                    {(m.status === "pending" || m.status === "rejected") && (
                      <button className="btn-ghost" style={{ color: "var(--clay)", borderColor: "var(--clay)", fontSize: 13 }}
                        onClick={() => deleteApplication(m)} disabled={acting === m.id}
                        title="Remove a duplicate or mistaken application">
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </main>

      {modal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="modal-sheet">
            {modal.type === "addMember" && (
              <>
                <h2 className="display modal-title">Add member manually</h2>
                <p style={{ marginTop: 0, fontSize: 13, color: "var(--quiet)" }}>
                  For members who joined on paper or paid in person. They&apos;re approved immediately —
                  {" "}{seasonLabel(season === "all" ? currentSeason() : season)}.
                </p>
                <label className="modal-label">Full name *</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }}
                  value={form.member_name ?? ""} onChange={setField("member_name")} autoFocus />
                <label className="modal-label">Email *</label>
                <input className="field" type="email" style={{ width: "100%", fontSize: 16 }}
                  value={form.email ?? ""} onChange={setField("email")} />
                <label className="modal-label">Phone</label>
                <input className="field" type="tel" style={{ width: "100%", fontSize: 16 }}
                  value={form.phone ?? ""} onChange={setField("phone")} />
                <label className="modal-label">Membership type</label>
                <select className="field" style={{ width: "100%", fontSize: 16 }}
                  value={form.type_id ?? ""} onChange={setField("type_id")}>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({(t.fee_cents ?? 0) > 0 ? fmtMoney(t.fee_cents) : "Free"})</option>
                  ))}
                </select>
                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={saveManualMember}>Add member</button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                </div>
              </>
            )}

            {modal.type === "editType" && (
              <>
                <h2 className="display modal-title">{modal.typeRow ? "Edit membership type" : "Add membership type"}</h2>
                <label className="modal-label">Name *</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }}
                  value={form.name ?? ""} onChange={setField("name")}
                  placeholder="e.g. Senior membership" autoFocus={!modal.typeRow} />
                <label className="modal-label">Description</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }}
                  value={form.description ?? ""} onChange={setField("description")}
                  placeholder="Shown under the name on the join form" />
                <label className="modal-label">Price (AUD)</label>
                <input className="field" type="number" step="0.01" min="0" style={{ width: "100%", fontSize: 16 }}
                  value={form.fee ?? ""} onChange={setField("fee")}
                  placeholder="0.00 = free" />
                {typesHavePeopleColumn ? (
                  <>
                    <label className="modal-label">People included (counting the applicant)</label>
                    <input className="field" type="number" min="1" style={{ width: "100%", fontSize: 16 }}
                      value={form.included_people ?? "1"} onChange={setField("included_people")}
                      placeholder="1" />
                    <p style={{ fontSize: 12, color: "var(--quiet)", margin: "4px 0 0" }}>
                      e.g. 4 for a family of 2 adults + 2 children. The join form and member portal
                      collect the extra people&apos;s names.
                    </p>
                  </>
                ) : types.length > 0 ? (
                  <p style={{ fontSize: 12, color: "var(--quiet)", margin: "10px 0 0" }}>
                    Run <code>schema-v25-member-accounts.sql</code> to set how many people a membership covers.
                  </p>
                ) : null}
                <label className="modal-label">Shown on the join form?</label>
                <select className="field" style={{ width: "100%", fontSize: 16 }}
                  value={form.active ?? "yes"} onChange={setField("active")}>
                  <option value="yes">Yes — people can pick it</option>
                  <option value="no">No — hidden</option>
                </select>
                <label className="modal-label">Sort order</label>
                <input className="field" type="number" style={{ width: "100%", fontSize: 16 }}
                  value={form.sort_order ?? ""} onChange={setField("sort_order")} />
                {formError && <p className="modal-error">{formError}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={saveType}>Save</button>
                  <button className="btn-ghost" style={{ padding: "10px 18px" }} onClick={closeModal}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
