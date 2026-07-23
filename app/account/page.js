"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { seasonLabel, signupSeason } from "../../lib/membershipSeason";
import ClubRegistrations, { registrationsToRows } from "../components/ClubRegistrations";

// "AQHA 12345, PHAA 678" from a stored association_registrations list.
const regLabel = (list) =>
  Array.isArray(list)
    ? list.map((r) => [r.club, r.number].filter(Boolean).join(" ").trim()).filter(Boolean).join(", ")
    : "";

// Member portal: sign in with an emailed 6-digit code, then see and update
// your membership details, the people it covers, and your horses. This page
// never touches Supabase directly — everything goes through /api/account/*
// (members are not Supabase users; see CLAUDE.md "Member accounts").

const STATUS_BADGE = {
  paid: { className: "live", label: "Awaiting committee approval" },
  pending: { className: "closed", label: "Awaiting payment" },
  rejected: { className: "archived", label: "Not approved" },
};

const fmtBack = (n) => String(n).padStart(3, "0");

function memberBadge(m) {
  if (m.status === "approved") {
    if (m.is_current) return { className: "completed", label: "Current member" };
    if (m.is_upcoming) return { className: "upcoming", label: "Upcoming member" };
    return { className: "completed", label: "Approved" };
  }
  return STATUS_BADGE[m.status] ?? { className: "archived", label: m.status };
}

async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { ok: res.ok, status: res.status, data };
}

function CardTitle({ children, right }) {
  return (
    <div className="card-head">
      <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>{children}</div>
      {right}
    </div>
  );
}

function DetailRow({ label, value, quiet }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--quiet)" }}>
        {label}
      </div>
      <div style={{ fontSize: 15, color: quiet ? "var(--quiet)" : "var(--ink)" }}>{value || "—"}</div>
    </div>
  );
}

// ---------- Sign-in (email -> code) ----------

function SignIn({ onSignedIn }) {
  const [step, setStep] = useState("email"); // email | code
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

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

  const requestCode = async () => {
    setError("");
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      const { ok, data } = await api("/api/account/request-code", "POST", { email: email.trim() });
      if (!ok) { setError(data?.error ?? "Something went wrong — try again."); return; }
      setStep("code");
      setCode("");
      startCooldown();
    } catch {
      setError("Could not connect. Please check your internet and try again.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError("");
    if (!code.trim()) { setError("Enter the 6-digit code from the email."); return; }
    setBusy(true);
    try {
      const { ok, data } = await api("/api/account/verify-code", "POST", { email: email.trim(), code: code.trim() });
      if (!ok) { setError(data?.error ?? "Something went wrong — try again."); return; }
      onSignedIn();
    } catch {
      setError("Could not connect. Please check your internet and try again.");
    } finally {
      setBusy(false);
    }
  };

  const signInWithPassword = async () => {
    setError("");
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Enter your password — or use an emailed code instead.");
      return;
    }
    setBusy(true);
    try {
      const { ok, data } = await api("/api/account/password-login", "POST", { email: email.trim(), password });
      if (!ok) { setError(data?.error ?? "Something went wrong — try again."); return; }
      onSignedIn();
    } catch {
      setError("Could not connect. Please check your internet and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="card">
        <CardTitle>Sign in or create an account</CardTitle>
        <div style={{ padding: "0 16px 14px" }}>
          {step === "email" && (
            <>
              <p style={{ fontSize: 13.5, color: "var(--quiet)", margin: "10px 0 8px" }}>
                Anyone can have an account — you don&apos;t need a membership. If you have one,
                use the same email address as your membership so it shows up here.
              </p>
              <label className="modal-label">Email address</label>
              <input className="field" type="email" style={{ width: "100%", fontSize: 16 }}
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. sarah@example.com" autoComplete="email" />
              <label className="modal-label">Password</label>
              <input className="field" type="password" style={{ width: "100%", fontSize: 16 }}
                value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && signInWithPassword()}
                placeholder="Your password" autoComplete="current-password" />
              {error && <p className="modal-error">{error}</p>}
              <button className="btn" style={{ width: "100%", marginTop: 12, padding: 12, background: "var(--leather)" }}
                onClick={signInWithPassword} disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
              <p style={{ fontSize: 12.5, color: "var(--quiet)", margin: "14px 0 8px", textAlign: "center" }}>
                First time here, no password yet, or forgotten it? We&apos;ll email you a code —
                signing in with it creates your account, and you can set a password once you&apos;re in.
              </p>
              <button className="btn-ghost" style={{ width: "100%", fontSize: 14, padding: "9px 0" }}
                onClick={requestCode} disabled={busy}>
                {busy ? "Sending…" : "Email me a code"}
              </button>
            </>
          )}
          {step === "code" && (
            <>
              <p style={{ fontSize: 13.5, color: "var(--quiet)", margin: "10px 0 8px" }}>
                We&apos;ve emailed a 6-digit code to <strong style={{ color: "var(--ink)" }}>{email.trim()}</strong>.
                It expires in 10 minutes — check your spam folder if it doesn&apos;t arrive.
              </p>
              <input className="field" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                style={{ width: "100%", fontSize: 26, letterSpacing: ".35em", textAlign: "center" }}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && verify()}
                placeholder="000000" />
              {error && <p className="modal-error">{error}</p>}
              <button className="btn" style={{ width: "100%", marginTop: 12, padding: 12, background: "var(--leather)" }}
                onClick={verify} disabled={busy}>
                {busy ? "Checking…" : "Sign in"}
              </button>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
                <button className="btn-ghost" onClick={requestCode} disabled={busy || cooldown > 0}>
                  {cooldown > 0 ? `Send a new code (${cooldown}s)` : "Send a new code"}
                </button>
                <button className="btn-ghost" onClick={() => { setStep("email"); setError(""); }}>
                  Use a different email
                </button>
              </div>
            </>
          )}
        </div>
      </section>
      <p style={{ textAlign: "center", fontSize: 13.5 }}>
        Not a member yet?{" "}
        <Link href="/membership" style={{ color: "var(--brass)", fontWeight: 700 }}>Join the club →</Link>
      </p>
    </>
  );
}

// ---------- Portal cards ----------

function StatusCard({ m, renewal }) {
  const badge = memberBadge(m);
  return (
    <section className="card">
      <CardTitle right={<span className={`badge ${badge.className}`}>{badge.label}</span>}>
        {m.is_upcoming ? "Upcoming membership" : renewal ? "Renewal application" : "Membership"}
      </CardTitle>
      <div style={{ padding: "10px 16px 14px" }}>
        <div className="display" style={{ fontWeight: 700, fontSize: 17, color: "var(--leather)" }}>
          {m.membership_type_name || "Club membership"}
        </div>
        <div style={{ fontSize: 13, color: "var(--quiet)", marginTop: 2 }}>{seasonLabel(m.season)}</div>
        {m.status === "pending" && m.square_checkout_url && (
          <a className="btn" href={m.square_checkout_url}
            style={{ display: "block", textAlign: "center", textDecoration: "none", marginTop: 12, padding: 12 }}>
            Finish payment →
          </a>
        )}
        {m.status === "paid" && (
          <p style={{ fontSize: 13, color: "var(--quiet)", margin: "10px 0 0" }}>
            Your payment is in — the committee will review your application and you&apos;ll get an email once it&apos;s approved.
          </p>
        )}
        {m.status === "rejected" && (
          <p style={{ fontSize: 13, color: "var(--quiet)", margin: "10px 0 0" }}>
            This application wasn&apos;t approved — contact the club if you think that&apos;s a mistake.
          </p>
        )}
      </div>
    </section>
  );
}

function PastMembershipRow({ m }) {
  const badge = memberBadge(m);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{m.membership_type_name || "Membership"}</div>
        <div style={{ fontSize: 12, color: "var(--quiet)" }}>{seasonLabel(m.season)}</div>
      </div>
      <span className={`badge ${badge.className}`}>{badge.label}</span>
    </div>
  );
}

function DetailsCard({ m, email, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const openEdit = () => {
    setForm({
      phone: m.phone ?? "",
      address: m.address ?? "",
      association_registrations: registrationsToRows(m),
      emergency_contact_name: m.emergency_contact_name ?? "",
      emergency_contact_phone: m.emergency_contact_phone ?? "",
    });
    setError("");
    setEditing(true);
  };

  const save = async () => {
    setError("");
    setBusy(true);
    try {
      const { ok, data } = await api("/api/account/details", "PATCH", { member_id: m.id, ...form });
      if (!ok) { setError(data?.error ?? "Something went wrong — try again."); return; }
      setEditing(false);
      onChanged();
    } catch {
      setError("Could not connect. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  return (
    <section className="card">
      <CardTitle right={m.editable && (
        <button className="btn-ghost" onClick={openEdit}>Edit</button>
      )}>
        Contact details
      </CardTitle>
      <div style={{ padding: "12px 16px 8px" }}>
        <DetailRow label="Name" value={m.member_name} />
        <DetailRow label="Email" value={email} />
        <p style={{ fontSize: 12, color: "var(--quiet)", margin: "-4px 0 8px" }}>
          Your membership is linked to this email address — contact the club to change it.
        </p>
        <DetailRow label="Phone" value={m.phone} />
        <DetailRow label="Address" value={m.address} />
        <DetailRow label="Club registrations" value={regLabel(m.association_registrations) || [m.aqha_member_number && `AQHA ${m.aqha_member_number}`, m.other_memberships].filter(Boolean).join(", ")} />
        <DetailRow label="Emergency contact"
          value={[m.emergency_contact_name, m.emergency_contact_phone].filter(Boolean).join(" · ")} />
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => !busy && setEditing(false)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Edit contact details</h3>
            <label className="modal-label">Phone number *</label>
            <input className="field" type="tel" style={{ width: "100%", fontSize: 16 }}
              value={form.phone} onChange={set("phone")} />
            <label className="modal-label">Address *</label>
            <input className="field" style={{ width: "100%", fontSize: 16 }}
              value={form.address} onChange={set("address")} />
            <div style={{ marginTop: 4, marginBottom: 4 }}>
              <ClubRegistrations
                value={form.association_registrations}
                onChange={(v) => setForm((f) => ({ ...f, association_registrations: v }))}
                hint="AQHA, PHAA (Paint), AAA (Appaloosa) or any club — add each with your member number." />
            </div>
            <label className="modal-label">Emergency contact name *</label>
            <input className="field" style={{ width: "100%", fontSize: 16 }}
              value={form.emergency_contact_name} onChange={set("emergency_contact_name")} />
            <label className="modal-label">Emergency contact phone *</label>
            <input className="field" type="tel" style={{ width: "100%", fontSize: 16 }}
              value={form.emergency_contact_phone} onChange={set("emergency_contact_phone")} />
            {error && <p className="modal-error">{error}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function PeopleCard({ m, onChanged }) {
  const covered = m.included_people ?? null;
  const people = m.people ?? [];
  const [modal, setModal] = useState(null); // { id?, name, person_type }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!(covered > 1) && people.length === 0) return null;

  const atCap = covered != null && people.length >= covered - 1;

  const save = async () => {
    setError("");
    if (!modal.name.trim()) { setError("Enter the person's name."); return; }
    setBusy(true);
    try {
      const payload = {
        name: modal.name, person_type: modal.person_type, email: modal.email ?? "", phone: modal.phone ?? "",
        association_registrations: modal.association_registrations ?? [],
      };
      const { ok, data } = modal.id
        ? await api("/api/account/people", "PATCH", { id: modal.id, ...payload })
        : await api("/api/account/people", "POST", { member_id: m.id, ...payload });
      if (!ok) { setError(data?.error ?? "Something went wrong — try again."); return; }
      setModal(null);
      onChanged();
    } catch {
      setError("Could not connect. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (person) => {
    if (!window.confirm(`Remove ${person.name} from this membership?`)) return;
    const { ok, data } = await api("/api/account/people", "DELETE", { id: person.id });
    if (!ok) window.alert(data?.error ?? "Something went wrong — try again.");
    else onChanged();
  };

  return (
    <section className="card">
      <CardTitle>People on this membership</CardTitle>
      <div style={{ padding: "12px 16px 14px" }}>
        {covered > 1 && (
          <p style={{ fontSize: 12.5, color: "var(--quiet)", margin: "0 0 10px" }}>
            Your {m.membership_type_name || "membership"} covers {covered} people including you.
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{m.member_name}</div>
            <div style={{ fontSize: 12, color: "var(--quiet)" }}>You — from your application</div>
          </div>
        </div>
        {people.map((p) => (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: "var(--quiet)" }}>
                {p.person_type === "child" ? "Child" : "Adult"}{p.email ? ` · ${p.email}` : ""}{regLabel(p.association_registrations) ? ` · ${regLabel(p.association_registrations)}` : ""}
              </div>
            </div>
            {m.editable && (
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn-ghost" onClick={() => { setError(""); setModal({ id: p.id, name: p.name, person_type: p.person_type, email: p.email ?? "", phone: p.phone ?? "", association_registrations: registrationsToRows(p) }); }}>
                  Edit
                </button>
                <button className="btn-ghost danger" onClick={() => remove(p)}>Remove</button>
              </div>
            )}
          </div>
        ))}
        {m.editable && (
          <>
            <button className="btn-ghost" style={{ width: "100%", marginTop: 12, fontSize: 14, padding: "8px 0" }}
              onClick={() => { setError(""); setModal({ name: "", person_type: people.length ? "child" : "adult", email: "", phone: "", association_registrations: [] }); }}
              disabled={atCap}>
              + Add a person
            </button>
            {atCap && (
              <p style={{ fontSize: 12, color: "var(--quiet)", margin: "6px 0 0", textAlign: "center" }}>
                Your membership covers {covered} people including you — contact the club if that&apos;s not right.
              </p>
            )}
          </>
        )}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => !busy && setModal(null)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">{modal.id ? "Edit person" : "Add a person"}</h3>
            <label className="modal-label">Name *</label>
            <input className="field" style={{ width: "100%", fontSize: 16 }}
              value={modal.name} onChange={(e) => setModal((v) => ({ ...v, name: e.target.value }))} />
            <label className="modal-label">Adult or child?</label>
            <select className="field" style={{ width: "100%", fontSize: 16 }}
              value={modal.person_type}
              onChange={(e) => setModal((v) => ({ ...v, person_type: e.target.value }))}>
              <option value="adult">Adult</option>
              <option value="child">Child</option>
            </select>
            <label className="modal-label">Their email (optional)</label>
            <input className="field" type="email" style={{ width: "100%", fontSize: 16 }}
              value={modal.email ?? ""} onChange={(e) => setModal((v) => ({ ...v, email: e.target.value }))}
              placeholder="So they can enter events under their own email" />
            <label className="modal-label">Phone (optional)</label>
            <input className="field" type="tel" style={{ width: "100%", fontSize: 16 }}
              value={modal.phone ?? ""} onChange={(e) => setModal((v) => ({ ...v, phone: e.target.value }))} />
            <div style={{ marginTop: 4 }}>
              <ClubRegistrations
                value={modal.association_registrations}
                onChange={(v) => setModal((prev) => ({ ...prev, association_registrations: v }))}
                label="Their clubs (optional)"
                hint="AQHA / PHAA / AAA or any — add each with the member number." />
            </div>
            {error && <p className="modal-error">{error}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setModal(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function HorsesCard({ m, onChanged }) {
  const horses = m.horses ?? [];
  const [modal, setModal] = useState(null); // { id?, horse_name, current_back_number?, breed, registrations, notes }
  const [numberSuggestion, setNumberSuggestion] = useState(null);
  const [checkingNumber, setCheckingNumber] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    if (!modal.horse_name.trim()) { setError("Enter the horse's name."); return; }
    setBusy(true);
    try {
      const { current_back_number, ...payload } = modal;
      const body = { ...payload, member_id: m.id };
      const { ok, data } = modal.id
        ? await api("/api/account/horses", "PATCH", body)
        : await api("/api/account/horses", "POST", body);
      if (!ok) { setError(data?.error ?? "Something went wrong — try again."); return; }
      setModal(null);
      onChanged();
    } catch {
      setError("Could not connect. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (horse) => {
    if (!window.confirm(`Remove ${horse.horse_name} from your membership?`)) return;
    const { ok, data } = await api("/api/account/horses", "DELETE", { id: horse.id });
    if (!ok) window.alert(data?.error ?? "Something went wrong — try again.");
    else onChanged();
  };

  const setField = (field) => (e) => setModal((v) => ({ ...v, [field]: e.target.value }));
  const suggestedBackNumber = numberSuggestion?.back_number ?? modal?.current_back_number ?? null;
  const numberNote = checkingNumber
    ? "Checking the horse registry…"
    : numberSuggestion?.matched_registry
      ? `Matched ${numberSuggestion.horse_name} in the registry.`
      : modal?.id && modal.current_back_number != null
        ? "This horse keeps its assigned number."
        : suggestedBackNumber != null
          ? "Next available number."
          : "The next available number is added when you save.";

  useEffect(() => {
    if (!modal) {
      setNumberSuggestion(null);
      setCheckingNumber(false);
      return undefined;
    }

    const horseName = modal.horse_name.trim();
    if (!horseName) {
      setNumberSuggestion(null);
      setCheckingNumber(false);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setCheckingNumber(true);
      try {
        const params = new URLSearchParams({ name: horseName });
        if (modal.id) params.set("id", modal.id);
        const { ok, data } = await api(`/api/account/horses?${params.toString()}`);
        if (!cancelled) setNumberSuggestion(ok ? data?.suggestion ?? null : null);
      } catch {
        if (!cancelled) setNumberSuggestion(null);
      } finally {
        if (!cancelled) setCheckingNumber(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [modal?.horse_name, modal?.id]);

  return (
    <section className="card">
      <CardTitle>Your horses</CardTitle>
      <div style={{ padding: "12px 16px 14px" }}>
        {horses.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--quiet)", margin: "0 0 10px" }}>
            No horses listed yet{m.editable ? " — add the horses you own or show below." : "."}
          </p>
        )}
        {horses.map((h) => (
          <div key={h.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                {h.back_number != null && (
                  <span style={{ color: "var(--brass)", marginRight: 6 }}>#{fmtBack(h.back_number)}</span>
                )}
                {h.horse_name}
              </div>
              <div style={{ fontSize: 12, color: "var(--quiet)" }}>
                {[h.breed, h.registrations].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            {m.editable && (
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button className="btn-ghost" onClick={() => {
                  setError("");
                  setNumberSuggestion(null);
                  setCheckingNumber(false);
                  setModal({
                    id: h.id,
                    horse_name: h.horse_name ?? "",
                    current_back_number: h.back_number ?? null,
                    breed: h.breed ?? "",
                    registrations: h.registrations ?? "",
                    notes: h.notes ?? "",
                  });
                }}>
                  Edit
                </button>
                <button className="btn-ghost danger" onClick={() => remove(h)}>Remove</button>
              </div>
            )}
          </div>
        ))}
        {m.editable && (
          <>
            <button className="btn-ghost" style={{ width: "100%", marginTop: 12, fontSize: 14, padding: "8px 0" }}
              onClick={() => { setError(""); setNumberSuggestion(null); setCheckingNumber(false); setModal({ horse_name: "", breed: "", registrations: "", notes: "" }); }}>
              + Add a horse
            </button>
            {horses.length >= 1 && (
              <p style={{ fontSize: 12, color: "var(--quiet)", margin: "8px 0 0" }}>
                Your first horse&apos;s number is covered by your membership. Each additional horse that needs a new number is $5, collected by the club.
              </p>
            )}
          </>
        )}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => !busy && setModal(null)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">{modal.id ? "Edit horse" : "Add a horse"}</h3>
            <label className="modal-label">Horse name *</label>
            <input className="field" style={{ width: "100%", fontSize: 16 }}
              value={modal.horse_name} onChange={setField("horse_name")} placeholder="e.g. Machine Made Lady" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label className="modal-label">Back number</label>
                <div className="field" style={{ width: "100%", minHeight: 48, display: "flex", alignItems: "center", fontSize: 16, fontWeight: 800, color: "var(--brass)", background: "#fbf8f2" }}>
                  {checkingNumber ? "Checking…" : suggestedBackNumber != null ? `#${fmtBack(suggestedBackNumber)}` : "Auto"}
                </div>
                <p style={{ fontSize: 12, color: "var(--quiet)", margin: "4px 0 0" }}>{numberNote}</p>
              </div>
              <div>
                <label className="modal-label">Breed / colour</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }}
                  value={modal.breed} onChange={setField("breed")} placeholder="e.g. Quarter Horse" />
              </div>
            </div>
            <label className="modal-label">Association registrations</label>
            <input className="field" style={{ width: "100%", fontSize: 16 }}
              value={modal.registrations} onChange={setField("registrations")} placeholder="e.g. AQHA Q-12345" />
            <label className="modal-label">Anything else about this horse</label>
            <input className="field" style={{ width: "100%", fontSize: 16 }}
              value={modal.notes} onChange={setField("notes")} placeholder="Optional" />
            {error && <p className="modal-error">{error}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setModal(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function PasswordCard({ hasPassword, onChanged }) {
  const [modal, setModal] = useState(false);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const openModal = () => { setPw(""); setConfirm(""); setError(""); setModal(true); };

  const save = async () => {
    setError("");
    if (pw.length < 8) { setError("Use at least 8 characters."); return; }
    if (pw !== confirm) { setError("The two passwords don't match."); return; }
    setBusy(true);
    try {
      const { ok, data } = await api("/api/account/password", "POST", { password: pw });
      if (!ok) { setError(data?.error ?? "Something went wrong — try again."); return; }
      setModal(false);
      onChanged();
    } catch {
      setError("Could not connect. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <CardTitle right={
        <button className="btn-ghost" onClick={openModal}>
          {hasPassword ? "Change password" : "Set a password"}
        </button>
      }>
        Sign-in &amp; security
      </CardTitle>
      <div style={{ padding: "12px 16px 14px" }}>
        <p style={{ fontSize: 13, color: "var(--quiet)", margin: 0 }}>
          {hasPassword
            ? "You have a password — sign in with it, or with an emailed code whenever you like. Forgot it? Just sign in with a code and set a new one here."
            : "You don't have a password yet — set one to sign in without waiting for an email. The emailed code always keeps working too."}
        </p>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => !busy && setModal(false)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">{hasPassword ? "Change password" : "Set a password"}</h3>
            <label className="modal-label">New password (at least 8 characters)</label>
            <input className="field" type="password" style={{ width: "100%", fontSize: 16 }}
              value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            <label className="modal-label">Type it again</label>
            <input className="field" type="password" style={{ width: "100%", fontSize: 16 }}
              value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password"
              onKeyDown={(e) => e.key === "Enter" && save()} />
            {error && <p className="modal-error">{error}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="btn" style={{ flex: 1, background: "var(--leather)" }} onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save password"}
              </button>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setModal(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- Page ----------

export default function AccountPage() {
  const [phase, setPhase] = useState("checking"); // checking | signedOut | portal | error
  const [me, setMe] = useState(null);

  const fetchMe = async () => {
    try {
      const { ok, status, data } = await api("/api/account/me");
      if (ok) { setMe(data); setPhase("portal"); return; }
      if (status === 401) { setMe(null); setPhase("signedOut"); return; }
      // Anything else is a hiccup, not a sign-out — a member with a valid
      // session shouldn't be bounced to the sign-in form by a 500.
      setPhase("error");
    } catch {
      setPhase("error");
    }
  };

  useEffect(() => { fetchMe(); }, []);

  const signOut = async () => {
    await api("/api/account/logout", "POST");
    setMe(null);
    setPhase("signedOut");
  };

  const memberships = me?.memberships ?? [];
  const activeRows = memberships.filter((m) => m.is_active_season);
  const pastRows = memberships.filter((m) => !m.is_active_season);
  const hasCurrent = activeRows.some((m) => m.is_current);
  // The application the editable cards work on: newest editable row of the
  // active seasons, falling back to the newest editable row of any season so
  // lapsed members can still tidy their details before renewing.
  const primary = activeRows.find((m) => m.editable) ?? memberships.find((m) => m.editable);
  const pastApproved = pastRows.some((m) => m.status === "approved");

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)", marginBottom: 4 }}>
              Member portal
            </div>
            <h1 className="display" style={{ fontWeight: 700, fontSize: "clamp(18px,4vw,26px)", margin: "0 0 2px", color: "#F2EADB" }}>
              My membership
            </h1>
            {phase === "portal" && (
              <div style={{ fontSize: 13, color: "#CBBFA9" }}>{me?.email}</div>
            )}
          </div>
          {phase === "portal" && (
            <button className="btn-ghost" style={{ background: "transparent", color: "#CBBFA9", borderColor: "rgba(203,191,169,.4)" }}
              onClick={signOut}>
              Sign out
            </button>
          )}
        </div>
      </header>

      <main className="wrap">
        {phase === "checking" && <p style={{ color: "var(--quiet)" }}>Loading…</p>}

        {phase === "error" && (
          <section className="card" style={{ padding: 20, textAlign: "center" }}>
            <p style={{ margin: "0 0 12px", color: "var(--quiet)", fontSize: 14 }}>
              Something went wrong loading your details — it&apos;s usually momentary.
            </p>
            <button className="btn" style={{ background: "var(--leather)" }}
              onClick={() => { setPhase("checking"); fetchMe(); }}>
              Try again
            </button>
          </section>
        )}

        {phase === "signedOut" && <SignIn onSignedIn={fetchMe} />}

        {phase === "portal" && (
          <>
            {activeRows.map((m) => (
              <StatusCard key={m.id} m={m} renewal={hasCurrent && !m.is_current} />
            ))}

            {activeRows.length === 0 && (
              <section className="card" style={{ background: "var(--sand)" }}>
                <div style={{ padding: "16px" }}>
                  <div className="display" style={{ fontWeight: 700, fontSize: 17, color: "var(--leather)" }}>
                    {pastApproved
                      ? "Your membership has ended"
                      : `No current membership for the ${seasonLabel(signupSeason())}`}
                  </div>
                  <p style={{ fontSize: 13.5, color: "var(--quiet)", margin: "6px 0 12px" }}>
                    {pastApproved
                      ? "Renew below to keep entering events as a member."
                      : "There's no membership on file for this email address yet."}
                  </p>
                  <Link className="btn" href="/membership"
                    style={{ display: "block", textAlign: "center", textDecoration: "none", padding: 12 }}>
                    {pastApproved ? "Renew membership →" : "Join the club →"}
                  </Link>
                </div>
              </section>
            )}

            {primary && (
              <>
                <DetailsCard m={primary} email={me?.email} onChanged={fetchMe} />
                <PeopleCard m={primary} onChanged={fetchMe} />
                <HorsesCard m={primary} onChanged={fetchMe} />
              </>
            )}

            <PasswordCard hasPassword={me?.has_password} onChanged={fetchMe} />

            {pastRows.length > 0 && (
              <details className="card" style={{ padding: "0 16px" }}>
                <summary style={{ padding: "14px 0", cursor: "pointer", fontWeight: 700, fontSize: 14, color: "var(--quiet)" }}>
                  Past seasons ({pastRows.length})
                </summary>
                <div style={{ paddingBottom: 12 }}>
                  {pastRows.map((m) => (
                    <PastMembershipRow key={m.id} m={m} />
                  ))}
                </div>
              </details>
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
