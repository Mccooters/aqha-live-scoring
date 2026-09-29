import { escapeIlike } from "./memberAuth";

// HCQHA membership numbers (schema-v54): one permanent number per PERSON.
// Issued once, reused across seasons — the applicant's by email, a family
// member's by name within the same email's memberships. Never throws for a
// missing column (pre-v54): returns { skipped: "migration" } instead so
// approvals and renewals keep working.

const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const missingColumn = (err) => /hcqha_number|schema cache/i.test(err?.message ?? "");

// Highest number issued anywhere (applicants + people).
async function highestNumber(db) {
  const [a, b] = await Promise.all([
    db.from("club_members").select("hcqha_number").not("hcqha_number", "is", null).order("hcqha_number", { ascending: false }).limit(1),
    db.from("club_member_people").select("hcqha_number").not("hcqha_number", "is", null).order("hcqha_number", { ascending: false }).limit(1),
  ]);
  if (a.error && missingColumn(a.error)) throw Object.assign(new Error("migration"), { code: "MIGRATION" });
  if (b.error && missingColumn(b.error)) throw Object.assign(new Error("migration"), { code: "MIGRATION" });
  return Math.max(a.data?.[0]?.hcqha_number ?? 0, b.data?.[0]?.hcqha_number ?? 0);
}

// Give the applicant and every person on ONE membership a number if they
// don't have one yet. `start` = first number to use when none exist yet.
export async function assignHcqhaNumbers(db, memberId, { start = 1 } = {}) {
  try {
    const { data: member, error: mErr } = await db
      .from("club_members").select("id, email, member_name, hcqha_number").eq("id", memberId).maybeSingle();
    if (mErr) { if (missingColumn(mErr)) return { skipped: "migration" }; throw new Error(mErr.message); }
    if (!member) return { skipped: "not-found" };
    const { data: people, error: pErr } = await db
      .from("club_member_people").select("id, name, hcqha_number").eq("member_id", memberId).order("sort_order");
    if (pErr) { if (missingColumn(pErr)) return { skipped: "migration" }; throw new Error(pErr.message); }

    const needMember = member.hcqha_number == null;
    const needPeople = (people ?? []).filter((p) => p.hcqha_number == null && String(p.name ?? "").trim());
    if (!needMember && !needPeople.length) return { assigned: 0 };

    // Earlier memberships under the same email carry the numbers to reuse.
    let reuseMember = null;
    const reusePeople = {}; // normalised name → number
    if (member.email) {
      const { data: prev } = await db
        .from("club_members")
        .select("id, hcqha_number, created_at")
        .ilike("email", escapeIlike(member.email))
        .neq("id", memberId)
        .order("created_at", { ascending: false });
      const prevIds = (prev ?? []).map((r) => r.id);
      reuseMember = (prev ?? []).find((r) => r.hcqha_number != null)?.hcqha_number ?? null;
      if (prevIds.length) {
        const { data: prevPeople } = await db
          .from("club_member_people").select("name, hcqha_number").in("member_id", prevIds).not("hcqha_number", "is", null);
        (prevPeople ?? []).forEach((p) => { const k = norm(p.name); if (k && reusePeople[k] == null) reusePeople[k] = p.hcqha_number; });
      }
      // The applicant may have been listed as a family member before (or
      // vice-versa) — match by name too.
      if (reuseMember == null && reusePeople[norm(member.member_name)] != null) reuseMember = reusePeople[norm(member.member_name)];
    }

    let next = Math.max(await highestNumber(db), (Number(start) || 1) - 1);
    const used = new Set();
    let assigned = 0;
    if (needMember) {
      const n = reuseMember != null && !used.has(reuseMember) ? reuseMember : ++next;
      used.add(n);
      const { error } = await db.from("club_members").update({ hcqha_number: n }).eq("id", memberId);
      if (error) throw new Error(error.message);
      assigned += 1;
    } else {
      used.add(member.hcqha_number);
    }
    (people ?? []).forEach((p) => { if (p.hcqha_number != null) used.add(p.hcqha_number); });
    for (const p of needPeople) {
      const r = reusePeople[norm(p.name)];
      const n = r != null && !used.has(r) ? r : ++next;
      used.add(n);
      const { error } = await db.from("club_member_people").update({ hcqha_number: n }).eq("id", p.id);
      if (error) throw new Error(error.message);
      assigned += 1;
    }
    return { assigned };
  } catch (err) {
    if (err?.code === "MIGRATION") return { skipped: "migration" };
    throw err;
  }
}

// Number everyone on every APPROVED membership that's still unnumbered,
// oldest approval first so long-standing members get the lower numbers.
export async function assignAllHcqhaNumbers(db, { start = 1 } = {}) {
  const { data: members, error } = await db
    .from("club_members").select("id, approved_at, created_at").eq("status", "approved")
    .order("approved_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  let assigned = 0;
  for (const m of members ?? []) {
    const r = await assignHcqhaNumbers(db, m.id, { start });
    if (r.skipped === "migration") return { skipped: "migration", assigned };
    assigned += r.assigned ?? 0;
  }
  return { assigned };
}
