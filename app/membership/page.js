"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import { signupSeason, seasonLabel } from "../../lib/membershipSeason";
import { WAIVER_INTRO, WAIVER_BODY, WAIVER_DECLARATION } from "../../lib/membershipWaiver";

const INTEREST_OPTIONS = ["Shows", "Clinics", "To connect with locals"];
const ACCOUNT_ONLY_ID = "account-only";

const fmtMoney = (cents) => `$${((cents ?? 0) / 100).toFixed(2)}`;

function blankHorse() {
  return {
    _id: Math.random().toString(36).slice(2),
    horse_name: "",
    back_number: "",
    breed: "",
    registrations: "",
    notes: "",
  };
}

export default function MembershipPage() {
  const router = useRouter();

  const [types, setTypes] = useState([]);
  const [typesReady, setTypesReady] = useState(false);
  const [loading, setLoading] = useState(true);

  const [typeId, setTypeId] = useState("");
  const [memberName, setMemberName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [aqhaNumber, setAqhaNumber] = useState("");
  const [otherMemberships, setOtherMemberships] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [interests, setInterests] = useState([]);
  const [applicantNotes, setApplicantNotes] = useState("");
  const [horses, setHorses] = useState([]);
  const [people, setPeople] = useState([]);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [accountStep, setAccountStep] = useState("email"); // email | code
  const [accountCode, setAccountCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef(null);

  const season = signupSeason();

  useEffect(() => () => clearInterval(timer.current), []);

  useEffect(() => {
    supabase
      .from("membership_types")
      .select("*")
      .eq("active", true)
      .order("sort_order")
      .order("name")
      .then(({ data, error: err }) => {
        if (!err) {
          setTypes(data ?? []);
          setTypesReady(true);
          if (data?.length === 1) setTypeId(data[0].id);
        }
        setLoading(false);
      });
  }, []);

  const accountOnly = typeId === ACCOUNT_ONLY_ID;
  const selectedType = types.find((t) => t.id === typeId);
  const fee = selectedType?.fee_cents ?? 0;
  // How many people the chosen membership covers, including the applicant
  // (e.g. Family = 4). Needs the v25 migration; before that it's simply 1
  // and the extra-people card below stays hidden.
  const includedPeople = selectedType?.included_people ?? 1;
  const extraSlots = Math.max(0, includedPeople - 1);

  // Keep one name slot per extra person the membership covers. The array
  // only ever grows — switching to a smaller type and back must not throw
  // away names already typed (only the first extraSlots are shown and sent).
  useEffect(() => {
    setPeople((prev) =>
      prev.length >= extraSlots
        ? prev
        : [
            ...prev,
            ...Array.from({ length: extraSlots - prev.length }, (_, i) => ({
              name: "",
              person_type: prev.length + i === 0 ? "adult" : "child",
            })),
          ]
    );
  }, [extraSlots]);

  const updatePerson = (idx, field, value) =>
    setPeople((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));

  const updateHorse = (id, field, value) =>
    setHorses((prev) => prev.map((h) => (h._id === id ? { ...h, [field]: value } : h)));
  const removeHorse = (id) => setHorses((prev) => prev.filter((h) => h._id !== id));

  const chooseType = (id) => {
    setTypeId(id);
    setError("");
    if (id !== ACCOUNT_ONLY_ID) {
      setAccountStep("email");
      setAccountCode("");
    }
  };

  const startCooldown = () => {
    setCooldown(60);
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) { clearInterval(timer.current); return 0; }
        return s - 1;
      });
    }, 1000);
  };

  const requestAccountCode = async () => {
    setError("");
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/account/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error ?? "Something went wrong. Please try again."); return; }
      setAccountStep("code");
      setAccountCode("");
      startCooldown();
    } catch {
      setError("Could not connect. Please check your internet and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const verifyAccountCode = async () => {
    setError("");
    if (!accountCode.trim()) { setError("Enter the 6-digit code from the email."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/account/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: accountCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error ?? "Something went wrong. Please try again."); return; }
      router.push("/account");
    } catch {
      setError("Could not connect. Please check your internet and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleInterest = (option) =>
    setInterests((prev) =>
      prev.includes(option) ? prev.filter((i) => i !== option) : [...prev, option]
    );

  const submit = async () => {
    setError("");
    if (!typeId) { setError("Please choose a membership type."); return; }
    if (!memberName.trim()) { setError("Please enter your full name."); return; }
    if (!email.trim() || !email.includes("@")) { setError("Please enter a valid email address."); return; }
    if (!phone.trim()) { setError("Please enter your phone number."); return; }
    if (!address.trim()) { setError("Please enter your address."); return; }
    if (!emergencyName.trim() || !emergencyPhone.trim()) { setError("Please enter an emergency contact name and phone number."); return; }
    const incompleteHorse = horses.find((h) =>
      !h.horse_name.trim() && (h.back_number || h.breed.trim() || h.registrations.trim() || h.notes.trim())
    );
    if (incompleteHorse) { setError("One of your horses is missing its name. Please fill it in or remove that horse."); return; }
    if (!agreed) { setError("Please confirm you have read and agree to the membership terms, liability waiver and declaration."); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/memberships/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membership_type_id: typeId,
          member_name: memberName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          address: address.trim(),
          aqha_member_number: aqhaNumber.trim(),
          other_memberships: otherMemberships.trim(),
          emergency_contact_name: emergencyName.trim(),
          emergency_contact_phone: emergencyPhone.trim(),
          interests: interests.join(", "),
          applicant_notes: applicantNotes.trim(),
          horses: horses
            .filter((h) => h.horse_name.trim())
            .map((h) => ({
              horse_name: h.horse_name.trim(),
              back_number: h.back_number || null,
              breed: h.breed.trim(),
              registrations: h.registrations.trim(),
              notes: h.notes.trim(),
            })),
          people: people
            .slice(0, extraSlots)
            .filter((p) => p.name.trim())
            .map((p) => ({ name: p.name.trim(), person_type: p.person_type })),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error ?? "Something went wrong. Please try again."); return; }
      if (data.redirect) router.push(data.redirect);
      else if (data.checkout_url) window.location.href = data.checkout_url;
    } catch {
      setError("Could not connect. Please check your internet and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <main className="wrap"><p style={{ color: "var(--quiet)" }}>Loading…</p></main>;

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)", marginBottom: 4 }}>
            Club membership
          </div>
          <h1 className="display" style={{ fontWeight: 700, fontSize: "clamp(18px,4vw,26px)", margin: "0 0 2px", color: "#F2EADB" }}>
            Become a member
          </h1>
          <div style={{ fontSize: 13, color: "#CBBFA9" }}>{seasonLabel(season)}</div>
        </div>
      </header>

      <main className="wrap">
        {!typesReady && (
          <section className="card" style={{ padding: 20 }}>
            <p style={{ margin: 0, color: "var(--quiet)", fontSize: 14 }}>
              Online membership sign-up isn&apos;t available yet — please contact the club to join.
            </p>
          </section>
        )}

        {typesReady && (
          <>
            {/* Membership type */}
            <section className="card">
              <div className="card-head">
                <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Sign-up type</div>
              </div>
              <div style={{ display: "grid", gap: 10, paddingBottom: 10 }}>
                <button type="button" onClick={() => chooseType(ACCOUNT_ONLY_ID)}
                  style={{
                    textAlign: "left",
                    borderRadius: 10,
                    border: `2px solid ${accountOnly ? "var(--leather)" : "var(--line)"}`,
                    background: accountOnly ? "var(--sand)" : "#fff",
                    padding: "12px 14px",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                  }}>
                  <span style={{ minWidth: 0 }}>
                    <span className="display" style={{ display: "block", fontWeight: 700, fontSize: 15, color: "var(--leather)" }}>
                      Account only
                    </span>
                    <span style={{ display: "block", fontSize: 12.5, color: "var(--quiet)", marginTop: 2 }}>
                      Create a login without buying a membership
                    </span>
                  </span>
                  <span className="display" style={{ fontWeight: 700, fontSize: 18, color: "var(--brass)", flexShrink: 0 }}>
                    Free
                  </span>
                </button>
                {types.map((t) => (
                  <button key={t.id} type="button" onClick={() => chooseType(t.id)}
                    style={{
                      textAlign: "left",
                      borderRadius: 10,
                      border: `2px solid ${typeId === t.id ? "var(--leather)" : "var(--line)"}`,
                      background: typeId === t.id ? "var(--sand)" : "#fff",
                      padding: "12px 14px",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                    }}>
                    <span style={{ minWidth: 0 }}>
                      <span className="display" style={{ display: "block", fontWeight: 700, fontSize: 15, color: "var(--leather)" }}>
                        {t.name}
                      </span>
                      {t.description && (
                        <span style={{ display: "block", fontSize: 12.5, color: "var(--quiet)", marginTop: 2 }}>
                          {t.description}
                        </span>
                      )}
                    </span>
                    <span className="display" style={{ fontWeight: 700, fontSize: 18, color: "var(--brass)", flexShrink: 0 }}>
                      {(t.fee_cents ?? 0) > 0 ? fmtMoney(t.fee_cents) : "Free"}
                    </span>
                  </button>
                ))}
                {types.length === 0 && (
                  <p style={{ fontSize: 13, color: "var(--quiet)", margin: 0 }}>
                    No membership types are available right now — please contact the club.
                  </p>
                )}
              </div>
            </section>

            {accountOnly ? (
              <section className="card">
                <div className="card-head">
                  <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Create your account</div>
                </div>
                <div style={{ paddingBottom: 10 }}>
                  {accountStep === "email" && (
                    <>
                      <p style={{ fontSize: 13.5, color: "var(--quiet)", margin: "0 0 10px" }}>
                        We&apos;ll email you a secure code. Entering it creates your account and signs you in.
                      </p>
                      <label className="modal-label">Email address *</label>
                      <input className="field" type="email" style={{ width: "100%", fontSize: 16 }}
                        value={email} onChange={(e) => setEmail(e.target.value)}
                        placeholder="e.g. sarah@example.com" autoComplete="email" />
                      {error && (
                        <p style={{ color: "var(--clay)", fontSize: 13.5, fontWeight: 600, marginBottom: 10, marginTop: 10 }}>
                          {error}
                        </p>
                      )}
                      <button className="btn" style={{ width: "100%", marginTop: 12, padding: 12, background: "var(--leather)" }}
                        onClick={requestAccountCode} disabled={submitting}>
                        {submitting ? "Sending…" : "Email me a code"}
                      </button>
                    </>
                  )}
                  {accountStep === "code" && (
                    <>
                      <p style={{ fontSize: 13.5, color: "var(--quiet)", margin: "0 0 10px" }}>
                        We&apos;ve emailed a 6-digit code to <strong style={{ color: "var(--ink)" }}>{email.trim()}</strong>.
                      </p>
                      <input className="field" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                        style={{ width: "100%", fontSize: 26, letterSpacing: ".35em", textAlign: "center" }}
                        value={accountCode} onChange={(e) => setAccountCode(e.target.value.replace(/\D/g, ""))}
                        onKeyDown={(e) => e.key === "Enter" && verifyAccountCode()}
                        placeholder="000000" />
                      {error && (
                        <p style={{ color: "var(--clay)", fontSize: 13.5, fontWeight: 600, marginBottom: 10, marginTop: 10 }}>
                          {error}
                        </p>
                      )}
                      <button className="btn" style={{ width: "100%", marginTop: 12, padding: 12, background: "var(--leather)" }}
                        onClick={verifyAccountCode} disabled={submitting}>
                        {submitting ? "Checking…" : "Create account"}
                      </button>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                        <button className="btn-ghost" onClick={requestAccountCode} disabled={submitting || cooldown > 0}>
                          {cooldown > 0 ? `Send a new code (${cooldown}s)` : "Send a new code"}
                        </button>
                        <button className="btn-ghost" onClick={() => { setAccountStep("email"); setAccountCode(""); setError(""); }} disabled={submitting}>
                          Use a different email
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </section>
            ) : (
              <>
            {/* Your details */}
            <section className="card">
              <div className="card-head">
                <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Your details</div>
              </div>
              <div style={{ paddingBottom: 8 }}>
                <label className="modal-label">Full name *</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }}
                  value={memberName} onChange={(e) => setMemberName(e.target.value)}
                  placeholder="e.g. Sarah O'Brien" />
                <label className="modal-label">Email address *</label>
                <input className="field" type="email" style={{ width: "100%", fontSize: 16 }}
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. sarah@example.com" />
                <p style={{ fontSize: 12, color: "var(--quiet)", margin: "6px 0 0" }}>
                  Use the same email address when entering events online — it&apos;s how we recognise your membership.
                </p>
                <label className="modal-label">Phone number *</label>
                <input className="field" type="tel" style={{ width: "100%", fontSize: 16 }}
                  value={phone} onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 0400 000 000" />
                <label className="modal-label">Address *</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }}
                  value={address} onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street, suburb, state, postcode" />
                <label className="modal-label">AQHA member number</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }}
                  value={aqhaNumber} onChange={(e) => setAqhaNumber(e.target.value)}
                  placeholder="If you have one" />
                <label className="modal-label">Other breed and association memberships</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }}
                  value={otherMemberships} onChange={(e) => setOtherMemberships(e.target.value)}
                  placeholder="e.g. PHAA, ApHC" />
              </div>
            </section>

            {/* People covered by this membership (e.g. Family) */}
            {extraSlots > 0 && (
              <section className="card">
                <div className="card-head">
                  <div>
                    <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>People covered by this membership</div>
                    <div style={{ fontSize: 12, color: "var(--quiet)", marginTop: 2 }}>
                      Your {selectedType?.name ?? "membership"} covers {includedPeople} people including you.
                      Add the others so they&apos;re on the membership — you can also add or change them later
                      from the member portal.
                    </div>
                  </div>
                </div>
                <div style={{ paddingBottom: 8 }}>
                  {people.slice(0, extraSlots).map((p, idx) => (
                    <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 10, alignItems: "end" }}>
                      <div>
                        <label className="modal-label">Person {idx + 2} name</label>
                        <input className="field" style={{ width: "100%", fontSize: 16 }}
                          value={p.name} onChange={(e) => updatePerson(idx, "name", e.target.value)}
                          placeholder="Leave blank to add later" />
                      </div>
                      <div>
                        <label className="modal-label">Adult / child</label>
                        <select className="field" style={{ width: "100%", fontSize: 15 }}
                          value={p.person_type} onChange={(e) => updatePerson(idx, "person_type", e.target.value)}>
                          <option value="adult">Adult</option>
                          <option value="child">Child</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Emergency contact */}
            <section className="card">
              <div className="card-head">
                <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Emergency contact</div>
              </div>
              <div style={{ paddingBottom: 8 }}>
                <label className="modal-label">Emergency contact name *</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }}
                  value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)}
                  placeholder="e.g. Tom O'Brien" />
                <label className="modal-label">Emergency contact phone number *</label>
                <input className="field" type="tel" style={{ width: "100%", fontSize: 16 }}
                  value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)}
                  placeholder="e.g. 0400 000 000" />
              </div>
            </section>

            {/* What would you like from the club? */}
            <section className="card">
              <div className="card-head">
                <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>What would you like from the club?</div>
              </div>
              <div style={{ display: "grid", gap: 8, paddingBottom: 10 }}>
                {INTEREST_OPTIONS.map((option) => (
                  <label key={option} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14.5, cursor: "pointer" }}>
                    <input type="checkbox" checked={interests.includes(option)}
                      onChange={() => toggleInterest(option)}
                      style={{ width: 18, height: 18, flexShrink: 0 }} />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </section>

            {/* Horses */}
            <section className="card">
              <div className="card-head">
                <div>
                  <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Your horses</div>
                  <div style={{ fontSize: 12, color: "var(--quiet)", marginTop: 2 }}>
                    Optional — add the horses you own or show so the committee can review them with your application.
                  </div>
                </div>
              </div>
              <div style={{ paddingBottom: 8 }}>
                {horses.map((h, idx) => (
                  <div key={h._id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", marginBottom: 10, background: "#fff" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "var(--quiet)" }}>Horse {idx + 1}</div>
                      <button className="btn-ghost" style={{ color: "var(--clay)", borderColor: "var(--clay)", padding: "3px 9px", fontSize: 12 }}
                        onClick={() => removeHorse(h._id)}>
                        Remove
                      </button>
                    </div>
                    <label className="modal-label">Horse name *</label>
                    <input className="field" style={{ width: "100%", fontSize: 16 }}
                      value={h.horse_name} onChange={(e) => updateHorse(h._id, "horse_name", e.target.value)}
                      placeholder="e.g. Machine Made Lady" />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div>
                        <label className="modal-label">Back number (if it has one)</label>
                        <input className="field" type="number" style={{ width: "100%", fontSize: 16 }}
                          value={h.back_number} onChange={(e) => updateHorse(h._id, "back_number", e.target.value)}
                          placeholder="e.g. 301" />
                      </div>
                      <div>
                        <label className="modal-label">Breed / colour</label>
                        <input className="field" style={{ width: "100%", fontSize: 16 }}
                          value={h.breed} onChange={(e) => updateHorse(h._id, "breed", e.target.value)}
                          placeholder="e.g. Quarter Horse, Paint" />
                      </div>
                    </div>
                    <label className="modal-label">Association registrations</label>
                    <input className="field" style={{ width: "100%", fontSize: 16 }}
                      value={h.registrations} onChange={(e) => updateHorse(h._id, "registrations", e.target.value)}
                      placeholder="e.g. AQHA Q-12345, PHAA P-678" />
                    <label className="modal-label">Anything else about this horse</label>
                    <input className="field" style={{ width: "100%", fontSize: 16 }}
                      value={h.notes} onChange={(e) => updateHorse(h._id, "notes", e.target.value)}
                      placeholder="Optional" />
                  </div>
                ))}
                <button className="btn-ghost" style={{ width: "100%", fontSize: 14 }}
                  onClick={() => setHorses((p) => [...p, blankHorse()])}>
                  + Add a horse
                </button>
              </div>
            </section>

            {/* Feedback */}
            <section className="card">
              <div className="card-head">
                <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Feedback for the club</div>
              </div>
              <div style={{ paddingBottom: 8 }}>
                <textarea className="field" rows={3} style={{ width: "100%", fontSize: 15, resize: "vertical" }}
                  value={applicantNotes} onChange={(e) => setApplicantNotes(e.target.value)}
                  placeholder="Optional — any other feedback on what we can do to support our members." />
              </div>
            </section>

            {/* Terms, liability waiver & declaration */}
            <section className="card">
              <div className="card-head">
                <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Membership terms, liability waiver & declaration</div>
              </div>
              <div style={{ paddingBottom: 10 }}>
                {WAIVER_INTRO.map((p, i) => (
                  <p key={i} style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 600, marginTop: 0 }}>{p}</p>
                ))}
                <div style={{
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  background: "#fff",
                  maxHeight: 240,
                  overflowY: "auto",
                  padding: "10px 12px",
                }}>
                  {WAIVER_BODY.map((p, i) => (
                    <p key={i} style={{ fontSize: 12.5, color: "var(--quiet)", lineHeight: 1.5, marginTop: i === 0 ? 0 : 10, marginBottom: 0 }}>{p}</p>
                  ))}
                  {WAIVER_DECLARATION.map((p, i) => (
                    <p key={i} style={{ fontSize: 12.5, color: "var(--ink)", fontWeight: 600, lineHeight: 1.5, marginTop: 10, marginBottom: 0 }}>{p}</p>
                  ))}
                </div>
              </div>
            </section>

            {/* Total + submit */}
            <section className="card" style={{ background: "var(--sand)" }}>
              <div style={{ padding: "4px 0 8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>
                      {selectedType ? selectedType.name : "Membership"} · {seasonLabel(season)}
                    </div>
                    {fee > 0 && (
                      <div style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 2 }}>
                        Paid securely via Square · receipt emailed to you
                      </div>
                    )}
                  </div>
                  <div className="display" style={{ fontWeight: 700, fontSize: 28, color: "var(--leather)" }}>
                    {fee > 0 ? fmtMoney(fee) : "Free"}
                  </div>
                </div>
                {error && (
                  <p style={{ color: "var(--clay)", fontSize: 13.5, fontWeight: 600, marginBottom: 10, marginTop: 0 }}>
                    {error}
                  </p>
                )}
                <label style={{ display: "flex", alignItems: "flex-start", gap: 9, marginBottom: 10, color: "var(--leather)", fontSize: 13, fontWeight: 700 }}>
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
                    style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0 }} />
                  <span>I/we have read, understood and agree to the membership terms, liability waiver and declaration above, agree to abide by the Constitution and the Rules and Regulations of AQHA and HCQHA, and understand my application is subject to committee approval.</span>
                </label>
                <button className="btn" style={{ width: "100%", fontSize: 17, padding: 14, background: "var(--leather)" }}
                  onClick={submit} disabled={submitting || !types.length}>
                  {submitting
                    ? "Submitting…"
                    : fee > 0
                    ? `Join & Pay ${fmtMoney(fee)}`
                    : "Submit application"}
                </button>
                <p style={{ fontSize: 11.5, color: "var(--quiet)", lineHeight: 1.45, margin: "10px 0 0" }}>
                  Memberships run from 1 August to 31 July. Applications are reviewed by the committee before
                  becoming active — you&apos;ll receive an email once yours is approved.
                </p>
              </div>
            </section>
              </>
            )}

            <p style={{ textAlign: "center", marginTop: 10 }}>
              <Link href="/" style={{ color: "var(--brass)", fontSize: 13 }}>← Back to events</Link>
            </p>
          </>
        )}
      </main>
    </>
  );
}
