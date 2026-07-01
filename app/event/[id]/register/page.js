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

  const [spotsTaken, setSpotsTaken] = useState({}); // class_id → number of confirmed entries
  const [confirmedEntries, setConfirmedEntries] = useState([]);

  useEffect(() => {
    async function load() {
      const [{ data: ev }, { data: cls }] = await Promise.all([
        supabase.from("events").select("*").eq("id", eventId).single(),
        supabase
          .from("classes")
          .select("id, num, name, capacity")
          .eq("event_id", eventId)
          .eq("status", "upcoming")
          .order("sort_order"),
      ]);
      setEvent(ev);
      setClasses(cls ?? []);
      if (cls?.length) {
        const { data: taken } = await supabase
          .from("entries")
          .select("class_id, back_number, horse")
          .in("class_id", cls.map((c) => c.id))
          .eq("scratched", false);
        const counts = {};
        (taken ?? []).forEach((e) => { counts[e.class_id] = (counts[e.class_id] ?? 0) + 1; });
        setSpotsTaken(counts);
        setConfirmedEntries(taken ?? []);
      }
      setLoading(false);
    }
    load();
  }, [eventId]);

  const isClinic = event?.event_type === "clinic";
  const feePerClass = event?.entry_fee_cents ?? 0;
  const filledEntries = entries.filter((e) => e.class_id);
  const totalCents = filledEntries.length * feePerClass;

  const classIsFull = (cls) => cls.capacity != null && (spotsTaken[cls.id] ?? 0) >= cls.capacity;
  const spotsLabel = (cls) => {
    if (cls.capacity == null) return null;
    const remaining = cls.capacity - (spotsTaken[cls.id] ?? 0);
    if (remaining <= 0) return "Full";
    return `${remaining} spot${remaining === 1 ? "" : "s"} remaining`;
  };
  const availableClasses = classes.filter((c) => !classIsFull(c));
  const allFull = classes.length > 0 && availableClasses.length === 0;
  const normalizeName = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  const classLabel = (classId) => {
    const cls = classes.find((c) => c.id === classId);
    if (!cls) return "this class";
    return isClinic ? cls.name : `Class ${cls.num}: ${cls.name}`;
  };
  const duplicateMessage = (entry, candidates = confirmedEntries) => {
    if (isClinic || !entry.class_id) return "";
    const backNumber = entry.back_number ? parseInt(entry.back_number, 10) : null;
    const horseName = normalizeName(entry.horse_name);
    if (!backNumber && !horseName) return "";
    const match = candidates.find((existing) =>
      existing.class_id === entry.class_id &&
      (
        (backNumber != null && existing.back_number === backNumber) ||
        (horseName && normalizeName(existing.horse) === horseName)
      )
    );
    if (!match) return "";
    return `${entry.horse_name || `Back #${entry.back_number}`} is already entered in ${classLabel(entry.class_id)}.`;
  };
  const duplicateInFormMessage = (validEntries) => {
    if (isClinic) return "";
    const seenBackNumbers = new Map();
    const seenHorses = new Map();
    for (const entry of validEntries) {
      const horseName = normalizeName(entry.horse_name);
      const backKey = entry.back_number ? `${entry.class_id}:${entry.back_number}` : "";
      const horseKey = horseName ? `${entry.class_id}:${horseName}` : "";
      if ((backKey && seenBackNumbers.has(backKey)) || (horseKey && seenHorses.has(horseKey))) {
        return `${entry.horse_name} / back #${entry.back_number} is entered twice for ${classLabel(entry.class_id)}. Please remove the duplicate entry.`;
      }
      if (backKey) seenBackNumbers.set(backKey, true);
      if (horseKey) seenHorses.set(horseKey, true);
    }
    return "";
  };

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
    const valid = isClinic
      ? entries.filter((e) => e.class_id && e.exhibitor.trim())
      : entries.filter((e) => e.class_id && e.back_number && e.horse_name.trim() && e.exhibitor.trim());
    if (!valid.length) {
      setError(isClinic
        ? "Please select a spot type and enter your name."
        : "Please complete at least one entry — class, back number, horse name, and exhibitor are all required.");
      return;
    }
    const incomplete = isClinic
      ? entries.filter((e) => e.class_id && !e.exhibitor.trim())
      : entries.filter((e) => e.class_id && (!e.back_number || !e.horse_name.trim() || !e.exhibitor.trim()));
    if (incomplete.length) {
      setError(isClinic
        ? "Please enter your name for each spot selected."
        : "Some entries are missing details. Please fill in back number, horse name, and exhibitor for each class selected.");
      return;
    }
    const duplicateInForm = duplicateInFormMessage(valid);
    if (duplicateInForm) { setError(duplicateInForm); return; }
    const existingDuplicate = valid.map((entry) => duplicateMessage(entry)).find(Boolean);
    if (existingDuplicate) { setError(`${existingDuplicate} Please check your details or contact the show secretary.`); return; }

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
            back_number: isClinic ? null : parseInt(e.back_number, 10),
            horse_name: e.horse_name.trim() || "",
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

  const entriesOpen = event.status === "open" || event.status === "upcoming";

  if (event.status === "pre_open") return (
    <main className="wrap" style={{ maxWidth: 500, textAlign: "center", paddingTop: 40 }}>
      <div className="display" style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Entries not yet open</div>
      <p style={{ color: "var(--quiet)" }}>Online entry for this event hasn't opened yet. Check back soon.</p>
      <Link href={`/event/${eventId}`} style={{ color: "var(--brass)", fontSize: 14 }}>← View event</Link>
    </main>
  );

  if (entriesOpen && allFull) return (
    <main className="wrap" style={{ maxWidth: 500, textAlign: "center", paddingTop: 40 }}>
      <div className="display" style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Sold out</div>
      <p style={{ color: "var(--quiet)" }}>All spots for this {isClinic ? "clinic" : "event"} are now full. Please contact the organiser if you have any questions.</p>
      <Link href={`/event/${eventId}`} style={{ color: "var(--brass)", fontSize: 14 }}>← View event</Link>
    </main>
  );

  if (!entriesOpen) return (
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
            {feePerClass > 0 ? `${fmtMoney(feePerClass)} per ${isClinic ? "spot" : "class"}` : "Free entry"}
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
              {feePerClass > 0
                ? "Square will send your payment receipt to this address. We will also email your booking confirmation here."
                : "We will email your booking confirmation here."}
            </p>
          </div>
        </section>

        {/* ---- Spot / class entries ---- */}
        {entries.map((entry, idx) => {
          const selectedCls = entry.class_id ? classes.find((c) => c.id === entry.class_id) : null;
          const isFull = selectedCls ? classIsFull(selectedCls) : false;
          const duplicateWarning = duplicateMessage(entry);
          return (
            <section key={entry._id} className="card">
              <div className="card-head">
                <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>
                  {isClinic ? `Registration ${idx + 1}` : `Entry ${idx + 1}`}
                </div>
                {entries.length > 1 && (
                  <button className="btn-ghost"
                    style={{ color: "var(--clay)", borderColor: "var(--clay)", padding: "4px 10px", fontSize: 12 }}
                    onClick={() => removeEntry(entry._id)}>
                    Remove
                  </button>
                )}
              </div>
              <div style={{ paddingBottom: 8 }}>
                <label className="modal-label">{isClinic ? "Spot type *" : "Class *"}</label>
                <select className="field" style={{ width: "100%", fontSize: 16 }}
                  value={entry.class_id}
                  onChange={(e) => updateEntry(entry._id, "class_id", e.target.value)}>
                  <option value="">— Select{isClinic ? "" : " a class"} —</option>
                  {classes.map((c) => {
                    const label = spotsLabel(c);
                    const full = classIsFull(c);
                    return (
                      <option key={c.id} value={c.id} disabled={full}>
                        {isClinic ? c.name : `Class ${c.num}: ${c.name}`}
                        {label ? ` (${label})` : ""}
                      </option>
                    );
                  })}
                </select>

                {isFull && (
                  <p style={{ fontSize: 12.5, color: "var(--clay)", marginTop: 4, fontWeight: 600 }}>
                    This spot type is now full — please select another.
                  </p>
                )}

                {classes.length === 0 && (
                  <p style={{ fontSize: 12.5, color: "var(--clay)", marginTop: 4 }}>
                    No {isClinic ? "spot types have" : "upcoming classes have"} been added yet. Check back soon.
                  </p>
                )}

                {!isClinic && (
                  <>
                    <label className="modal-label">Back number *</label>
                    <input className="field" type="number" style={{ width: "100%", fontSize: 16 }}
                      value={entry.back_number}
                      onChange={(e) => updateEntry(entry._id, "back_number", e.target.value)}
                      onBlur={(e) => lookupHorse(entry._id, e.target.value)}
                      placeholder="e.g. 301" />
                  </>
                )}

                <label className="modal-label">{isClinic ? "Horse name (if participating)" : "Horse name *"}</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }}
                  value={entry.horse_name}
                  onChange={(e) => updateEntry(entry._id, "horse_name", e.target.value)}
                  placeholder={isClinic ? "e.g. Machine Made Lady (optional)" : "e.g. Machine Made Lady"} />

                {duplicateWarning && (
                  <p style={{ fontSize: 12.5, color: "var(--clay)", marginTop: 4, fontWeight: 600 }}>
                    {duplicateWarning} Please check your details before submitting.
                  </p>
                )}

                <label className="modal-label">{isClinic ? "Your name *" : "Exhibitor name *"}</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }}
                  value={entry.exhibitor}
                  onChange={(e) => updateEntry(entry._id, "exhibitor", e.target.value)}
                  placeholder="e.g. S. O'Brien" />
              </div>
            </section>
          );
        })}

        <button className="btn-ghost" style={{ width: "100%", marginBottom: 16, fontSize: 15 }}
          onClick={() => setEntries((p) => [...p, blankEntry()])}>
          + Add another {isClinic ? "spot" : "class entry"}
        </button>

        {/* ---- Total + pay ---- */}
        <section className="card" style={{ background: "var(--sand)" }}>
          <div style={{ padding: "4px 0 8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {filledEntries.length} {isClinic ? (filledEntries.length === 1 ? "spot" : "spots") : (filledEntries.length === 1 ? "class" : "classes")} × {fmtMoney(feePerClass)}
                </div>
                {feePerClass > 0 && (
                  <div style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 2 }}>
                    Paid securely via Square · receipt and booking confirmation emailed to you
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
                : isClinic ? "Register" : "Submit entries"}
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
