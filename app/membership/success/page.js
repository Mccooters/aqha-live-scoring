"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { seasonLabel } from "../../../lib/membershipSeason";

function SuccessContent() {
  const searchParams = useSearchParams();
  const memberId = searchParams.get("m");

  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    if (!memberId) { setLoading(false); return; }
    let cancelled = false;

    async function check() {
      // Membership applications hold personal details so they're not publicly
      // readable — this server route looks up just this one, keyed by the
      // unguessable ID from the redirect URL.
      let stillPending = false;
      try {
        const res = await fetch(`/api/memberships/status?id=${encodeURIComponent(memberId)}`);
        const data = res.ok ? await res.json() : null;
        if (data && !cancelled) {
          setMember(data);
          stillPending = data.status === "pending";
        }
      } catch {
        // Network blip after returning from Square — don't get stuck loading.
      } finally {
        if (!cancelled) setLoading(false);
      }
      // Keep polling for up to ~5 minutes while the webhook confirms payment.
      if (!cancelled && stillPending && pollCount < 40) {
        setTimeout(() => { if (!cancelled) setPollCount((n) => n + 1); }, pollCount < 8 ? 2000 : 10000);
      }
    }

    check();
    return () => { cancelled = true; };
  }, [memberId, pollCount]);

  if (loading) {
    return (
      <main className="wrap" style={{ textAlign: "center", paddingTop: 40 }}>
        <p style={{ color: "var(--quiet)" }}>Confirming payment…</p>
      </main>
    );
  }

  if (!member) {
    return (
      <main className="wrap">
        <p style={{ color: "var(--quiet)" }}>Could not load membership details.</p>
        <Link href="/membership" style={{ color: "var(--brass)" }}>← Back to membership</Link>
      </main>
    );
  }

  const isPending = member.status === "pending";
  const isApproved = member.status === "approved";
  const hasPayment = (member.total_cents ?? 0) > 0;

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)", marginBottom: 4 }}>
            Club membership
          </div>
          <h1 className="display" style={{ fontWeight: 700, fontSize: 22, margin: 0, color: "#F2EADB" }}>
            {isPending ? "Confirming payment…" : isApproved ? "✓ Membership approved" : "✓ Application received"}
          </h1>
        </div>
      </header>

      <main className="wrap">
        <section className="card">
          <div style={{ padding: "4px 0 12px" }}>
            {isPending ? (
              <p style={{ fontSize: 14, color: "var(--quiet)", marginTop: 4 }}>
                Your payment is being confirmed — this page updates automatically, please don&apos;t close it.
                {pollCount >= 15 && (
                  <span> If you&apos;ve completed payment and this persists after a minute, please contact the club.</span>
                )}
              </p>
            ) : isApproved ? (
              <p style={{ fontSize: 15, fontWeight: 600, color: "var(--leather)", marginTop: 4 }}>
                Welcome to the club! Your membership for the {seasonLabel(member.season)} is active.
              </p>
            ) : (
              <>
                <p style={{ fontSize: 15, fontWeight: 600, color: "var(--leather)", marginTop: 4 }}>
                  Thanks, {member.member_name} — your application is in.
                </p>
                <p style={{ fontSize: 13.5, color: "var(--quiet)", marginTop: 0 }}>
                  {hasPayment ? "Your payment has been received and Square will email your receipt. " : ""}
                  Your <strong>{member.membership_type_name || "membership"}</strong> for the {seasonLabel(member.season)} now
                  goes to the committee for approval — we&apos;ll email <strong>{member.email}</strong> once it&apos;s confirmed.
                </p>
              </>
            )}

            <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/" className="btn"
                style={{ background: "var(--leather)", textDecoration: "none", display: "inline-block" }}>
                View events →
              </Link>
              <Link href="/account" style={{ display: "inline-flex", alignItems: "center", color: "var(--brass)", fontSize: 13, fontWeight: 700 }}>
                Manage your membership →
              </Link>
              <Link href="/membership" style={{ display: "inline-flex", alignItems: "center", color: "var(--brass)", fontSize: 13 }}>
                ← Membership page
              </Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

export default function MembershipSuccessPage() {
  return (
    <Suspense fallback={<main className="wrap"><p style={{ color: "var(--quiet)" }}>Loading…</p></main>}>
      <SuccessContent />
    </Suspense>
  );
}
