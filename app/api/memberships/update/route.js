import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminClient } from "../../_lib/registrations";

// Staff-only: edit a member's core details and the people on their membership
// (each person can have their own email). Service-role so it works on the
// staff-read-only member tables.
async function verifyStaff(req) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const authCheck = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const { data, error } = await authCheck.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

const clean = (v) => String(v ?? "").trim();
const cleanOrNull = (v) => clean(v) || null;
const cleanEmail = (v) => clean(v).toLowerCase() || null;
// A list of { club, number } association memberships; null when empty.
function cleanRegs(list) {
  if (!Array.isArray(list)) return undefined; // not provided → don't touch
  const rows = list
    .map((r) => ({ club: clean(r?.club), number: clean(r?.number) }))
    .filter((r) => r.club || r.number);
  return rows.length ? rows : null;
}

// How many people the membership covers including the applicant; null =
// unknown, which callers must treat as UNLIMITED — never as 1, or a save
// would silently discard the family list.
async function includedPeople(db, member) {
  if (member.included_people != null) return member.included_people;
  if (!member.membership_type_id) return null;
  const { data: type } = await db
    .from("membership_types")
    .select("included_people")
    .eq("id", member.membership_type_id)
    .maybeSingle();
  return type?.included_people ?? null;
}

export async function POST(req) {
  try {
    const staff = await verifyStaff(req);
    if (!staff) return NextResponse.json({ error: "Staff sign-in required" }, { status: 401 });

    const { member_id, fields, people } = await req.json();
    if (!member_id) return NextResponse.json({ error: "member_id required" }, { status: 400 });

    const db = adminClient();
    const { data: member, error: mErr } = await db
      .from("club_members")
      .select("*")
      .eq("id", member_id)
      .maybeSingle();
    if (mErr) throw new Error(mErr.message);
    if (!member) return NextResponse.json({ error: "Membership not found" }, { status: 404 });

    const name = clean(fields?.member_name);
    const email = clean(fields?.email);
    if (!name) return NextResponse.json({ error: "Member name is required." }, { status: 400 });
    if (!email || !email.includes("@")) return NextResponse.json({ error: "A valid email is required." }, { status: 400 });

    const update = {
      member_name: name,
      email: email.toLowerCase(),
      phone: cleanOrNull(fields?.phone),
      address: cleanOrNull(fields?.address),
      aqha_member_number: cleanOrNull(fields?.aqha_member_number),
      other_memberships: cleanOrNull(fields?.other_memberships),
      emergency_contact_name: cleanOrNull(fields?.emergency_contact_name),
      emergency_contact_phone: cleanOrNull(fields?.emergency_contact_phone),
      interests: cleanOrNull(fields?.interests),
    };
    const memberRegs = cleanRegs(fields?.association_registrations);
    if (memberRegs !== undefined) update.association_registrations = memberRegs;

    // Change of membership type (e.g. upgrading Single → Family after the
    // fact). Updates the type snapshot and the people allowance; the money
    // fields are never touched — staff collect any fee difference like a
    // manual payment.
    let newCovered = null;
    if (fields?.membership_type_id && fields.membership_type_id !== member.membership_type_id) {
      const { data: type, error: tErr } = await db
        .from("membership_types")
        .select("*")
        .eq("id", fields.membership_type_id)
        .maybeSingle();
      if (tErr) throw new Error(tErr.message);
      if (!type) return NextResponse.json({ error: "That membership type no longer exists — refresh and try again." }, { status: 400 });
      update.membership_type_id = type.id;
      update.membership_type_name = type.name;
      if (type.included_people != null) {
        update.included_people = type.included_people;
        newCovered = type.included_people;
      }
    }

    let { error: upErr } = await db.from("club_members").update(update).eq("id", member_id);
    if (upErr && /association_registrations|included_people/i.test(`${upErr.message ?? ""} ${upErr.details ?? ""}`)) {
      // schema-v42 (association_registrations) or v25 (included_people) not run yet
      const { association_registrations: _r, included_people: _i, ...bare } = update;
      ({ error: upErr } = await db.from("club_members").update(bare).eq("id", member_id));
    }
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    // Replace the people list when provided (the whole family is re-sent).
    if (Array.isArray(people)) {
      const covered = newCovered ?? await includedPeople(db, member);
      const rows = people
        .map((p, idx) => ({
          member_id,
          name: clean(p?.name),
          person_type: p?.person_type === "child" ? "child" : "adult",
          email: cleanEmail(p?.email),
          aqha_member_number: cleanOrNull(p?.aqha_member_number),
          phone: cleanOrNull(p?.phone),
          other_memberships: cleanOrNull(p?.other_memberships),
          association_registrations: cleanRegs(p?.association_registrations) ?? null,
          sort_order: idx + 1,
        }))
        .filter((p) => p.name);
      // Never silently drop people: if the type doesn't cover them all,
      // refuse with a clear message (covered == null means no known cap).
      if (covered != null && rows.length > Math.max(0, covered - 1)) {
        return NextResponse.json(
          { error: `This membership covers ${covered} ${covered === 1 ? "person" : "people"} including ${member.member_name}, but ${rows.length + 1} are listed. Remove ${rows.length - Math.max(0, covered - 1)} or pick a bigger membership type.` },
          { status: 400 }
        );
      }

      await db.from("club_member_people").delete().eq("member_id", member_id);
      if (rows.length) {
        let { error: pErr } = await db.from("club_member_people").insert(rows);
        if (pErr && /(email|aqha_member_number|phone|other_memberships|association_registrations)/i.test(`${pErr.message ?? ""} ${pErr.details ?? ""}`)) {
          // schema-v40/v41/v42 not run yet — save people without the extra columns.
          const bare = rows.map(({ email: _e, aqha_member_number: _a, phone: _p, other_memberships: _o, association_registrations: _ar, ...rest }) => rest);
          ({ error: pErr } = await db.from("club_member_people").insert(bare));
        }
        if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("memberships/update error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
