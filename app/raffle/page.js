"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

// Public list of raffles — the one to share on Facebook is usually the
// individual raffle page, but this lists everything that's on or drawn.
const fmtMoney = (cents) => `$${((cents ?? 0) / 100).toFixed(2)}`;
const STATUS = {
  draft:  { label: "Coming soon", cls: "pre_open" },
  open:   { label: "Tickets on sale", cls: "open" },
  closed: { label: "Sales closed", cls: "closed" },
  drawn:  { label: "Drawn", cls: "completed" },
};

export default function RafflesPage() {
  const [raffles, setRaffles] = useState(null);
  useEffect(() => {
    supabase.from("raffles").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setRaffles((data ?? []).filter((r) => r.status !== "draft")));
  }, []);

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>HCQHA Fundraising</div>
          <h1 className="display" style={{ fontWeight: 700, fontSize: "clamp(22px,4vw,30px)", margin: "2px 0 4px", color: "#F2EADB" }}>Raffles</h1>
        </div>
      </header>
      <main className="wrap">
        {raffles === null && <p style={{ color: "var(--quiet)" }}>Loading…</p>}
        {raffles?.length === 0 && <p style={{ color: "var(--quiet)" }}>No raffles running at the moment.</p>}
        {raffles?.map((r) => {
          const s = STATUS[r.status] ?? STATUS.draft;
          const prizes = Array.isArray(r.prizes) ? r.prizes : [];
          return (
            <section key={r.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 16px" }}>
                <div>
                  <div className="display" style={{ fontWeight: 700, fontSize: 18 }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: "var(--quiet)", marginTop: 2 }}>
                    {fmtMoney(r.ticket_price_cents)} a ticket · {r.ticket_count} tickets{r.draw_date ? ` · Drawn ${r.draw_date}` : ""}
                    {prizes[0]?.title ? ` · 1st prize: ${prizes[0].title}` : ""}
                  </div>
                </div>
                <span className={`badge ${s.cls}`}>{s.label}</span>
              </div>
              <div style={{ borderTop: "1px solid var(--line)", padding: "10px 16px" }}>
                <Link href={`/raffle/${r.id}`} style={{ color: "var(--brass)", fontWeight: 700 }}>
                  {r.status === "open" ? "Buy tickets →" : r.status === "drawn" ? "See the winners →" : "View →"}
                </Link>
              </div>
            </section>
          );
        })}
        <p style={{ marginTop: 6 }}><Link href="/" style={{ color: "var(--brass)", fontSize: 13 }}>← Events</Link></p>
      </main>
    </>
  );
}
