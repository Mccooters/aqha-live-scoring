"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../../lib/supabaseClient";
import { groupedByProgramCategory } from "../../../../lib/classCategories";
import { activeSeasons } from "../../../../lib/membershipSeason";

const fmtMoney = (cents) => `$${(cents / 100).toFixed(2)}`;
// "2026-2027" → "2026–27"
const shortSeason = (season) => {
  const [a, b] = String(season ?? "").split("-");
  return b ? `${a}–${b.slice(2)}` : season;
};
const DAY_MEMBERSHIP_CENTS = 2000;
const REPLACEMENT_NUMBERS_CENTS = 500;

function basicClassLabel(cls, isClinic) {
  if (!cls) return "";
  return isClinic ? cls.name : `Class ${cls.num}: ${cls.name}`;
}

function searchText(cls, isClinic, availability) {
  return [
    basicClassLabel(cls, isClinic),
    cls.program_category,
    cls.judge,
    cls.judge2,
    availability,
  ].filter(Boolean).join(" ").toLowerCase();
}

function ClassSearchSelect({ value, classes, isClinic, onChange, classIsFull, spotsLabel }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const selectedClass = classes.find((cls) => cls.id === value);

  useEffect(() => {
    if (selectedClass) setQuery(basicClassLabel(selectedClass, isClinic));
  }, [selectedClass, isClinic]);

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = classes.filter((cls) => {
    if (!terms.length) return true;
    const label = spotsLabel(cls);
    const haystack = searchText(cls, isClinic, label);
    return terms.every((term) => haystack.includes(term));
  });
  const grouped = isClinic
    ? [{ key: "spots", label: "Spot types", classes: filtered }]
    : groupedByProgramCategory(filtered, "Classes");

  const chooseClass = (cls) => {
    if (classIsFull(cls)) return;
    onChange(cls.id);
    setQuery(basicClassLabel(cls, isClinic));
    setOpen(false);
  };

  return (
    <div>
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          className="field"
          style={{ width: "100%", fontSize: 16, paddingRight: 44 }}
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (value) onChange("");
          }}
          placeholder={isClinic ? "Type to search spot types..." : "Type class number, name, or category..."}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
        />
        <button
          type="button"
          aria-label={`Show ${isClinic ? "spot type" : "class"} options`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setOpen(true);
            inputRef.current?.focus();
          }}
          style={{
            position: "absolute",
            right: 8,
            top: 6,
            bottom: 6,
            width: 30,
            border: 0,
            borderLeft: "1px solid var(--line)",
            background: "transparent",
            color: "var(--quiet)",
            fontSize: 16,
            fontWeight: 800,
          }}>
          ▾
        </button>
      </div>
      {open && (
        <div style={{
          marginTop: 6,
          border: "1px solid var(--line)",
          background: "#fff",
          borderRadius: 8,
          maxHeight: 260,
          overflowY: "auto",
          boxShadow: "0 10px 22px rgba(42,30,18,.12)",
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "10px 12px", color: "var(--quiet)", fontSize: 13 }}>
              No matching {isClinic ? "spot types" : "classes"}.
            </div>
          ) : grouped.map((group) => (
            <div key={group.key}>
              {!isClinic && group.label && (
                <div style={{
                  padding: "7px 10px 4px",
                  color: "#1746C6",
                  fontWeight: 800,
                  fontSize: 11,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  background: "#F7FAFF",
                  borderTop: "1px solid var(--line)",
                }}>
                  {group.label}
                </div>
              )}
              {group.classes.map((cls) => {
                const label = spotsLabel(cls);
                const full = classIsFull(cls);
                return (
                  <button
                    key={cls.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => chooseClass(cls)}
                    disabled={full}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      border: 0,
                      borderTop: "1px solid var(--line)",
                      background: value === cls.id ? "#FBF4E4" : "#fff",
                      color: full ? "var(--quiet)" : "var(--ink)",
                      opacity: full ? .55 : 1,
                      padding: "10px 12px",
                      cursor: full ? "not-allowed" : "pointer",
                    }}>
                    <span style={{ display: "block", fontWeight: 700 }}>
                      {basicClassLabel(cls, isClinic)}
                    </span>
                    <span style={{ display: "block", fontSize: 12, color: full ? "var(--clay)" : "var(--quiet)", marginTop: 2 }}>
                      {[
                        !isClinic && cls.program_category,
                        cls.judge2 ? `Judges: ${cls.judge || "-"} / ${cls.judge2}` : cls.judge ? `Judge: ${cls.judge}` : null,
                        label,
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MultiClassPicker({ selectedIds, classes, onToggle, classIsFull, spotsLabel }) {
  const [query, setQuery] = useState("");
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = classes.filter((cls) => {
    if (!terms.length) return true;
    const haystack = searchText(cls, false, spotsLabel(cls));
    return terms.every((term) => haystack.includes(term));
  });
  const grouped = groupedByProgramCategory(filtered, "Classes");
  const selected = new Set(selectedIds);

  return (
    <div>
      <input
        className="field"
        style={{ width: "100%", fontSize: 16, marginBottom: 10 }}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search class number, name, or category..."
        autoComplete="off"
      />
      <div style={{
        border: "1px solid var(--line)",
        borderRadius: 10,
        background: "#fff",
        maxHeight: 440,
        overflowY: "auto",
      }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "12px 14px", color: "var(--quiet)", fontSize: 13 }}>
            No matching classes.
          </div>
        ) : grouped.map((group) => (
          <div key={group.key}>
            {group.label && (
              <div style={{
                padding: "8px 12px 5px",
                color: "#1746C6",
                fontWeight: 800,
                fontSize: 11,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                background: "#F7FAFF",
                borderTop: "1px solid var(--line)",
              }}>
                {group.label}
              </div>
            )}
            {group.classes.map((cls) => {
              const checked = selected.has(cls.id);
              const full = classIsFull(cls);
              const disabled = full && !checked;
              return (
                <label
                  key={cls.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "22px 1fr auto",
                    gap: 10,
                    alignItems: "center",
                    padding: "11px 12px",
                    borderTop: "1px solid var(--line)",
                    background: checked ? "#FBF4E4" : "#fff",
                    opacity: disabled ? .55 : 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onToggle(cls.id)}
                    style={{ width: 18, height: 18 }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span className="display" style={{ display: "block", fontWeight: 700, fontSize: 15 }}>
                      Class {cls.num} · {cls.name}
                    </span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--quiet)", marginTop: 2 }}>
                      {[
                        cls.judge2 ? `Judges: ${cls.judge || "-"} / ${cls.judge2}` : cls.judge ? `Judge: ${cls.judge}` : null,
                        spotsLabel(cls),
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span style={{ fontSize: 12, color: checked ? "var(--brass)" : "var(--quiet)", fontWeight: 800 }}>
                    {checked ? "Selected" : full ? "Full" : ""}
                  </span>
                </label>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function blankEntry() {
  return {
    _id: Math.random().toString(36).slice(2),
    class_id: "",
    back_number: "",
    no_back_number: false, // new horse — a number is assigned once payment is confirmed
    horse_name: "",
    exhibitor: "",
    registryChecked: false,
    registryMatched: false,
  };
}

// The tick-box + note shown under the back-number field in both entry modes.
function NewHorseToggle({ checked, onChange }) {
  return (
    <>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, fontSize: 12.5, color: "var(--leather)", fontWeight: 700, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: 16, height: 16, flexShrink: 0 }}
        />
        <span>This horse doesn&apos;t have a back number yet</span>
      </label>
      {checked && (
        <p style={{ fontSize: 12.5, color: "var(--quiet)", margin: "4px 0 0" }}>
          The next available number will be assigned automatically once payment is
          confirmed, and registered to this horse permanently — it appears on your
          booking confirmation.
        </p>
      )}
    </>
  );
}

export default function RegisterPage() {
  const { id: eventId } = useParams();
  const router = useRouter();

  const [event, setEvent] = useState(null);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

  const [entries, setEntries] = useState([blankEntry()]);
  const [entryMode, setEntryMode] = useState("single");
  const [multiEntry, setMultiEntry] = useState({
    class_ids: [],
    back_number: "",
    no_back_number: false,
    horse_name: "",
    exhibitor: "",
    registryChecked: false,
    registryMatched: false,
  });
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [memberAccount, setMemberAccount] = useState(null); // member-portal sign-in: { email, name, renewalOffer }
  const [useDifferentDetails, setUseDifferentDetails] = useState(false);
  const [renewMembership, setRenewMembership] = useState(false);
  const [renewalTypeId, setRenewalTypeId] = useState("");
  const [membershipTypes, setMembershipTypes] = useState([]);
  const [membershipSetting, setMembershipSetting] = useState({ enabled: false, include_clinics: false });
  const [membershipStatus, setMembershipStatus] = useState(null); // null | "member" | "none" | "unknown"
  const [dayMembership, setDayMembership] = useState(false);
  const [replacementNumbers, setReplacementNumbers] = useState(false);
  const [feesDue, setFeesDue] = useState(null); // null = unknown (assume due), false = already paid for this event
  const [rulesAccepted, setRulesAccepted] = useState(false);
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
          .select("*")
          .eq("event_id", eventId)
          .eq("status", "upcoming")
          .order("sort_order"),
      ]);
      setEvent(ev);
      setClasses(cls ?? []);
      // Is club membership required to enter? (Coordinator switch; public read.)
      const { data: reqSetting } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "membership_required")
        .maybeSingle();
      if (reqSetting?.value) {
        setMembershipSetting({
          enabled: Boolean(reqSetting.value.enabled),
          include_clinics: Boolean(reqSetting.value.include_clinics),
        });
      }
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

  // Members signed in to the portal don't retype their details — fill them in
  // from the account, and see whether a July renewal can be offered.
  useEffect(() => {
    async function loadAccount() {
      try {
        const res = await fetch("/api/account/me");
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.email) return;
        const best = (data.memberships ?? []).find((m) => m.is_current)
          ?? (data.memberships ?? []).find((m) => m.status !== "rejected");
        setMemberAccount({
          email: data.email,
          name: best?.member_name ?? "",
          renewalOffer: data.renewal_offer ?? null,
        });
        setContactName((prev) => prev || best?.member_name || "");
        setContactEmail((prev) => prev || data.email);
        if (data.renewal_offer) {
          const { data: types } = await supabase
            .from("membership_types")
            .select("*")
            .eq("active", true)
            .order("sort_order");
          setMembershipTypes(types ?? []);
          const previous = data.renewal_offer.previous_type_id;
          setRenewalTypeId((types ?? []).some((t) => t.id === previous) ? previous : "");
        }
      } catch {
        // Not signed in or offline — the form simply works the normal way.
      }
    }
    loadAccount();
  }, []);

  const isClinic = event?.event_type === "clinic";
  const isMultiMode = !isClinic && entryMode === "multi";
  const membershipRequired = membershipSetting.enabled && (!isClinic || membershipSetting.include_clinics);

  // Early membership check on email blur — the server enforces this again at
  // submission; this just saves people filling in a whole form first.
  const checkMembership = async (email) => {
    if (!membershipRequired || !email?.trim() || !email.includes("@")) { setMembershipStatus(null); return; }
    try {
      const params = new URLSearchParams({ email: email.trim(), event_id: eventId });
      const res = await fetch(`/api/memberships/check?${params.toString()}`);
      const data = res.ok ? await res.json() : null;
      setMembershipStatus(data?.member === true ? "member" : data?.member === false ? "none" : "unknown");
    } catch {
      setMembershipStatus("unknown");
    }
  };
  // Signed-in members never blur the email field, so run the membership
  // check for them once both the account and the requirement setting exist.
  useEffect(() => {
    if (memberAccount && membershipRequired && membershipStatus === null) {
      checkMembership(memberAccount.email);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberAccount, membershipRequired]);

  const feePerClass = event?.entry_fee_cents ?? 0;
  // One-off ground/admin fees (schema-v34) — charged once per person per
  // event. Shown as due until the server confirms this email already paid
  // them; the server re-checks at submission either way.
  const groundFee = event?.ground_fee_cents ?? 0;
  const adminFee = event?.admin_fee_cents ?? 0;
  const oneOffFees = groundFee + adminFee;
  const chargeFees = oneOffFees > 0 && feesDue !== false;

  const checkFees = async (email) => {
    if (oneOffFees === 0 || !email?.trim() || !email.includes("@")) { setFeesDue(null); return; }
    try {
      const params = new URLSearchParams({ event_id: eventId, email: email.trim() });
      const res = await fetch(`/api/registrations/fees-status?${params.toString()}`);
      const data = res.ok ? await res.json() : null;
      setFeesDue(data?.fees_due === false ? false : data?.fees_due === true ? true : null);
    } catch {
      setFeesDue(null);
    }
  };
  // Signed-in members never blur the email field, so check their fees once
  // the account and the event's fee amounts are both known.
  useEffect(() => {
    if (memberAccount?.email && oneOffFees > 0 && feesDue === null) {
      checkFees(memberAccount.email);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberAccount, oneOffFees]);

  const multiEntries = multiEntry.class_ids.map((classId) => ({
    _id: `multi-${classId}`,
    class_id: classId,
    back_number: multiEntry.back_number,
    no_back_number: multiEntry.no_back_number,
    horse_name: multiEntry.horse_name,
    exhibitor: multiEntry.exhibitor,
  }));
  const submissionEntries = isMultiMode ? multiEntries : entries;
  const filledEntries = submissionEntries.filter((e) => e.class_id);
  // July renewal offer for the signed-in member. When the renewal's season
  // covers the season this event falls in, it counts as the annual
  // membership — no day membership needed (the server applies the same rule).
  const renewalOffer = memberAccount?.renewalOffer ?? null;
  const renewalType = renewMembership && renewalOffer
    ? membershipTypes.find((t) => t.id === renewalTypeId)
    : null;
  const renewalCents = renewalType?.fee_cents ?? 0;
  const renewalCoversEvent = Boolean(renewalType) && Boolean(renewalOffer) &&
    activeSeasons(event?.starts_on ? new Date(event.starts_on) : new Date()).includes(renewalOffer.season);
  const needsDayMembership = membershipRequired && membershipStatus !== "member" && !renewalCoversEvent;
  const dayMembershipSelected = needsDayMembership && dayMembership;
  const totalCents = filledEntries.length * feePerClass
    + (dayMembershipSelected ? DAY_MEMBERSHIP_CENTS : 0)
    + (replacementNumbers ? REPLACEMENT_NUMBERS_CENTS : 0)
    + (chargeFees ? oneOffFees : 0)
    + renewalCents;

  useEffect(() => {
    if (membershipStatus === "member") setDayMembership(false);
  }, [membershipStatus]);

  const classIsFull = (cls) => cls.capacity != null && (spotsTaken[cls.id] ?? 0) >= cls.capacity;
  const spotsLabel = (cls) => {
    if (cls.capacity == null) return null;
    const remaining = cls.capacity - (spotsTaken[cls.id] ?? 0);
    if (remaining <= 0) return "Full";
    return `${remaining} spot${remaining === 1 ? "" : "s"} remaining`;
  };
  const availableClasses = classes.filter((c) => !classIsFull(c));
  const allFull = classes.length > 0 && availableClasses.length === 0;
  const classLabel = (classId) => {
    const cls = classes.find((c) => c.id === classId);
    if (!cls) return "this class";
    return basicClassLabel(cls, isClinic);
  };
  // Back number is the horse's permanent registry identity, so it's what
  // identifies "the same horse" for duplicate checks — not the free-typed
  // name, which two unrelated horses could share.
  const duplicateMessage = (entry, candidates = confirmedEntries) => {
    if (isClinic || !entry.class_id) return "";
    const backNumber = entry.back_number ? parseInt(entry.back_number, 10) : null;
    if (!backNumber) return "";
    const match = candidates.find((existing) =>
      existing.class_id === entry.class_id && existing.back_number === backNumber
    );
    if (!match) return "";
    return `Back #${backNumber} (${entry.horse_name || "this horse"}) is already entered in ${classLabel(entry.class_id)}.`;
  };
  const duplicateInFormMessage = (validEntries) => {
    if (isClinic) return "";
    const seenBackNumbers = new Map();
    const seenNewHorses = new Map();
    for (const entry of validEntries) {
      const backKey = entry.back_number ? `${entry.class_id}:${entry.back_number}` : "";
      if (backKey && seenBackNumbers.has(backKey)) {
        return `Back #${entry.back_number} (${entry.horse_name}) is entered twice for ${classLabel(entry.class_id)}. Please remove the duplicate entry.`;
      }
      if (backKey) seenBackNumbers.set(backKey, true);
      // New horses have no number yet, so duplicates are caught by name.
      const nameKey = !entry.back_number && entry.no_back_number
        ? `${entry.class_id}:${entry.horse_name.trim().replace(/\s+/g, " ").toLowerCase()}`
        : "";
      if (nameKey && seenNewHorses.has(nameKey)) {
        return `${entry.horse_name} is entered twice for ${classLabel(entry.class_id)}. Please remove the duplicate entry.`;
      }
      if (nameKey) seenNewHorses.set(nameKey, true);
    }
    return "";
  };

  const updateEntry = (id, field, value) =>
    setEntries((prev) => prev.map((e) => {
      if (e._id !== id) return e;
      // Back number changed — the previous registry match (if any) no longer applies
      // until the field is re-checked on blur.
      if (field === "back_number") return { ...e, back_number: value, registryChecked: false, registryMatched: false };
      // "New horse" ticked — the back number is assigned at payment instead.
      if (field === "no_back_number") return { ...e, no_back_number: value, back_number: "", registryChecked: false, registryMatched: false };
      return { ...e, [field]: value };
    }));

  const updateMultiEntry = (field, value) =>
    setMultiEntry((prev) => {
      if (field === "back_number") {
        return { ...prev, back_number: value, registryChecked: false, registryMatched: false };
      }
      if (field === "no_back_number") {
        return { ...prev, no_back_number: value, back_number: "", registryChecked: false, registryMatched: false };
      }
      return { ...prev, [field]: value };
    });

  const toggleMultiClass = (classId) => {
    const cls = classes.find((c) => c.id === classId);
    const alreadySelected = multiEntry.class_ids.includes(classId);
    if (!alreadySelected && cls && classIsFull(cls)) return;
    setMultiEntry((prev) => ({
      ...prev,
      class_ids: alreadySelected
        ? prev.class_ids.filter((id) => id !== classId)
        : [...prev.class_ids, classId],
    }));
  };

  // Back number is the horse's permanent registry identity, so once it resolves
  // to a registered horse, the horse name is locked to whatever's on file —
  // it can't be typed differently. Unregistered back numbers (new horses not
  // yet added to the registry) leave the name field open for manual entry.
  const lookupHorse = async (entryId, backNum) => {
    if (!backNum) return;
    const { data } = await supabase
      .from("horses")
      .select("name, owner")
      .eq("back_number", parseInt(backNum, 10))
      .maybeSingle();
    setEntries((prev) =>
      prev.map((e) =>
        e._id === entryId
          ? {
              ...e,
              horse_name: data ? data.name : e.horse_name,
              exhibitor: e.exhibitor || (data?.owner ?? ""),
              registryChecked: true,
              registryMatched: !!data,
            }
          : e
      )
    );
  };

  const lookupMultiHorse = async (backNum) => {
    if (!backNum) return;
    const { data } = await supabase
      .from("horses")
      .select("name, owner")
      .eq("back_number", parseInt(backNum, 10))
      .maybeSingle();
    setMultiEntry((prev) => ({
      ...prev,
      horse_name: data ? data.name : prev.horse_name,
      exhibitor: prev.exhibitor || (data?.owner ?? ""),
      registryChecked: true,
      registryMatched: !!data,
    }));
  };

  const removeEntry = (id) =>
    setEntries((prev) => (prev.length > 1 ? prev.filter((e) => e._id !== id) : prev));

  const submit = async () => {
    setError("");
    if (!contactName.trim()) { setError("Please enter your full name."); return; }
    if (!contactEmail.trim() || !contactEmail.includes("@")) { setError("Please enter a valid email address."); return; }
    const hasNumber = (e) => e.back_number || e.no_back_number;
    const valid = isClinic
      ? submissionEntries.filter((e) => e.class_id && e.exhibitor.trim())
      : submissionEntries.filter((e) => e.class_id && hasNumber(e) && e.horse_name.trim() && e.exhibitor.trim());
    if (!valid.length) {
      setError(isClinic
        ? "Please select a spot type and enter your name."
        : isMultiMode
          ? "Please enter the horse details and select at least one class."
          : "Please complete at least one entry — class, back number (or tick “no back number yet”), horse name, and exhibitor are all required.");
      return;
    }
    const incomplete = isClinic
      ? submissionEntries.filter((e) => e.class_id && !e.exhibitor.trim())
      : submissionEntries.filter((e) => e.class_id && (!hasNumber(e) || !e.horse_name.trim() || !e.exhibitor.trim()));
    if (incomplete.length) {
      setError(isClinic
        ? "Please enter your name for each spot selected."
        : "Some entries are missing details. Please fill in back number (or tick “no back number yet”), horse name, and exhibitor for each class selected.");
      return;
    }
    const duplicateInForm = duplicateInFormMessage(valid);
    if (duplicateInForm) { setError(duplicateInForm); return; }
    const existingDuplicate = valid.map((entry) => duplicateMessage(entry)).find(Boolean);
    if (existingDuplicate) { setError(`${existingDuplicate} Please check your details or contact the show secretary.`); return; }
    if (renewMembership && renewalOffer && !renewalType) {
      setError("Please choose a membership type for your renewal (or untick the renewal option).");
      return;
    }
    if (membershipRequired && membershipStatus === "none" && !dayMembership && !renewalCoversEvent) {
      setError("Choose the $20 day membership for this event, or use the email address on a current annual membership.");
      return;
    }
    if (!rulesAccepted) {
      setError("Please confirm you have read and agree to the entry conditions.");
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
          day_membership: dayMembership,
          replacement_numbers: replacementNumbers,
          membership_renewal: Boolean(renewMembership && renewalOffer),
          membership_renewal_type_id: renewalTypeId || null,
          entries: valid.map((e) => ({
            class_id: e.class_id,
            back_number: isClinic || e.no_back_number ? null : parseInt(e.back_number, 10),
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

  const multiDuplicateWarnings = isMultiMode
    ? multiEntries.map((entry) => duplicateMessage(entry)).filter(Boolean)
    : [];

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

        {membershipRequired && membershipStatus !== "member" && (
          <div className="card" style={{ padding: "12px 14px", borderColor: "#E0B15A", background: "#FFF7D6", marginBottom: 14 }}>
            <p style={{ margin: 0, color: "var(--leather)", fontSize: 13.5, fontWeight: 700 }}>
              Annual membership or day membership required — non-members can add a {fmtMoney(DAY_MEMBERSHIP_CENTS)} day membership for this event at checkout.
            </p>
          </div>
        )}

        {/* ---- Contact info ---- */}
        <section className="card">
          <div className="card-head">
            <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Your details</div>
          </div>
          <div style={{ paddingBottom: 8 }}>
            {memberAccount && !useDifferentDetails && contactName.trim() && contactEmail.trim() ? (
              <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", background: "var(--sand)" }}>
                <div style={{ minWidth: 0 }}>
                  <div className="display" style={{ fontWeight: 700, fontSize: 15 }}>{contactName}</div>
                  <div style={{ fontSize: 12.5, color: "var(--quiet)", overflowWrap: "anywhere" }}>{contactEmail}</div>
                  <div style={{ fontSize: 11.5, color: "var(--quiet)", marginTop: 2 }}>Signed in via the member portal</div>
                </div>
                <button className="btn-ghost" style={{ padding: "6px 10px", fontSize: 12, flexShrink: 0 }}
                  onClick={() => setUseDifferentDetails(true)}>
                  Use different details
                </button>
              </div>
            ) : (
              <>
                <label className="modal-label">Full name *</label>
                <input className="field" style={{ width: "100%", fontSize: 16 }}
                  value={contactName} onChange={(e) => setContactName(e.target.value)}
                  placeholder="e.g. Sarah O'Brien" />
                <label className="modal-label">Email address *</label>
                <input className="field" type="email" style={{ width: "100%", fontSize: 16 }}
                  value={contactEmail}
                  onChange={(e) => { setContactEmail(e.target.value); setMembershipStatus(null); setDayMembership(false); setFeesDue(null); }}
                  onBlur={(e) => { checkMembership(e.target.value); checkFees(e.target.value); }}
                  placeholder="e.g. sarah@example.com" />
              </>
            )}
            {membershipRequired && membershipStatus === "member" && (
              <p style={{ fontSize: 12.5, color: "#2D7A52", fontWeight: 700, margin: "6px 0 0" }}>
                ✓ Annual club membership found for this event season.
              </p>
            )}
            {membershipRequired && membershipStatus === "none" && !renewalCoversEvent && (
              <p style={{ fontSize: 12.5, color: "var(--clay)", fontWeight: 600, margin: "6px 0 0" }}>
                No annual membership found for this event season.
              </p>
            )}
            {membershipRequired && membershipStatus === "none" && renewalCoversEvent && (
              <p style={{ fontSize: 12.5, color: "#2D7A52", fontWeight: 700, margin: "6px 0 0" }}>
                ✓ Your membership renewal below covers this event season.
              </p>
            )}
            {needsDayMembership && (
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", marginTop: 10, background: dayMembership ? "#FFF7D6" : "#fff", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={dayMembership}
                  onChange={(e) => setDayMembership(e.target.checked)}
                  style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
                />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 800, color: "var(--leather)" }}>
                    Add day membership · {fmtMoney(DAY_MEMBERSHIP_CENTS)}
                  </span>
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--quiet)", marginTop: 2 }}>
                    Covers this event only. For annual membership instead, <Link href="/membership" style={{ color: "var(--brass)", fontWeight: 700 }}>join online</Link>.
                  </span>
                </span>
              </label>
            )}
            <p style={{ fontSize: 12, color: "var(--quiet)", margin: "6px 0 0" }}>
              {feePerClass > 0
                ? "Square will send your payment receipt to this address. We will also email your booking confirmation here."
                : "We will email your booking confirmation here."}
            </p>
          </div>
        </section>

        {!isClinic && (
          <section className="card">
            <div className="card-head">
              <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Entry mode</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, paddingBottom: 8 }}>
              {[
                ["single", "One by one"],
                ["multi", "Same horse, multiple classes"],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => { setEntryMode(mode); setError(""); }}
                  style={{
                    minHeight: 44,
                    borderRadius: 10,
                    border: `2px solid ${entryMode === mode ? "var(--leather)" : "var(--line)"}`,
                    background: entryMode === mode ? "var(--sand)" : "#fff",
                    color: entryMode === mode ? "var(--leather)" : "var(--quiet)",
                    fontWeight: 800,
                    fontSize: 14,
                    padding: "9px 10px",
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ---- Spot / class entries ---- */}
        {isMultiMode ? (
          <section className="card">
            <div className="card-head">
              <div className="display" style={{ fontWeight: 600, fontSize: 16 }}>Same horse, multiple classes</div>
              <span style={{ color: "var(--quiet)", fontSize: 12.5, fontWeight: 700 }}>
                {multiEntry.class_ids.length} selected
              </span>
            </div>
            <div style={{ paddingBottom: 8 }}>
              <label className="modal-label">Back number *</label>
              <input className="field" type="number" style={{ width: "100%", fontSize: 16, ...(multiEntry.no_back_number ? { background: "var(--sand)", color: "var(--quiet)" } : {}) }}
                value={multiEntry.back_number}
                disabled={multiEntry.no_back_number}
                onChange={(e) => updateMultiEntry("back_number", e.target.value)}
                onBlur={(e) => lookupMultiHorse(e.target.value)}
                placeholder={multiEntry.no_back_number ? "Assigned once payment is confirmed" : "e.g. 301"} />
              {!multiEntry.no_back_number && multiEntry.registryChecked && !multiEntry.registryMatched && (
                <p style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 4 }}>
                  No horse found with this back number in our registry — double-check the number, or tick the box below if this is a new horse.
                </p>
              )}
              <NewHorseToggle
                checked={multiEntry.no_back_number}
                onChange={(v) => updateMultiEntry("no_back_number", v)}
              />

              <label className="modal-label">Horse name *</label>
              <input className="field" style={{ width: "100%", fontSize: 16, ...(multiEntry.registryMatched ? { background: "var(--sand)", color: "var(--quiet)" } : {}) }}
                value={multiEntry.horse_name}
                readOnly={multiEntry.registryMatched}
                onChange={(e) => updateMultiEntry("horse_name", e.target.value)}
                placeholder="e.g. Machine Made Lady" />
              {multiEntry.registryMatched && (
                <p style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 4 }}>
                  Matched from the horse registry for back #{multiEntry.back_number}. Contact the show secretary if this is wrong.
                </p>
              )}

              <label className="modal-label">Exhibitor name *</label>
              <input className="field" style={{ width: "100%", fontSize: 16 }}
                value={multiEntry.exhibitor}
                onChange={(e) => updateMultiEntry("exhibitor", e.target.value)}
                placeholder="e.g. S. O'Brien" />

              <label className="modal-label">Classes *</label>
              <MultiClassPicker
                selectedIds={multiEntry.class_ids}
                classes={classes}
                onToggle={toggleMultiClass}
                classIsFull={classIsFull}
                spotsLabel={spotsLabel}
              />

              {classes.length === 0 && (
                <p style={{ fontSize: 12.5, color: "var(--clay)", marginTop: 4 }}>
                  No upcoming classes have been added yet. Check back soon.
                </p>
              )}

              {multiDuplicateWarnings.length > 0 && (
                <p style={{ fontSize: 12.5, color: "var(--clay)", marginTop: 8, fontWeight: 600 }}>
                  {multiDuplicateWarnings[0]} Please check your details before submitting.
                </p>
              )}
            </div>
          </section>
        ) : entries.map((entry, idx) => {
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
                <ClassSearchSelect
                  value={entry.class_id}
                  classes={classes}
                  isClinic={isClinic}
                  onChange={(classId) => updateEntry(entry._id, "class_id", classId)}
                  classIsFull={classIsFull}
                  spotsLabel={spotsLabel}
                />

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
                    <input className="field" type="number" style={{ width: "100%", fontSize: 16, ...(entry.no_back_number ? { background: "var(--sand)", color: "var(--quiet)" } : {}) }}
                      value={entry.back_number}
                      disabled={entry.no_back_number}
                      onChange={(e) => updateEntry(entry._id, "back_number", e.target.value)}
                      onBlur={(e) => lookupHorse(entry._id, e.target.value)}
                      placeholder={entry.no_back_number ? "Assigned once payment is confirmed" : "e.g. 301"} />
                    {!entry.no_back_number && entry.registryChecked && !entry.registryMatched && (
                      <p style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 4 }}>
                        No horse found with this back number in our registry — double-check the number, or tick the box below if this is a new horse.
                      </p>
                    )}
                    <NewHorseToggle
                      checked={entry.no_back_number}
                      onChange={(v) => updateEntry(entry._id, "no_back_number", v)}
                    />
                  </>
                )}

                <label className="modal-label">{isClinic ? "Horse name (if participating)" : "Horse name *"}</label>
                <input className="field" style={{ width: "100%", fontSize: 16, ...(entry.registryMatched ? { background: "var(--sand)", color: "var(--quiet)" } : {}) }}
                  value={entry.horse_name}
                  readOnly={entry.registryMatched}
                  onChange={(e) => updateEntry(entry._id, "horse_name", e.target.value)}
                  placeholder={isClinic ? "e.g. Machine Made Lady (optional)" : "e.g. Machine Made Lady"} />
                {entry.registryMatched && (
                  <p style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 4 }}>
                    Matched from the horse registry for back #{entry.back_number}. Contact the show secretary if this is wrong.
                  </p>
                )}

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

        {!isMultiMode && (
          <button className="btn-ghost" style={{ width: "100%", marginBottom: 16, fontSize: 15 }}
            onClick={() => setEntries((p) => [...p, blankEntry()])}>
            + Add another {isClinic ? "spot" : "class entry"}
          </button>
        )}

        {/* ---- Total + pay ---- */}
        <section className="card" style={{ background: "var(--sand)" }}>
          <div style={{ padding: "4px 0 8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {filledEntries.length} {isClinic ? (filledEntries.length === 1 ? "spot" : "spots") : (filledEntries.length === 1 ? "class" : "classes")} × {fmtMoney(feePerClass)}
                </div>
                {dayMembershipSelected && (
                  <div style={{ fontSize: 13, color: "var(--leather)", fontWeight: 700, marginTop: 3 }}>
                    Day membership × {fmtMoney(DAY_MEMBERSHIP_CENTS)}
                  </div>
                )}
                {renewalType && (
                  <div style={{ fontSize: 13, color: "var(--leather)", fontWeight: 700, marginTop: 3 }}>
                    {shortSeason(renewalOffer.season)} membership renewal ({renewalType.name}) × {fmtMoney(renewalCents)}
                  </div>
                )}
                {replacementNumbers && (
                  <div style={{ fontSize: 13, color: "var(--leather)", fontWeight: 700, marginTop: 3 }}>
                    Replacement numbers × {fmtMoney(REPLACEMENT_NUMBERS_CENTS)}
                  </div>
                )}
                {chargeFees && groundFee > 0 && (
                  <div style={{ fontSize: 13, color: "var(--leather)", fontWeight: 700, marginTop: 3 }}>
                    Ground fee {fmtMoney(groundFee)} <span style={{ color: "var(--quiet)", fontWeight: 400 }}>(once per event)</span>
                  </div>
                )}
                {chargeFees && adminFee > 0 && (
                  <div style={{ fontSize: 13, color: "var(--leather)", fontWeight: 700, marginTop: 3 }}>
                    Admin fee {fmtMoney(adminFee)} <span style={{ color: "var(--quiet)", fontWeight: 400 }}>(once per event)</span>
                  </div>
                )}
                {oneOffFees > 0 && feesDue === false && (
                  <div style={{ fontSize: 12.5, color: "#2D7A52", fontWeight: 700, marginTop: 3 }}>
                    ✓ Ground/admin fees already paid with your earlier entries — not charged again.
                  </div>
                )}
                {totalCents > 0 && (
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
            {renewalOffer && (
              <div style={{ border: "1px solid #E0B15A", borderRadius: 10, padding: "10px 12px", marginBottom: 10, background: renewMembership ? "#FFF7D6" : "#fff" }}>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={renewMembership}
                    onChange={(e) => setRenewMembership(e.target.checked)}
                    style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 800, color: "var(--leather)" }}>
                      Renew your club membership for the {shortSeason(renewalOffer.season)} season
                    </span>
                    <span style={{ display: "block", fontSize: 12.5, color: "var(--quiet)", marginTop: 2 }}>
                      Your current membership ends 31 July. Add next season&apos;s renewal to this payment — the committee confirms it as usual.
                    </span>
                  </span>
                </label>
                {renewMembership && (
                  <select
                    className="field"
                    style={{ width: "100%", fontSize: 15, marginTop: 8 }}
                    value={renewalTypeId}
                    onChange={(e) => setRenewalTypeId(e.target.value)}>
                    <option value="">Choose membership type…</option>
                    {membershipTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} — {fmtMoney(t.fee_cents ?? 0)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            <label style={{ display: "flex", alignItems: "flex-start", gap: 9, marginBottom: 10, color: "var(--leather)", fontSize: 13, fontWeight: 700 }}>
              <input type="checkbox" checked={replacementNumbers} onChange={(e) => setReplacementNumbers(e.target.checked)}
                style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0 }} />
              <span>
                I need replacement numbers for this event ({fmtMoney(REPLACEMENT_NUMBERS_CENTS)}).
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 9, marginBottom: 10, color: "var(--leather)", fontSize: 13, fontWeight: 700 }}>
              <input type="checkbox" checked={rulesAccepted} onChange={(e) => setRulesAccepted(e.target.checked)}
                style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0 }} />
              <span>I have read and agree to the entry conditions.</span>
            </label>
            <button className="btn" style={{ width: "100%", fontSize: 17, padding: 14, background: "var(--leather)" }}
              onClick={submit} disabled={submitting}>
              {submitting
                ? "Setting up payment…"
                : totalCents > 0
                ? `Register & Pay ${fmtMoney(totalCents)}`
                : isClinic ? "Register" : "Submit entries"}
            </button>
            <p style={{ fontSize: 11.5, color: "var(--quiet)", lineHeight: 1.45, margin: "10px 0 0" }}>
              {isClinic
                ? "By registering, you participate at your own risk and agree to follow organiser and official directions. Fees are payable before participation unless otherwise arranged."
                : "By submitting entries, you agree to HCQHA rules: horses must be eligible for their entered classes, competitors participate at their own risk and follow official directions, the show manager may alter the program or order of classes, refunds require a vet certificate, unpaid entries may be refused, and results may be withheld until payment is received."}
            </p>
          </div>
        </section>

        <p style={{ textAlign: "center", marginTop: 10 }}>
          <Link href={`/event/${eventId}`} style={{ color: "var(--brass)", fontSize: 13 }}>← Back to event</Link>
        </p>
      </main>
    </>
  );
}
