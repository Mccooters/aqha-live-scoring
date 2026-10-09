"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

// Public raffle page: prizes at the top, then every ticket number as a button.
// Buyers tap the numbers they want, enter their name + email, and pay by card
// through Square. Taken numbers come from /api/raffle/[id]/numbers (tickets
// hold names/emails, so the table itself isn't public) and refresh every few
// seconds so two people can't both think a number is free for long.

const fmtMoney = (cents) => `$${((cents ?? 0) / 100).toFixed(2)}`;
const ORDINAL = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
const prizeLabel = (i) => `${ORDINAL[i] ?? `${i + 1}th`} prize`;

const STATUS = {
  draft:  { label: "Coming soon", cls: "pre_open" },
  open:   { label: "Tickets on sale", cls: "open" },
  closed: { label: "Sales closed", cls: "closed" },
  drawn:  { label: "Drawn", cls: "completed" },
};

export default function RafflePage() {
  const { id } = useParams();
  const router = useRouter();
  const [raffle, setRaffle] = useState(undefined);
  const [taken, setTaken] = useState({});          // number -> {status, label}
  const [takenState, setTakenState] = useState("loading"); // loading | ok | error
  const [takenError, setTakenError] = useState("");
  const [takenAt, setTakenAt] = useState(null);     // when the board was last fetched OK
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef(null);

  const loadRaffle = useCallback(async () => {
    const { data } = await supabase.from("raffles").select("*").eq("id", id).maybeSingle();
    setRaffle(data ?? null);
  }, [id]);

  // Which numbers are sold / being paid for. The ticket rows hold names and
  // emails so they aren't public — this server route hands back just the
  // numbers. If it can't be reached we SAY so (and stop sales on this page)
  // rather than quietly showing every number as free.
  const loadTaken = useCallback(async () => {
    try {
      const res = await fetch(`/api/raffle/${id}/numbers?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      const map = {};
      for (const t of data.taken ?? []) map[t.number] = t;
      setTaken(map);
      setTakenState("ok");
      setTakenError("");
      setTakenAt(new Date());
      // Drop anything we'd picked that someone else has since taken.
      setSelected((sel) => sel.filter((n) => !map[n]));
    } catch (err) {
      setTakenState((cur) => (cur === "ok" ? "ok" : "error"));
      setTakenError(err?.message ?? "Could not load the ticket board.");
    }
  }, [id]);

  useEffect(() => { loadRaffle(); loadTaken(); }, [loadRaffle, loadTaken]);

  useEffect(() => {
    // Live: the server bumps raffles.tickets_changed_at on every sale /
    // hold / release (schema-v57), so this fires the moment anything changes.
    const refresh = () => { loadRaffle(); loadTaken(); };
    const channel = supabase
      .channel(`raffle-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "raffles", filter: `id=eq.${id}` }, refresh)
      .subscribe();
    // Belt and braces: poll while the tab is in view, and refresh the instant
    // it comes back — a phone tab left in the background keeps whatever it
    // last saw, and its timers are frozen until it's looked at again.
    const timer = setInterval(() => { if (typeof document === "undefined" || !document.hidden) loadTaken(); }, 5000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    const onShow = () => refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onShow);
    window.addEventListener("pageshow", onShow);
    return () => {
      supabase.removeChannel(channel); clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onShow);
      window.removeEventListener("pageshow", onShow);
    };
  }, [id, loadRaffle, loadTaken]);

  const toggle = (n) => {
    setError("");
    setSelected((sel) => (sel.includes(n) ? sel.filter((x) => x !== n) : [...sel, n].sort((a, b) => a - b)));
  };

  const buy = async (e) => {
    e.preventDefault();
    if (!selected.length) { setError("Tap the numbers you'd like first."); return; }
    if (takenState !== "ok") { setError("The ticket board hasn't loaded yet — please wait a moment and try again."); await loadTaken(); return; }
    setSubmitting(true); setError("");
    try {
      const res = await fetch(`/api/raffle/${id}/order`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numbers: selected, name, email, phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong — please try again.");
        if (res.status === 409) await loadTaken();
        setSubmitting(false);
        return;
      }
      if (data.checkout_url) { window.location.href = data.checkout_url; return; }
      router.push(`/raffle/${id}/success?order=${data.order_id}`);
    } catch (err) {
      setError(err.message ?? "Something went wrong — please try again.");
      setSubmitting(false);
    }
  };

  if (raffle === undefined) return <main className="wrap"><p style={{ color: "var(--quiet)" }}>Loading raffle…</p></main>;
  if (raffle === null) {
    return (
      <main className="wrap">
        <p style={{ color: "var(--quiet)" }}>Raffle not found.</p>
        <Link href="/raffle" style={{ color: "var(--brass)" }}>← All raffles</Link>
      </main>
    );
  }

  const prizes = Array.isArray(raffle.prizes) ? raffle.prizes : [];
  const count = raffle.ticket_count ?? 100;
  const soldCount = Object.values(taken).filter((t) => t.status === "sold").length;
  const heldCount = Object.values(taken).filter((t) => t.status === "reserved").length;
  const remaining = Math.max(0, count - soldCount - heldCount);
  const isOpen = raffle.status === "open";
  const isDrawn = raffle.status === "drawn";
  const status = STATUS[raffle.status] ?? STATUS.draft;
  const total = selected.length * (raffle.ticket_price_cents ?? 0);
  const results = Array.isArray(raffle.draw_results) ? raffle.draw_results : [];
  const winnersByNumber = Object.fromEntries(results.map((r) => [r.number, r]));

  const cellStyle = (n) => {
    const t = taken[n];
    const win = winnersByNumber[n];
    const base = {
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: 56, borderRadius: 10, border: "2px solid var(--line)", background: "#fff",
      fontFamily: "inherit", fontWeight: 800, fontSize: 18, color: "var(--leather)", padding: "4px 2px",
      cursor: isOpen && !t ? "pointer" : "default", lineHeight: 1.1,
    };
    if (win) return { ...base, borderColor: "var(--brass)", background: "#FFF6DA", color: "var(--leather)" };
    if (t?.status === "sold") return { ...base, background: "#EFEAE0", borderColor: "#EFEAE0", color: "#8B8073" };
    if (t?.status === "reserved") return { ...base, background: "#FBF3E6", borderColor: "#E8D9B8", color: "#9A6A1A" };
    if (selected.includes(n)) return { ...base, background: "var(--clay)", borderColor: "var(--clay)", color: "#FFF6EC" };
    return base;
  };

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>
              HCQHA Fundraising raffle
            </div>
            <h1 className="display" style={{ fontWeight: 700, fontSize: "clamp(22px,4vw,30px)", margin: "2px 0 4px", color: "#F2EADB" }}>
              {raffle.name}
            </h1>
            <div style={{ fontSize: 13, color: "var(--brass-soft)" }}>
              {fmtMoney(raffle.ticket_price_cents)} a ticket · {count} tickets
              {raffle.draw_date ? ` · Drawn ${raffle.draw_date}` : ""}
            </div>
          </div>
          <span className={`badge ${status.cls}`} style={{ alignSelf: "center" }}>{status.label}</span>
        </div>
      </header>

      <main className="wrap">
        {isDrawn && (
          <section className="card" style={{ borderColor: "var(--brass)" }}>
            <div className="card-head"><strong className="display" style={{ fontSize: 17 }}>🏆 Winners</strong></div>
            <div style={{ padding: "6px 16px 14px" }}>
              {results.length === 0 && <p style={{ color: "var(--quiet)" }}>No winners recorded.</p>}
              {results.map((r) => (
                <div key={r.prize_index} style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--brass)", minWidth: 74 }}>{prizeLabel(r.prize_index)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{r.prize}</div>
                    <div style={{ fontSize: 13, color: "var(--quiet)" }}>Ticket <strong style={{ color: "var(--leather)" }}>#{r.number}</strong>{r.buyer_name ? ` · ${r.buyer_name}` : ""}</div>
                  </div>
                </div>
              ))}
              <details style={{ marginTop: 12 }}>
                <summary style={{ fontSize: 13, color: "var(--quiet)", cursor: "pointer", fontWeight: 600 }}>How the draw was done (and how to check it)</summary>
                <div style={{ fontSize: 13, color: "var(--quiet)", lineHeight: 1.5, marginTop: 8 }}>
                  <p style={{ margin: "0 0 8px" }}>
                    The winners weren't picked by a person. Before tickets went on sale the website created a secret random code and published its
                    fingerprint (a SHA-256 hash) on this page, so it couldn't be changed later. At the draw it added a second random code made at
                    that moment, combined the two with every <em>sold</em> ticket number in order, and the maths picked each prize in turn —
                    a ticket can win only once. Both codes are shown below; anyone can recompute the result from them.
                  </p>
                  <div style={{ fontFamily: "monospace", fontSize: 11.5, wordBreak: "break-all" }}>
                    <div><strong>Fingerprint published before the draw:</strong> {raffle.seed_hash}</div>
                    <div><strong>Secret code revealed after the draw:</strong> {raffle.seed_revealed}</div>
                    <div><strong>Draw-time code:</strong> {raffle.draw_salt}</div>
                    <div><strong>Drawn at:</strong> {raffle.drawn_at ? new Date(raffle.drawn_at).toLocaleString("en-AU") : "—"}</div>
                  </div>
                  <p style={{ margin: "8px 0 0" }}>
                    To check: confirm SHA-256(secret code) equals the fingerprint. Then for prize k (counting from 0), take
                    HMAC-SHA256 with the secret code as the key and the text "draw-time code:k" as the message, read it as a whole number,
                    and divide by how many sold tickets remain — the remainder is the position of the winning ticket in the sorted list of
                    sold numbers. Remove that ticket and repeat for the next prize.
                  </p>
                </div>
              </details>
            </div>
          </section>
        )}

        <section className="card">
          <div className="card-head">
            <strong className="display" style={{ fontSize: 17 }}>🎁 Prizes</strong>
            {raffle.draw_date && <span style={{ fontSize: 12, color: "var(--quiet)" }}>Drawn {raffle.draw_date}</span>}
          </div>
          <div style={{ padding: "4px 16px 12px" }}>
            {prizes.length === 0 && <p style={{ color: "var(--quiet)", margin: "8px 0" }}>Prizes to be announced.</p>}
            {prizes.map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "9px 0", borderBottom: i < prizes.length - 1 ? "1px solid var(--line)" : "none" }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--brass)", minWidth: 74 }}>{prizeLabel(i)}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{p.title}</div>
                  {p.detail && <div style={{ fontSize: 13, color: "var(--quiet)" }}>{p.detail}</div>}
                </div>
              </div>
            ))}
            {raffle.description && (
              <p style={{ fontSize: 14, color: "var(--quiet)", whiteSpace: "pre-wrap", margin: "12px 0 4px" }}>{raffle.description}</p>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <strong className="display" style={{ fontSize: 17 }}>🎟 Pick your numbers</strong>
            <span style={{ fontSize: 12, color: "var(--quiet)" }}>
              {takenState === "ok" ? (isDrawn ? `${soldCount} sold` : `${soldCount} sold · ${remaining} of ${count} left`) : "…"}
              {takenAt && <span title="When this board was last refreshed"> · updated {takenAt.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>}
            </span>
          </div>
          <div style={{ padding: "12px 16px 16px" }}>
            {!isOpen && !isDrawn && (
              <p style={{ color: "var(--quiet)", margin: "0 0 10px", fontSize: 14 }}>
                {raffle.status === "closed" ? "Ticket sales have closed — the draw is coming up." : "Tickets aren't on sale yet. Check back soon."}
              </p>
            )}
            {isOpen && (
              <p style={{ color: "var(--quiet)", margin: "0 0 10px", fontSize: 14 }}>
                Tap the numbers you want (up to 20), then pay by card below. Numbers are held for 15 minutes while you pay.
              </p>
            )}
            {takenState === "loading" && (
              <p style={{ color: "var(--quiet)", margin: "0 0 10px", fontSize: 13, fontStyle: "italic" }}>Checking which numbers are still free…</p>
            )}
            {takenState === "ok" && takenError && (
              <p style={{ color: "#9A6A1A", margin: "0 0 10px", fontSize: 12.5 }}>
                ⚠ Couldn't refresh the board just now — it may be slightly out of date. Retrying…
              </p>
            )}
            {takenState === "error" && (
              <div style={{ background: "#FBE9E4", border: "1px solid var(--clay)", borderRadius: 10, padding: "10px 12px", margin: "0 0 10px", fontSize: 13 }}>
                <strong style={{ color: "#B03030" }}>Couldn't load which numbers are taken</strong>
                {takenError ? <span style={{ color: "var(--quiet)" }}> — {takenError}</span> : null}
                <div style={{ marginTop: 6 }}>
                  <button type="button" className="btn-ghost" onClick={loadTaken}>↻ Try again</button>
                  <span style={{ color: "var(--quiet)", marginLeft: 8 }}>Tickets can't be bought from this page until it loads.</span>
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: "var(--quiet)", marginBottom: 10 }}>
              <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, border: "2px solid var(--line)", background: "#fff", verticalAlign: "-2px", marginRight: 4 }} />Available</span>
              <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "var(--clay)", verticalAlign: "-2px", marginRight: 4 }} />Yours</span>
              <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "#EFEAE0", verticalAlign: "-2px", marginRight: 4 }} />Sold</span>
              <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "#FBF3E6", border: "1px solid #E8D9B8", verticalAlign: "-2px", marginRight: 4 }} />Being paid for</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(62px, 1fr))", gap: 6 }}>
              {Array.from({ length: count }, (_, i) => i + 1).map((n) => {
                const t = taken[n];
                const win = winnersByNumber[n];
                return (
                  <button key={n} type="button" style={cellStyle(n)} disabled={!isOpen || !!t || takenState !== "ok"}
                    onClick={() => toggle(n)} aria-pressed={selected.includes(n)}
                    title={t?.status === "sold" ? `Sold${t.label ? ` to ${t.label}` : ""}` : t?.status === "reserved" ? "Being paid for right now" : undefined}>
                    <span>{n}</span>
                    {win && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--brass)" }}>{ORDINAL[win.prize_index] ?? "Win"}</span>}
                    {!win && t?.status === "sold" && <span style={{ fontSize: 9.5, fontWeight: 600, color: "#8B8073", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label || "sold"}</span>}
                    {!win && t?.status === "reserved" && <span style={{ fontSize: 9.5, fontWeight: 600 }}>held</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {isOpen && (
          <section className="card" ref={formRef} id="pay">
            <div className="card-head">
              <strong className="display" style={{ fontSize: 17 }}>Your tickets</strong>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{selected.length ? `${selected.length} × ${fmtMoney(raffle.ticket_price_cents)} = ${fmtMoney(total)}` : "Nothing picked yet"}</span>
            </div>
            <form onSubmit={buy} style={{ padding: "12px 16px 16px", display: "grid", gap: 10 }}>
              <div style={{ fontSize: 14, minHeight: 20 }}>
                {selected.length ? <>Numbers: <strong>{selected.join(", ")}</strong></> : <span style={{ color: "var(--quiet)" }}>Tap numbers above to add them here.</span>}
              </div>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>
                Your name
                <input className="field" style={{ fontSize: 16 }} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>
                Email <span style={{ fontWeight: 400, color: "var(--quiet)" }}>— your ticket numbers are emailed here</span>
                <input className="field" style={{ fontSize: 16 }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>
                Phone <span style={{ fontWeight: 400, color: "var(--quiet)" }}>(optional — so we can reach you if you win)</span>
                <input className="field" style={{ fontSize: 16 }} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
              </label>
              {error && <div style={{ color: "#B03030", fontSize: 14, fontWeight: 600 }}>{error}</div>}
              <button className="btn" type="submit" disabled={submitting || !selected.length || takenState !== "ok"}>
                {submitting ? "Taking you to payment…" : total > 0 ? `Pay ${fmtMoney(total)} by card` : "Claim tickets"}
              </button>
              <div style={{ fontSize: 12, color: "var(--quiet)" }}>
                Card payments are handled securely by Square. You'll come back here once it's done.
              </div>
            </form>
          </section>
        )}

        <p style={{ marginTop: 6 }}>
          <Link href="/raffle" style={{ color: "var(--brass)", fontSize: 13 }}>← All raffles</Link>
        </p>
      </main>

      {isOpen && selected.length > 0 && (
        <div style={{ position: "sticky", bottom: 64, zIndex: 5, padding: "0 16px", pointerEvents: "none" }}>
          <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", justifyContent: "flex-end" }}>
            <button type="button" className="btn" style={{ pointerEvents: "auto", boxShadow: "0 6px 18px rgba(0,0,0,.25)" }}
              onClick={() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              {selected.length} ticket{selected.length === 1 ? "" : "s"} · {fmtMoney(total)} → Pay
            </button>
          </div>
        </div>
      )}
    </>
  );
}
