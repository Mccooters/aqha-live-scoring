"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import ReadOnlyBanner from "../../components/ReadOnlyBanner";
import SponsorBoard from "../../components/Sponsors";
import { TIERS, tierOf, groupByTier, classIdsOf, sortSponsors, normaliseUrl } from "../../../lib/sponsors";

// Staff: the club's sponsors (schema-v69). Add a sponsor with its logo, tier
// and link; tie it to one event (or leave it club-wide) and, for Silver and
// Class/Ribbon sponsors, to the classes it sponsors. The public pages take
// it from here: logo size by tier, "Proudly presented by" for Platinum,
// "Proudly sponsored by …" on sponsored classes, a thank-you board on the
// home page and every event page.

const ACTIVE_STATUSES = ["pre_open", "open", "closed", "live", "completed"];

const blankForm = (eventId = "") => ({
  name: "", tier: "gold", logo_url: "", website_url: "", blurb: "", sponsored_for: "",
  event_id: eventId, class_ids: [], active: true, logoFile: null,
});

export default function SponsorsPage() {
  const [session, setSession] = useState(null);
  const [sponsors, setSponsors] = useState([]);
  const [events, setEvents] = useState([]);
  const [classes, setClasses] = useState([]);      // classes of the event picked in the form
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [form, setForm] = useState(null);           // { id?, ...fields }
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filterEvent, setFilterEvent] = useState("all");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    const [{ data: sp, error }, { data: ev }] = await Promise.all([
      supabase.from("sponsors").select("*").order("sort_order").order("created_at"),
      supabase.from("events").select("id, name, starts_on, status, event_type").order("starts_on", { ascending: false }),
    ]);
    if (error) { setTableMissing(true); setLoading(false); return; }
    setSponsors(sp ?? []);
    setEvents(ev ?? []);
    setLoading(false);
  }, [session]);
  useEffect(() => { load(); }, [load]);

  // Classes for the event chosen in the form (so class sponsors can be ticked).
  useEffect(() => {
    if (!form?.event_id) { setClasses([]); return; }
    supabase.from("classes").select("id, num, name, day, hidden").eq("event_id", form.event_id).order("day").order("sort_order")
      .then(({ data }) => setClasses((data ?? []).filter((c) => !c.hidden)));
  }, [form?.event_id]);

  const eventName = (id) => events.find((e) => e.id === id)?.name ?? "Unknown event";
  const classLabel = (id) => { const c = classes.find((x) => x.id === id); return c ? `${c.num} · ${c.name}` : null; };

  const openNew = () => { setFormError(""); setForm(blankForm(filterEvent !== "all" && filterEvent !== "club" ? filterEvent : "")); };
  const openEdit = (s) => {
    setFormError("");
    setForm({ id: s.id, name: s.name ?? "", tier: s.tier ?? "bronze", logo_url: s.logo_url ?? "", website_url: s.website_url ?? "",
      blurb: s.blurb ?? "", sponsored_for: s.sponsored_for ?? "", event_id: s.event_id ?? "", class_ids: classIdsOf(s), active: s.active !== false, logoFile: null });
  };

  const save = async (e) => {
    e?.preventDefault?.();
    if (!form.name.trim()) { setFormError("Give the sponsor a name."); return; }
    setBusy(true); setFormError("");
    try {
      let logo_url = form.logo_url.trim() || null;
      if (form.logoFile) {
        const file = form.logoFile;
        const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
        const path = `sponsors/${form.id ?? "new"}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("patterns").upload(path, file, { upsert: true, contentType: file.type || undefined });
        if (upErr) {
          const msg = upErr.message?.toLowerCase() ?? "";
          throw new Error(msg.includes("not found") || msg.includes("bucket")
            ? 'Logo upload needs the "patterns" storage bucket in Supabase (Dashboard → Storage → New bucket, name: patterns, Public: on). You can paste a picture link instead.'
            : upErr.message);
        }
        logo_url = supabase.storage.from("patterns").getPublicUrl(path).data.publicUrl;
      }
      const row = {
        name: form.name.trim(), tier: form.tier, logo_url,
        website_url: normaliseUrl(form.website_url) || null,
        blurb: form.blurb.trim() || null, sponsored_for: form.sponsored_for.trim() || null,
        event_id: form.event_id || null,
        class_ids: form.event_id ? form.class_ids : [],
        active: form.active,
      };
      if (form.id) {
        const { error } = await supabase.from("sponsors").update(row).eq("id", form.id);
        if (error) throw error;
      } else {
        const sameTier = sponsors.filter((s) => s.tier === form.tier);
        row.sort_order = sameTier.length ? Math.max(...sameTier.map((s) => s.sort_order ?? 0)) + 1 : 0;
        const { error } = await supabase.from("sponsors").insert(row);
        if (error) throw error;
      }
      setForm(null);
      await load();
    } catch (err) { setFormError(err.message ?? String(err)); }
    setBusy(false);
  };

  const toggleActive = async (s) => {
    const { error } = await supabase.from("sponsors").update({ active: s.active === false }).eq("id", s.id);
    if (error) window.alert(error.message); else load();
  };

  const remove = async (s) => {
    if (!window.confirm(`Remove "${s.name}" from the sponsors list?\n\nTheir logo disappears from the website straight away. If you only want to hide them for now, use "Hide" instead. This can't be undone.`)) return;
    const { error } = await supabase.from("sponsors").delete().eq("id", s.id);
    if (error) window.alert(error.message); else load();
  };

  // ▲▼ within a tier: swap sort_order with the neighbour.
  const move = async (s, dir) => {
    const peers = sortSponsors(sponsors.filter((x) => x.tier === s.tier));
    const i = peers.findIndex((x) => x.id === s.id);
    const j = i + dir;
    if (j < 0 || j >= peers.length) return;
    const a = peers[i], b = peers[j];
    const ao = a.sort_order ?? i, bo = b.sort_order ?? j;
    const [na, nb] = ao === bo ? [j, i] : [bo, ao];
    const { error } = await supabase.from("sponsors").upsert([{ ...a, sort_order: na }, { ...b, sort_order: nb }]);
    if (error) window.alert(error.message); else load();
  };

  const shown = useMemo(() => {
    if (filterEvent === "all") return sponsors;
    if (filterEvent === "club") return sponsors.filter((s) => !s.event_id);
    return sponsors.filter((s) => s.event_id === filterEvent);
  }, [sponsors, filterEvent]);

  const previewList = useMemo(() => {
    if (filterEvent === "all" || filterEvent === "club") return sponsors.filter((s) => !s.event_id || filterEvent === "all");
    return sponsors.filter((s) => !s.event_id || s.event_id === filterEvent);
  }, [sponsors, filterEvent]);

  if (!session) {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <h1 className="display" style={{ fontWeight: 700, fontSize: 22 }}>Staff only</h1>
        <Link href="/coordinator" style={{ color: "var(--brass)" }}>← Sign in at coordinator dashboard</Link>
      </main>
    );
  }

  const btn = { border: "1px solid var(--line)", background: "#fff", color: "var(--leather)", borderRadius: 10, padding: "8px 14px", fontSize: 14, fontWeight: 700, fontFamily: "inherit" };
  const input = { width: "100%", fontSize: 15, padding: "9px 12px", border: "2px solid var(--line)", borderRadius: 10, background: "#fff", color: "var(--ink)", fontFamily: "inherit" };
  const upcoming = events.filter((e) => ACTIVE_STATUSES.includes(e.status));
  const formTier = form ? tierOf(form.tier) : null;

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>Coordinator</div>
            <h1 className="display" style={{ fontWeight: 700, fontSize: 22, margin: "2px 0", color: "#F2EADB" }}>Sponsors</h1>
          </div>
          <Link href="/coordinator" style={{ color: "var(--brass-soft)", fontSize: 13, alignSelf: "center" }}>← Dashboard</Link>
        </div>
      </header>

      <main className="wrap">
        <ReadOnlyBanner />

        {tableMissing && (
          <section className="card" style={{ padding: 16, borderColor: "#E0B15A", background: "#FFF7D6" }}>
            <strong>One database update needed.</strong>
            <p style={{ margin: "6px 0 0", fontSize: 14 }}>
              The sponsors table isn&apos;t set up yet. Open the <Link href="/coordinator/health" style={{ color: "var(--brass)" }}>Health page</Link>, copy the SQL for the missing updates (v69 — sponsors) and run it in Supabase, then come back here.
            </p>
          </section>
        )}

        {!tableMissing && (
          <>
            <section className="card" style={{ padding: "14px 16px" }}>
              <p style={{ margin: "0 0 10px", fontSize: 14, color: "var(--quiet)" }}>
                Add each sponsor once. The website sizes their logo by tier — <strong>Platinum</strong> is named as the event title sponsor at the top of the event page, <strong>Gold / Silver / Bronze</strong> logos appear on the sponsor board (biggest first), and <strong>Class / Ribbon</strong> and <strong>In-Kind</strong> sponsors are listed by name. Tick the classes a sponsor pays for and &ldquo;Proudly sponsored by …&rdquo; appears on those classes in the program, the schedule, live scoring and the results.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button className="btn" onClick={openNew} style={{ background: "var(--leather)" }}>+ Add sponsor</button>
                <select value={filterEvent} onChange={(e) => setFilterEvent(e.target.value)} style={{ ...input, width: "auto", fontSize: 14, padding: "8px 10px" }}>
                  <option value="all">All sponsors</option>
                  <option value="club">Club-wide only (every event)</option>
                  {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}{ev.starts_on ? ` · ${ev.starts_on}` : ""}</option>)}
                </select>
                <span style={{ fontSize: 13, color: "var(--quiet)" }}>{shown.length} sponsor{shown.length === 1 ? "" : "s"}</span>
              </div>
            </section>

            {loading ? <p style={{ color: "var(--quiet)" }}>Loading…</p> : shown.length === 0 ? (
              <p style={{ color: "var(--quiet)" }}>No sponsors yet. Tap &ldquo;+ Add sponsor&rdquo; to add the first one.</p>
            ) : groupByTier(shown).map(({ tier, sponsors: list }) => (
              <section key={tier.key} className="card">
                <div className="card-head">
                  <div className="display" style={{ fontWeight: 700, fontSize: 16 }}>
                    {tier.label} <span style={{ fontFamily: "Archivo, sans-serif", fontSize: 12, color: "var(--quiet)", fontWeight: 500 }}>· {tier.short}</span>
                  </div>
                  <span style={{ fontSize: 12, color: "var(--quiet)" }}>{list.length}</span>
                </div>
                {list.map((s, i) => (
                  <div key={s.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 16px", borderTop: i ? "1px solid var(--line)" : "none", opacity: s.active === false ? 0.55 : 1 }}>
                    <div style={{ width: 72, height: 48, flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
                      {s.logo_url ? <img src={s.logo_url} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                        : <span style={{ fontSize: 10, color: "var(--quiet)", textAlign: "center", padding: 4 }}>no logo</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        {s.name}
                        {s.active === false && <span className="badge" style={{ background: "#9A9A9A" }}>Hidden</span>}
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 2 }}>
                        {s.event_id ? eventName(s.event_id) : "Every event (club-wide)"}
                        {s.sponsored_for ? ` · ${s.sponsored_for}` : ""}
                        {classIdsOf(s).length > 0 ? ` · ${classIdsOf(s).length} class${classIdsOf(s).length === 1 ? "" : "es"}` : ""}
                        {s.website_url ? <> · <a href={normaliseUrl(s.website_url)} target="_blank" rel="noreferrer" style={{ color: "var(--brass)" }}>link ↗</a></> : null}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button className="btn-ghost" onClick={() => move(s, -1)} disabled={i === 0} title="Move up">▲</button>
                      <button className="btn-ghost" onClick={() => move(s, 1)} disabled={i === list.length - 1} title="Move down">▼</button>
                      <button className="btn-ghost" onClick={() => openEdit(s)}>Edit</button>
                      <button className="btn-ghost" onClick={() => toggleActive(s)}>{s.active === false ? "Show" : "Hide"}</button>
                      <button className="btn-ghost danger" onClick={() => remove(s)}>Remove</button>
                    </div>
                  </div>
                ))}
              </section>
            ))}

            {previewList.length > 0 && (
              <>
                <h2 className="display" style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--quiet)", margin: "26px 0 10px" }}>
                  How it looks on the website
                </h2>
                <SponsorBoard sponsors={previewList} />
                <p style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: -8 }}>
                  See it live on the <Link href="/" style={{ color: "var(--brass)" }}>home page</Link>
                  {filterEvent !== "all" && filterEvent !== "club" && <> or the <Link href={`/event/${filterEvent}`} style={{ color: "var(--brass)" }}>event page</Link></>}.
                </p>
              </>
            )}
          </>
        )}
      </main>

      {form && (
        <div className="modal-overlay" onClick={() => !busy && setForm(null)}>
          <form className="modal-sheet" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <h2 className="modal-title display">{form.id ? "Edit sponsor" : "Add sponsor"}</h2>

            <label className="modal-label">Business / sponsor name</label>
            <input style={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Hunter Valley Feeds" autoFocus />

            <label className="modal-label">Sponsorship tier</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {TIERS.map((t) => (
                <button type="button" key={t.key} onClick={() => setForm({ ...form, tier: t.key })}
                  style={{ ...btn, padding: "7px 12px", fontSize: 13, background: form.tier === t.key ? "var(--leather)" : "#fff", color: form.tier === t.key ? "#F2EADB" : "var(--leather)", borderColor: form.tier === t.key ? "var(--leather)" : "var(--line)" }}>
                  {t.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 6 }}>
              {formTier.key === "platinum" && "Named as the Event Title Sponsor — big logo at the top of the event page and on the sponsor board."}
              {formTier.key === "gold" && "Large logo on the sponsor board of the home page and event pages."}
              {formTier.key === "silver" && "Logo on the sponsor board, plus naming of a class or ribbon set — tick the classes below."}
              {formTier.key === "bronze" && "Small logo (or name) on the thank-you board."}
              {formTier.key === "class" && "Listed by name on the thank-you board, and “Proudly sponsored by …” on the classes you tick below."}
              {formTier.key === "in_kind" && "Listed by name under “With thanks for in-kind support”."}
            </div>

            <label className="modal-label">Logo</label>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ width: 110, height: 70, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
                {form.logoFile ? <img src={URL.createObjectURL(form.logoFile)} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                  : form.logo_url ? <img src={form.logo_url} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                  : <span style={{ fontSize: 11, color: "var(--quiet)" }}>no logo yet</span>}
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <input type="file" accept="image/*" onChange={(e) => setForm({ ...form, logoFile: e.target.files?.[0] ?? null })} style={{ fontSize: 13, maxWidth: "100%" }} />
                <div style={{ fontSize: 11.5, color: "var(--quiet)", marginTop: 4 }}>PNG or JPG works best — a wide logo on a white or clear background. Or paste a picture link:</div>
                <input style={{ ...input, fontSize: 13, padding: "6px 10px", marginTop: 4 }} value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} placeholder="https://…/logo.png (optional)" />
              </div>
            </div>
            {(form.logoFile || form.logo_url) && (
              <button type="button" className="btn-ghost" style={{ marginTop: 6 }} onClick={() => setForm({ ...form, logoFile: null, logo_url: "" })}>Remove logo</button>
            )}

            <label className="modal-label">Website or Facebook page (optional)</label>
            <input style={input} value={form.website_url} onChange={(e) => setForm({ ...form, website_url: e.target.value })} placeholder="www.example.com.au" />

            <label className="modal-label">What they sponsor (optional)</label>
            <input style={input} value={form.sponsored_for} onChange={(e) => setForm({ ...form, sponsored_for: e.target.value })} placeholder="e.g. Ribbons for the ranch riding classes · Major award · Feed vouchers" />

            <label className="modal-label">One line about the business (optional)</label>
            <input style={input} value={form.blurb} onChange={(e) => setForm({ ...form, blurb: e.target.value })} placeholder="e.g. Rural supplies, Maitland" />

            <label className="modal-label">Which event</label>
            <select style={input} value={form.event_id} onChange={(e) => setForm({ ...form, event_id: e.target.value, class_ids: [] })}>
              <option value="">Every event (club-wide) — home page and all event pages</option>
              <optgroup label="Coming up / on now">
                {upcoming.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}{ev.starts_on ? ` · ${ev.starts_on}` : ""}</option>)}
              </optgroup>
              <optgroup label="Older events">
                {events.filter((e) => !ACTIVE_STATUSES.includes(e.status)).map((ev) => <option key={ev.id} value={ev.id}>{ev.name}{ev.starts_on ? ` · ${ev.starts_on}` : ""}</option>)}
              </optgroup>
            </select>

            {form.event_id && (
              <>
                <label className="modal-label">Sponsored classes {formTier.key === "silver" || formTier.key === "class" ? "" : "(optional)"}</label>
                {classes.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--quiet)" }}>This event has no classes yet — add them on the dashboard, then come back and tick them here.</div>
                ) : (
                  <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 10, background: "#fff", padding: "4px 0" }}>
                    {classes.map((c) => {
                      const on = form.class_ids.includes(c.id);
                      return (
                        <label key={c.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 12px", fontSize: 14, cursor: "pointer", background: on ? "#FBF4E4" : "transparent" }}>
                          <input type="checkbox" checked={on} onChange={() => setForm({ ...form, class_ids: on ? form.class_ids.filter((x) => x !== c.id) : [...form.class_ids, c.id] })} />
                          <span style={{ fontWeight: 700, color: "var(--quiet)", minWidth: 28 }}>{c.num}</span>
                          <span>{c.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {form.class_ids.length > 0 && (
                  <div style={{ fontSize: 12.5, color: "var(--brass)", marginTop: 6, fontWeight: 700 }}>
                    🏅 Proudly sponsored by {form.name || "…"} — on {form.class_ids.map(classLabel).filter(Boolean).join("; ")}
                  </div>
                )}
              </>
            )}

            <label className="modal-label">Showing</label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Show this sponsor on the website
            </label>

            {formError && <p className="modal-error">{formError}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
              <button type="button" style={btn} onClick={() => setForm(null)} disabled={busy}>Cancel</button>
              <button type="submit" className="btn" disabled={busy}>{busy ? "Saving…" : form.id ? "Save changes" : "Add sponsor"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
