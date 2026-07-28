"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";

// Staff "System health" page: one glance before a show instead of
// cross-checking MIGRATIONS.md. Probes the database for every column/table a
// migration adds (a cheap select that errors when it's missing) and asks
// /api/health which server settings are configured (booleans only).

const MIGRATION_CHECKS = [
  { m: "v22", what: "Site settings (notices, switches)", probe: () => supabase.from("site_settings").select("key").limit(1) },
  { m: "v23", what: "Club memberships", probe: () => supabase.from("club_members").select("id").limit(1) },
  { m: "v24", what: "Breed high-points (Paint, Appaloosa…)", probe: () => supabase.from("high_points").select("breed").limit(1) },
  { m: "v25", what: "Member portal (people, accounts)", probe: () => supabase.from("club_member_people").select("id").limit(1) },
  { m: "v29", what: "Day memberships", probe: () => supabase.from("registrations").select("day_membership").limit(1) },
  { m: "v30", what: "Replacement numbers", probe: () => supabase.from("registrations").select("replacement_numbers").limit(1) },
  { m: "v32", what: "Registration cancel / auto-expiry", probe: () => supabase.from("registrations").select("cancelled_at").limit(1) },
  { m: "v34", what: "Ground & admin fees", probe: () => supabase.from("events").select("ground_fee_cents").limit(1) },
  { m: "v35", what: "Association registration numbers on entries", probe: () => supabase.from("registration_entries").select("rider_registrations").limit(1) },
  { m: "v36", what: "Refund tracking", probe: () => supabase.from("registrations").select("refunded_cents").limit(1) },
  { m: "v37", what: "Membership-basis badge on registrations", probe: () => supabase.from("registrations").select("membership_basis").limit(1) },
  { m: "v38", what: "Hide classes instead of deleting", probe: () => supabase.from("classes").select("hidden").limit(1) },
  { m: "v39", what: "New-number fees + show-entry flags", probe: () => supabase.from("club_member_horses").select("number_fee_cents").limit(1) },
  { m: "v40", what: "Family member emails", probe: () => supabase.from("club_member_people").select("email").limit(1) },
  { m: "v41", what: "Family member details (AQHA no., phone)", probe: () => supabase.from("club_member_people").select("aqha_member_number").limit(1) },
  { m: "v42", what: "Multi-club registrations on members", probe: () => supabase.from("club_members").select("association_registrations").limit(1) },
  { m: "v43", what: "Championship classes (Champ & Reserve)", probe: () => supabase.from("classes").select("champ_feeder_ids").limit(1) },
  { m: "v44", what: "Gate marshal access", probe: () => supabase.from("gate_codes").select("event_id").limit(1) },
  { m: "v45", what: "Judges' result sheet photos", probe: () => supabase.from("classes").select("result_sheets").limit(1) },
  { m: "v46", what: "Rider association numbers in the registry", probe: () => supabase.from("rider_registrations").select("rider_id").limit(1) },
];

const CONFIG_LABELS = {
  square_access_token: "Square access token (payments fallback)",
  square_location: "Square location",
  square_webhook_key: "Square webhook signature key (required for payments)",
  square_oauth_app: "Square OAuth app (Connect Square button)",
  square_environment: "Square environment (sandbox/production)",
  resend: "Resend (emails)",
  booking_email_from: "Booking email sender address",
  base_url: "Site base URL (links in emails/checkout)",
  push_vapid: "Push notifications key",
  service_role: "Supabase service role key (online entries)",
};

export default function HealthPage() {
  const [session, setSession] = useState(null);
  const [rows, setRows] = useState(null);
  const [config, setConfig] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
  }, []);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const results = [];
      for (const check of MIGRATION_CHECKS) {
        const { error } = await check.probe();
        const missing = error && /does not exist|schema cache/i.test(error.message ?? "");
        results.push({ ...check, ok: !missing, error: !missing && error ? error.message : null });
      }
      setRows(results);
      try {
        const res = await fetch("/api/health", { headers: { Authorization: `Bearer ${session.access_token}` } });
        const data = await res.json();
        if (data.config) setConfig(data.config);
      } catch { setConfig(null); }
    })();
  }, [session]);

  if (!session) {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <h1 className="display" style={{ fontWeight: 700, fontSize: 22 }}>Staff only</h1>
        <Link href="/coordinator" style={{ color: "var(--brass)" }}>← Sign in at coordinator dashboard</Link>
      </main>
    );
  }

  const missingCount = (rows ?? []).filter((r) => !r.ok).length;

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>Coordinator</div>
            <h1 className="display" style={{ fontWeight: 700, fontSize: 22, margin: "2px 0", color: "#F2EADB" }}>System Health</h1>
          </div>
          <Link href="/coordinator" style={{ color: "var(--brass-soft)", fontSize: 13, alignSelf: "center" }}>← Dashboard</Link>
        </div>
      </header>
      <main className="wrap">
        <p style={{ fontSize: 13.5, color: "var(--quiet)", marginTop: 0 }}>
          One glance before a show: is every database update applied, and is everything configured?
          Anything marked ✗ has run instructions in <code>supabase/MIGRATIONS.md</code>.
        </p>

        <section className="card">
          <div className="card-head">
            <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Database updates</div>
            {rows && (
              <span style={{ fontSize: 12.5, fontWeight: 800, color: missingCount ? "var(--clay)" : "#2D7A52" }}>
                {missingCount ? `${missingCount} missing` : "● All applied"}
              </span>
            )}
          </div>
          {!rows ? <p style={{ color: "var(--quiet)", padding: "0 0 12px" }}>Checking…</p> : (
            <div style={{ paddingBottom: 10 }}>
              {rows.map((r) => (
                <div key={r.m} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13.5 }}>
                  <span style={{ fontWeight: 800, color: r.ok ? "#2D7A52" : "var(--clay)", width: 18 }}>{r.ok ? "✓" : "✗"}</span>
                  <span style={{ fontWeight: 700, width: 40 }}>{r.m}</span>
                  <span style={{ flex: 1 }}>{r.what}</span>
                  {!r.ok && <span style={{ fontSize: 11.5, color: "var(--clay)", fontWeight: 700 }}>run schema-{r.m}-…sql</span>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Server configuration</div>
          </div>
          {!config ? <p style={{ color: "var(--quiet)", padding: "0 0 12px" }}>Checking…</p> : (
            <div style={{ paddingBottom: 10 }}>
              {Object.entries(CONFIG_LABELS).map(([key, label]) => (
                <div key={key} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13.5 }}>
                  <span style={{ fontWeight: 800, color: config[key] ? "#2D7A52" : "var(--clay)", width: 18 }}>{config[key] ? "✓" : "✗"}</span>
                  <span style={{ flex: 1 }}>{label}</span>
                  {!config[key] && <span style={{ fontSize: 11.5, color: "var(--quiet)" }}>not set in Vercel</span>}
                </div>
              ))}
              <p style={{ fontSize: 12, color: "var(--quiet)", margin: "8px 0 0" }}>
                The Square connection itself (and whether it can see your location) is checked live on the{" "}
                <Link href="/coordinator/registrations" style={{ color: "var(--brass)" }}>Registrations page</Link>.
              </p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
