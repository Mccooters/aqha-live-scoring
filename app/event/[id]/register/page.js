"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../../lib/supabaseClient";

const fmtMoney = (cents) => `$${(cents / 100).toFixed(2)}`;

function blankEntry() {
  return { _id: Math.random().toString(36).slice(2), class_id: "", back_number: "", horse_name: "", exhibitor: "" };
}

export default function RegisterPage() {
  const { id: eventId } = useParams();
  const router = useRouter();

  const [event, setEvent] = useState(null);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

  const [entries, setEntries] = useState([blankEntry()]);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const [{ data: ev }, { data: cls }] = await Promise.all([
        supabase.from("events").select("*").eq("id", eventId).single(),
        supabase
          .from("classes")
          .select("id, num, name")
          .eq("event_id", eventId)
          .eq("status", "upcoming")
          .order("sort_order"),
      ]);
      setEvent(ev);
      setClasses(cls ?? []);
      setLoading(false);
    }
    load();
  }, [eventId]);

  const feePerClass = event?.entry_fee_cents ?? 0;
  const filledEntries = entries.filter((e) => e.class_id);
  const totalCents = filledEntries.length * feePerClass;

  const updateEntry = (id, field, value) =>
    setEntries((prev) => prev.map((e) => (e._id === id ? { ...e, [field]: value } : e)));

  const lookupHorse = async (entryId, backNum) => {
    if (!backNum) return;
    const { data } = await supabase
      .from("horses")
      .select("name, owner")
      .eq("back_number", parseInt(backNum, 10))
      .maybeSingle();
    if (data) {
      setEntries((prev) =>
        prev.map((e) =>
          e._id === entryId
            ? {
                ...e,
                horse_name: e.horse_name || data.name,
                exhibitor: e.exhibitor || (data.owner ?? ""),
              }
            : e
        )
      );
    }
  };

  const removeEntry = (id) =>
    setEntries((prev) => (prev.length > 1 ? prev.filter((e) => e._id !== id) : prev));

  const submit = async () => {
    setError("");
    if (!contactName.trim()) { setError("Please enter your full name."); return; }
    if (!contactEmail.trim() || !contactEmail.includes("@")) { setError("Please enter a valid email address."); return; }
    const valid = entries.filter(
      (e) => e.class_id && e.back_number && e.horse_name.trim() && e.exhibitor.trim()
    );
    if (!valid.length) {
      setError("Please complete at least one entry — class, back number, horse name, and exhibitor are all required.");
      return;
    }
    const incomplete = entries.filter((e) => e.class_id && (!e.back_number || !e.horse_name.trim() || !e.exhibitor.trim()));
    if (incomplete.length) {
      setError("Some entries are missing details. Please fill in back number, horse name, and exhibitor for each class selected.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/registrations/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: eventId,
          contact_name: contactName.trim(),
          contact_email: contactEmail.trim(),
          entries: valid.map((e) => ({
            class_id: e.class_id,
            back_number: parseInt(e.back_number, 10),
            horse_name: e.horse_name.trim(),
            exhibitor: e.exhibitor.trim(),
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error ?? "Something went wrong. Please try again."); return; }

      if (data.redirect) {
        router.push(data.redirect);
      } else if (data.checkout_url) {
        window.location.href = data.checkout_url;
      }
    } catch {
      setError("Could not connect. Please check your internet and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <main className="wrap"><p style={{ color: "var(--quiet)" }}>Loading…</p></main>;

  if (!event) return (
    <main className="wrap">
      <p style={{ color: "var(--quiet)" }}>Event not found.</p>
      <Link href="/" style={{ color: "var(--brass)" }}>← Back to events</Link>
    </main>
  );

  if (event.status === "completed") return (
    <main className="wrap" style={{ textAlign: "center", paddingTop: 40 }}>
      <div className="display" style={{ fontSize: 20, marginBottom: 12 }}>This event has concluded.</div>
      <Link href={`/event/${eventId}`} style={{ color: "var(--brass)" }}>← View results</Link>
    </main>
  );

  if (event.entries_open === false) return (
    <main className="wrap" style={{ maxWidth: 500, paddingTop: 40 }}>
      <header className="header" style={{ marginLeft: -16, marginRight: -16, marginTop: -40, marginBottom: 32, padding: "20px 24px" }}>
        <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)", marginBottom: 4 }}>Online entry</div>
        <h1 className="display" style={{ fontWeight: 700, fontSize: "clamp(18px,4vw,26px)", margin: "0 0 2px" }}>{event.name}</h1>
        <div style={{ fontSize: 13, color: "#CBBFA9" }}>{event.location}</div>
      </header>
      <section className="card" style={{ textAlign: "center", padding: "32px 24px" }}>
        <div className="display" style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Entries are now closed</div>
        <p style={{ color: "var(--quiet)", marginTop: 0 }}>
          Online entry for this event has closed. Please contact the show secretary if you have any questions.
        </p>
        <Link href={`/event/${eventId}`} style={{ color: "var(--brass)", fontSize: 14 }}>← View event</Link>
      </section>
    </main>
  );

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)", marginBottom: 4 }}>
            Online entry
          </div>
          <h1 className="display" style={{ fontWeight: 700, fontSize: "clamp(18px,4vw,26px)", margin: "0 0 2px" }}>
            {event.name}
          </h1>
          <div style={{ fontSize: 13, color: "#CBBFA9" }}>
            {event.location}
            {event.starts_on ? ` · ${event.starts_on}` : ""}
            {" · "}
            {feePerClass > 0 ? `${fmtMoney(feePerClass)} per class` : "Free entry"}
          </div>
        </div>
      </header>

      <main className="wrap">

        {/* ---- Contact info ---- */}
        <section className="card">
          <div className="card-head">
            <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Your details</div>
          </div>
          <div style={{ paddingBottom: 8 }}>
            <label className="modal-label">Full name *</label>
            <input className="field" style={{ width: "100%", fontSize: 16 }}
              value={contactName} onChange={(e) => setContactName(e.target.value)}
              placeholder="e.g. Sarah O'Brien" />
            <label className="modal-label">Email address *</label>
            <input className="field" type="email" style={{ width: "100%", fontSize: 16 }}
              value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
              placeholder="e.g. sarah@example.com" />
            <p style={{ fontSize: 12, color: "var(--quiet)", margin: "6px 0 0" }}>
              Your payment receipt will be sent to this address.
            </p>
          </div>
        </section>

        {/* ---- Class entries ---- */}
        {entries.map((entry, idx) => (
          <section key={entry._id} className="card">
            <div className="card-head">
              <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Entry {idx + 1}</div>
              {entries.length > 1 && (
                <button className="btn-ghost"
                  style={{ color: "var(--clay)", borderColor: "var(--clay)", padding: "4px 10px", fontSize: 12 }}
                  onClick={() => removeEntry(entry._id)}>
                  Remove
                </button>
              )}
            </div>
            <div style={{ paddingBottom: 8 }}>
              <label className="modal-label">Class *</label>
              <select className="field" style={{ width: "100%", fontSize: 16 }}
                value={entry.class_id}
                onChange={(e) => updateEntry(entry._id, "class_id", e.target.value)}>
                <option value="">— Select a class —</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>Class {c.num}: {c.name}</option>
                ))}
              </select>

              {classes.length === 0 && (
                <p style={{ fontSize: 12.5, color: "var(--clay)", marginTop: 4 }}>
                  No upcoming classes have been added to this event yet. Check back soon.
                </p>
              )}

              <label className="modal-label">Back number *</label>
              <input className="field" type="number" style={{ width: "100%", fontSize: 16 }}
                value={entry.back_number}
                onChange={(e) => updateEntry(entry._id, "back_number", e.target.value)}
                onBlur={(e) => lookupHorse(entry._id, e.target.value)}
                placeholder="e.g. 301" />

              <label className="modal-label">Horse name *</label>
              <input className="field" style={{ width: "100%", fontSize: 16 }}
                value={entry.horse_name}
                onChange={(e) => updateEntry(entry._id, "horse_name", e.target.value)}
                placeholder="e.g. Machine Made Lady" />

              <label className="modal-label">Exhibitor name *</label>
              <input className="field" style={{ width: "100%", fontSize: 16 }}
                value={entry.exhibitor}
                onChange={(e) => updateEntry(entry._id, "exhibitor", e.target.value)}
                placeholder="e.g. S. O'Brien" />
            </div>
          </section>
        ))}

        <button className="btn-ghost" style={{ width: "100%", marginBottom: 16, fontSize: 15 }}
          onClick={() => setEntries((p) => [...p, blankEntry()])}>
          + Add another class entry
        </button>

        {/* ---- Total + pay ---- */}
        <section className="card" style={{ background: "var(--sand)" }}>
          <div style={{ padding: "4px 0 8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {filledEntries.length} {filledEntries.length === 1 ? "class" : "classes"} × {fmtMoney(feePerClass)}
                </div>
                {feePerClass > 0 && (
                  <div style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 2 }}>
                    Paid securely via Square · receipt emailed to you
                  </div>
                )}
              </div>
              <div className="display" style={{ fontWeight: 700, fontSize: 28, color: "var(--leather)" }}>
                {fmtMoney(totalCents)}
              </div>
            </div>
            {error && (
              <p style={{ color: "var(--clay)", fontSize: 13.5, fontWeight: 600, marginBottom: 10, marginTop: 0 }}>
                {error}
              </p>
            )}
            <button className="btn" style={{ width: "100%", fontSize: 17, padding: 14, background: "var(--leather)" }}
              onClick={submit} disabled={submitting}>
              {submitting
                ? "Setting up payment…"
                : feePerClass > 0
                ? `Register & Pay ${fmtMoney(totalCents)}`
                : "Submit entries"}
            </button>
          </div>
        </section>

        <p style={{ textAlign: "center", marginTop: 10 }}>
          <Link href={`/event/${eventId}`} style={{ color: "var(--brass)", fontSize: 13 }}>← Back to event</Link>
        </p>
      </main>
    </>
  );
}
