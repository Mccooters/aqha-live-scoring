"use client";
import { useEffect, useState, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";

// After Square checkout: poll the order until the webhook marks it paid, then
// show the ticket numbers. Order ids are long random uuids, so the link only
// works for the person who made the purchase.
const fmtMoney = (cents) => `$${((cents ?? 0) / 100).toFixed(2)}`;

function Content() {
  const { id } = useParams();
  const orderId = useSearchParams().get("order");
  const [order, setOrder] = useState(undefined);
  const [polls, setPolls] = useState(0);

  useEffect(() => {
    if (!orderId) { setOrder(null); return; }
    let cancelled = false;
    (async () => {
      let pending = false;
      try {
        const res = await fetch(`/api/raffle/${id}/status?order=${encodeURIComponent(orderId)}`, { cache: "no-store" });
        const data = res.ok ? await res.json() : null;
        if (!cancelled) {
          setOrder(data?.order ?? null);
          pending = data?.order?.status === "pending";
          // Names are never public, so the raffle page marks "your" numbers
          // from this browser's own memory of what it bought.
          if (data?.order?.status === "paid") {
            try {
              const key = `raffle-mine-${id}`;
              const prev = JSON.parse(window.localStorage.getItem(key) || "[]");
              const next = [...new Set([...(Array.isArray(prev) ? prev : []), ...(data.order.numbers ?? [])])];
              window.localStorage.setItem(key, JSON.stringify(next));
            } catch { /* private browsing etc. — the grid just won't mark them */ }
          }
        }
      } catch { if (!cancelled && order === undefined) setOrder(null); }
      if (!cancelled && pending && polls < 40) {
        setTimeout(() => { if (!cancelled) setPolls((n) => n + 1); }, polls < 8 ? 2000 : 10000);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orderId, polls]);

  if (order === undefined) {
    return <main className="wrap" style={{ textAlign: "center", paddingTop: 40 }}><p style={{ color: "var(--quiet)" }}>Confirming payment…</p></main>;
  }
  if (!order) {
    return (
      <main className="wrap">
        <p style={{ color: "var(--quiet)" }}>Could not find that ticket order.</p>
        <Link href={`/raffle/${id}`} style={{ color: "var(--brass)" }}>← Back to the raffle</Link>
      </main>
    );
  }

  const numbers = Array.isArray(order.numbers) ? order.numbers : [];
  const paid = order.status === "paid";
  const pending = order.status === "pending";

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)", marginBottom: 4 }}>Fundraising raffle</div>
          <h1 className="display" style={{ fontWeight: 700, fontSize: 22, margin: 0, color: "#F2EADB" }}>
            {paid ? "✓ You're in the draw!" : pending ? "Confirming payment…" : "Order not completed"}
          </h1>
        </div>
      </header>
      <main className="wrap">
        <section className="card">
          <div style={{ padding: "16px" }}>
            {paid && (
              <>
                <p style={{ margin: "0 0 10px" }}>Thanks {order.buyer_name} — your ticket{numbers.length === 1 ? "" : "s"}:</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {numbers.map((n) => (
                    <span key={n} className="display" style={{ fontWeight: 700, fontSize: 22, padding: "8px 14px", borderRadius: 10, background: "var(--clay)", color: "#FFF6EC" }}>#{n}</span>
                  ))}
                </div>
                <p style={{ fontSize: 14, color: "var(--quiet)", margin: 0 }}>
                  Paid {fmtMoney(order.total_cents)}. A confirmation with these numbers has been emailed to you, and they're marked as sold on the raffle page. Good luck!
                </p>
              </>
            )}
            {pending && (
              <>
                <p style={{ margin: "0 0 8px" }}>We're waiting for Square to confirm your payment. This usually takes a few seconds.</p>
                <p style={{ fontSize: 14, color: "var(--quiet)", margin: 0 }}>
                  Numbers {numbers.join(", ")} are held for you. If you didn't finish paying,{" "}
                  {order.square_checkout_url ? <a href={order.square_checkout_url} style={{ color: "var(--brass)" }}>finish payment here</a> : "go back and try again"}.
                </p>
                {polls >= 40 && <p style={{ fontSize: 14, color: "#B03030", marginTop: 10 }}>Still not confirmed — if your card was charged, contact the club and we'll sort it out.</p>}
              </>
            )}
            {!paid && !pending && (
              <p style={{ margin: 0, color: "var(--quiet)" }}>This order was cancelled or its 15-minute hold ran out before payment. Your numbers have been released — please pick again.</p>
            )}
          </div>
        </section>
        <Link href={`/raffle/${id}`} style={{ color: "var(--brass)" }}>← Back to the raffle</Link>
      </main>
    </>
  );
}

export default function RaffleSuccessPage() {
  return <Suspense fallback={<main className="wrap"><p style={{ color: "var(--quiet)" }}>Loading…</p></main>}><Content /></Suspense>;
}
