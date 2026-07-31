"use client";
import { useEffect, useState, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";

// Poll for up to ~5 minutes (2s early, then 10s) — the Square webhook can lag
// under load, and stopping at 30s while still telling the user "this updates
// automatically" strands people whose payment actually went through.
const MAX_POLLS = 40;
const SLOW_MSG_AFTER = 15;

function SuccessContent() {
  const { id: eventId } = useParams();
  const searchParams = useSearchParams();
  const regId = searchParams.get("reg");

  const [reg, setReg] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pollCount, setPollCount] = useState(0);
  const [payingBalance, setPayingBalance] = useState(false);

  useEffect(() => {
    if (!regId) { setLoading(false); return; }
    let cancelled = false;

    async function check() {
      // Registrations hold names/emails so they're no longer publicly readable
      // from the browser — this server route looks up just this one, keyed by
      // the unguessable registration ID from the redirect URL.
      let paid = false;
      try {
        const res = await fetch(`/api/registrations/status?id=${encodeURIComponent(regId)}`);
        const data = res.ok ? await res.json() : null;
        if (data && !cancelled) {
          setReg(data);
          setEntries(data.registration_entries ?? []);
          paid = data.status === "paid";
        }
      } catch {
        // Network blip right after returning from Square — don't get stuck on
        // "Confirming…"; the next poll tick will try again.
      } finally {
        if (!cancelled) setLoading(false);
      }
      // Keep polling until paid or we hit the ceiling.
      if (!cancelled && !paid && pollCount < MAX_POLLS) {
        setTimeout(() => { if (!cancelled) setPollCount((n) => n + 1); }, pollCount < 8 ? 2000 : 10000);
      }
    }

    check();
    return () => { cancelled = true; };
  }, [regId, pollCount]);

  if (loading) {
    return (
      <main className="wrap" style={{ textAlign: "center", paddingTop: 40 }}>
        <p style={{ color: "var(--quiet)" }}>Confirming payment…</p>
      </main>
    );
  }

  if (!reg) {
    return (
      <main className="wrap">
        <p style={{ color: "var(--quiet)" }}>Could not load registration details.</p>
        <Link href="/" style={{ color: "var(--brass)" }}>← Back to events</Link>
      </main>
    );
  }

  const isPaid = reg.status === "paid";
  const hasPayment = (reg.total_cents ?? 0) > 0;
  const hasDayMembership = !!reg.day_membership;
  const hasReplacementNumbers = !!reg.replacement_numbers;
  const balance = reg.balance; // clinic deposit plan (schema-v47)

  const payBalance = async () => {
    setPayingBalance(true);
    try {
      const res = await fetch("/api/registrations/pay-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_id: regId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.checkout_url) {
        window.alert(data.error ?? "Could not open the balance payment — please try again.");
        return;
      }
      window.location.href = data.checkout_url;
    } finally {
      setPayingBalance(false);
    }
  };

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)", marginBottom: 4 }}>
            Online entry
          </div>
          <h1 className="display" style={{ fontWeight: 700, fontSize: 22, margin: 0, color: "#F2EADB" }}>
            {isPaid ? "✓ Registration confirmed" : "Confirming payment…"}
          </h1>
        </div>
      </header>

      <main className="wrap">
        <section className="card">
          <div style={{ padding: "4px 0 12px" }}>
            {isPaid ? (
              <>
                <p style={{ fontSize: 15, fontWeight: 600, color: "var(--leather)", marginTop: 4 }}>
                  Your entries are confirmed and have been added to the draw.
                </p>
                <p style={{ fontSize: 13.5, color: "var(--quiet)", marginTop: 0 }}>
                  {hasPayment ? "Square will email your payment receipt, and we will email your booking confirmation" : "We will email your booking confirmation"} to <strong>{reg.contact_email}</strong>.
                  If you don&apos;t see it within a few minutes, check your spam folder.
                </p>
                {hasDayMembership && (
                  <p style={{ fontSize: 13.5, color: "var(--leather)", fontWeight: 700, marginTop: 0 }}>
                    Includes a day membership for this event ({`$${((reg.day_membership_cents ?? 2000) / 100).toFixed(2)}`}).
                  </p>
                )}
                {hasReplacementNumbers && (
                  <p style={{ fontSize: 13.5, color: "var(--leather)", fontWeight: 700, marginTop: 0 }}>
                    Includes replacement numbers ({`$${((reg.replacement_numbers_cents ?? 500) / 100).toFixed(2)}`}).
                  </p>
                )}
                {balance && !balance.paid && balance.owing_cents > 0 && (
                  <div style={{ border: "1px solid #E0B15A", background: "#FFF7D6", borderRadius: 10, padding: "12px 14px", marginTop: 12 }}>
                    <div style={{ fontWeight: 800, color: "var(--leather)", fontSize: 14 }}>
                      Deposit received — ${(balance.owing_cents / 100).toFixed(2)} balance still to pay
                    </div>
                    <p style={{ fontSize: 13, color: "var(--quiet)", margin: "4px 0 10px" }}>
                      Your spot is held by the non-refundable deposit. The balance is due
                      {balance.due_label ? <> by <strong>{balance.due_label}</strong></> : " 2 weeks before the clinic"} —
                      you can pay it any time from this page or the link in your confirmation email.
                    </p>
                    <button className="btn" style={{ background: "var(--leather)" }} onClick={payBalance} disabled={payingBalance}>
                      {payingBalance ? "Opening payment…" : `Pay the ${`$${(balance.owing_cents / 100).toFixed(2)}`} balance now`}
                    </button>
                  </div>
                )}
                {balance && balance.paid && (
                  <p style={{ fontSize: 13.5, color: "var(--green)", fontWeight: 700, marginTop: 0 }}>
                    ✓ Deposit and balance both paid — nothing owing.
                  </p>
                )}
              </>
            ) : (
              <p style={{ fontSize: 14, color: "var(--quiet)", marginTop: 4 }}>
                Your payment is being confirmed — this page updates automatically, please don&apos;t close it.
                {pollCount >= SLOW_MSG_AFTER && (
                  <span> If you&apos;ve completed payment and this persists after a minute, please contact the show secretary.</span>
                )}
              </p>
            )}

            {entries.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
                  {reg.contact_name} — {entries.length} {entries.length === 1 ? "entry" : "entries"}
                </div>
                <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
                  {entries.map((e, i) => (
                    <div key={e.id} style={{
                      padding: "10px 14px",
                      borderBottom: i < entries.length - 1 ? "1px solid var(--line)" : "none",
                      fontSize: 14,
                    }}>
                      <div style={{ fontWeight: 600 }}>
                        {e.back_number != null ? `Back #${String(e.back_number).padStart(3, "0")} · ` : ""}{e.horse_name}
                      </div>
                      <div style={{ color: "var(--quiet)", fontSize: 13 }}>{e.exhibitor}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href={`/event/${eventId}`} className="btn"
                style={{ background: "var(--leather)", textDecoration: "none", display: "inline-block" }}>
                View live scoring →
              </Link>
              <Link href="/" style={{ display: "inline-flex", alignItems: "center", color: "var(--brass)", fontSize: 13 }}>
                ← All events
              </Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<main className="wrap"><p style={{ color: "var(--quiet)" }}>Loading…</p></main>}>
      <SuccessContent />
    </Suspense>
  );
}
