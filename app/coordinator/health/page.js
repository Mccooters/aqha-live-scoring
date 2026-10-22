"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";

// Staff "System health" page: one glance before a show instead of
// cross-checking MIGRATIONS.md. Probes the database for every column/table a
// migration adds (a cheap select that errors when it's missing) and asks
// /api/health which server settings are configured (booleans only).

const MIGRATION_CHECKS = [
  { m: "v21", what: "Rider-facing Patterns PDF choice", probe: () => supabase.from("events").select("patterns_pdf_url").limit(1) },
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
  { m: "v47", what: "Clinic deposits + per-spot pricing", probe: () => supabase.from("classes").select("deposit_cents").limit(1) },
  { m: "v48", what: "Committee read-only accounts", probe: () => supabase.from("staff_viewers").select("user_id").limit(1) },
  { m: "v49", what: "Shared program presets", probe: () => supabase.from("program_presets").select("id").limit(1) },
  { m: "v50", what: "Clinic balance part payments", probe: () => supabase.from("registrations").select("balance_payments").limit(1) },
  { m: "v51", what: "Close bookings per clinic spot type", probe: () => supabase.from("classes").select("entries_closed").limit(1) },
  { m: "v52", what: "Square refund IDs + status on registrations", probe: () => supabase.from("registrations").select("refund_log").limit(1) },
  { m: "v53", what: "Break timer on the live page", probe: () => supabase.from("events").select("break_until").limit(1) },
  { m: "v54", what: "HCQHA membership numbers", probe: () => supabase.from("club_member_people").select("hcqha_number").limit(1) },
  { m: "v55", what: "Balance reminder emails", probe: () => supabase.from("registrations").select("balance_reminder_log").limit(1) },
  { m: "v56", what: "Fundraising raffles", probe: () => supabase.from("raffles").select("id").limit(1) },
  { m: "v57", what: "Raffle live updates (ticket board)", probe: () => supabase.from("raffles").select("tickets_changed_at").limit(1) },
  { m: "v58", what: "PayPal payment option", probe: () => supabase.from("registrations").select("payment_provider").limit(1) },
  { m: "v59", what: "No-membership spot types (fence sitting)", probe: () => supabase.from("classes").select("membership_exempt").limit(1) },
  { m: "v60", what: "Website fees ledger + monthly statement", probe: () => supabase.from("website_fees").select("id").limit(1) },
  { m: "v61", what: "Camping & yards bookable with entries", probe: () => supabase.from("event_extras").select("id").limit(1) },
  { m: "v62", what: "Camping & yards shared between events on one weekend", probe: () => supabase.from("event_extras").select("pool").limit(1) },
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
  cron_secret: "CRON_SECRET (automatic balance reminder emails)",
  paypal: "PayPal client ID + secret (PayPal payment option)",
  paypal_environment: "PayPal environment (live/sandbox)",
  paypal_webhook_id: "PayPal webhook ID (PayPal payments confirmed if the buyer closes the tab)",
};

export default function HealthPage() {
  const [session, setSession] = useState(null);
  const [rows, setRows] = useState(null);
  const [config, setConfig] = useState(null);
  const [wallets, setWallets] = useState(null);     // Square's answer to "which wallets will you show?"
  const [walletsBusy, setWalletsBusy] = useState(false);
  const [feeRates, setFeeRates] = useState(null);   // website fee rates in use (monthly statement)

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
        if (data.website_fee) setFeeRates(data.website_fee);
      } catch { setConfig(null); }
    })();
  }, [session]);

  // Creates a $1 test link the way the site does, reads back which wallets
  // Square attached to it, deletes it again. Nothing is charged.
  const checkWallets = async () => {
    setWalletsBusy(true); setWallets(null);
    try {
      const res = await fetch("/api/square/wallets-check", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } });
      const data = await res.json().catch(() => ({}));
      setWallets(res.ok ? data : { error: data.error ?? `Square check failed (${res.status})` });
    } catch (err) { setWallets({ error: err.message ?? "Could not reach the site." }); }
    setWalletsBusy(false);
  };

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
              <div style={{ marginTop: 10, fontSize: 13.5 }}>
                <strong>Website fee rate:</strong>{" "}
                {!feeRates ? "checking…" : !feeRates.configured ? (
                  <span style={{ color: "var(--clay)", fontWeight: 700 }}>
                    not set — no fee lines are being recorded. Add WEBSITE_FEE_BPS (e.g. 50 = 0.5%) and/or WEBSITE_FEE_FLAT_CENTS (e.g. 500 = $5) in Vercel.
                  </span>
                ) : (
                  <>
                    {feeRates.bps > 0 ? `${(feeRates.bps / 100).toFixed(2)}% of each online payment` : "no percentage"}
                    {feeRates.flat_cents > 0 ? ` + $${(feeRates.flat_cents / 100).toFixed(2)} once per person per event (from the admin fee)` : ""}
                    {(feeRates.bps_var === "SQUARE_APP_FEE_BPS" || feeRates.flat_var === "SQUARE_APP_FLAT_FEE_CENTS") && (
                      <span style={{ color: "var(--quiet)" }}>
                        {" "}— read from the SQUARE_APP_FEE_BPS / SQUARE_APP_FLAT_FEE_CENTS settings in Vercel. Fine to leave them named that way: the fee is no longer sent to Square, the names just carry the rate.
                      </span>
                    )}
                    {" · "}<Link href="/coordinator/fees" style={{ color: "var(--brass)" }}>Website fees statement</Link>
                  </>
                )}
              </div>
            </div>
          )}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--quiet)", marginBottom: 6 }}>Digital wallets on Square checkouts</div>
            <button className="btn-ghost" onClick={checkWallets} disabled={walletsBusy || !config} style={{ fontSize: 13 }}>
              {walletsBusy ? "Asking Square…" : "Ask Square which wallets it will show"}
            </button>
            <p style={{ fontSize: 12, color: "var(--quiet)", margin: "6px 0 0" }}>
              Makes a $1 test link the same way real checkouts are made, reads back what Square attached to it, then deletes it. Nothing is charged.
              Checkouts no longer carry a website fee (it&apos;s billed monthly from the Website fees page instead), so Square offers Apple Pay wherever the buyer&apos;s device supports it.
            </p>
            {wallets?.error && <p style={{ color: "var(--clay)", fontWeight: 700, fontSize: 13, margin: "8px 0 0" }}>{wallets.error}</p>}
            {wallets && !wallets.error && (() => {
              const apm = wallets.accepted_payment_methods;
              const word = (v) => (v === true ? "✓ on" : v === false ? "✗ off" : "— not mentioned");
              const appleOn = apm?.apple_pay === true;
              return (
                <div style={{ marginTop: 8, fontSize: 13, background: appleOn ? "#E6F2EA" : "#FBE9E4", border: `1px solid ${appleOn ? "#2D7A52" : "var(--clay)"}`, borderRadius: 8, padding: "8px 10px" }}>
                  <div><strong>Square's answer:</strong> Apple Pay {word(apm?.apple_pay)} · Google Pay {word(apm?.google_pay)} · Cash App Pay {word(apm?.cash_app_pay)} · Afterpay {word(apm?.afterpay_clearpay)}</div>
                  <div style={{ marginTop: 4 }}>
                    <strong>Fee taken out of this link:</strong>{" "}
                    {wallets.app_fee_cents > 0
                      ? `$${(wallets.app_fee_cents / 100).toFixed(2)} — unexpected: checkouts should carry no fee any more`
                      : "none ✓ (website fees are billed monthly instead)"}
                  </div>
                  <div style={{ marginTop: 6, color: "var(--quiet)" }}>
                    {appleOn
                      ? "Square is putting Apple Pay on this account's links. If a buyer still can't see it, it's their device: Apple Pay only appears in Safari on an iPhone, iPad or Mac that has a card in Apple Wallet, with Settings → Safari → \"Check for Apple Pay\" switched on. Browsers inside apps (Facebook, Instagram, Messenger) never show it."
                      : "The site asked for Apple Pay but Square did not switch it on. Check the account setting first: Square Dashboard → Payments & orders → Payment links → Settings → General → Payments → Apple Pay. If that's already on, this is a known Square-side problem with links made by software — contact Square support and quote this result."}
                  </div>
                  {apm?.afterpay_clearpay !== true && (
                    <div style={{ marginTop: 6, color: "var(--quiet)" }}>
                      The site asked for Afterpay but Square did not switch it on for this link. Check Square Dashboard → Account &amp; Settings → Business information → Afterpay, and that Afterpay is enabled for online payments. If it is on, Square may still hide it for an amount outside Afterpay's limits.
                    </div>
                  )}
                  {!wallets.deleted && <div style={{ marginTop: 6, color: "var(--quiet)" }}>The $1 test link couldn't be deleted automatically — it's harmless, but you can remove it from Square's Payment links list.</div>}
                </div>
              );
            })()}
          </div>
        </section>
      </main>
    </>
  );
}
