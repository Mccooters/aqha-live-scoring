"use client";
import { useEffect, useState, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../../../lib/supabaseClient";

function SuccessContent() {
  const { id: eventId } = useParams();
  const searchParams = useSearchParams();
  const regId = searchParams.get("reg");

  const [reg, setReg] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    if (!regId) { setLoading(false); return; }

    async function check() {
      const { data } = await supabase
        .from("registrations")
        .select("*, registration_entries(*)")
        .eq("id", regId)
        .single();
      if (data) {
        setReg(data);
        setEntries(data.registration_entries ?? []);
        setLoading(false);
        // Keep polling until paid (Square webhook may arrive a few seconds after redirect)
        if (data.status !== "paid" && pollCount < 15) {
          setTimeout(() => setPollCount((n) => n + 1), 2000);
        }
      } else {
        setLoading(false);
      }
    }

    check();
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
                  A receipt has been sent to <strong>{reg.contact_email}</strong>.
                  If you don&apos;t see it within a few minutes, check your spam folder.
                </p>
              </>
            ) : (
              <p style={{ fontSize: 14, color: "var(--quiet)", marginTop: 4 }}>
                Your payment is being confirmed — this page updates automatically, please don&apos;t close it.
                {pollCount >= 15 && (
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
                        Back #{String(e.back_number).padStart(3, "0")} · {e.horse_name}
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
