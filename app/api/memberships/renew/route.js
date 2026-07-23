import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminClient } from "../../_lib/registrations";
import { currentSeason, signupSeason, seasonLabel } from "../../../../lib/membershipSeason";
import { escapeIlike } from "../../_lib/memberAuth";

// Staff-only: carry an existing member over to the next season without them
// re-registering. Copies their details, the people on the membership, and
// their horses (keeping their permanent back numbers) into a fresh, already
// approved application for signupSeason(). Mirrors "Add member manually" —
// no Square payment, no email; staff are recording a renewal they've taken.
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

// Carry one source member into `season`. Returns { created } on success, or
// { skipped, reason } when it's the same season or a live membership already
// exists for that email+season. Throws only on a hard database failure.
async function renewOne(db, src, season) {
  if (src.season === season) return { skipped: true, reason: "same_season" };

  const { data: dup } = await db
    .from("club_members")
    .select("id")
    .eq("season", season)
    .neq("status", "rejected")
    .ilike("email", escapeIlike(String(src.email ?? "").trim()))
    .limit(1);
  if (dup?.length) return { skipped: true, reason: "exists" };

  // Fresh pricing from the current type (fall back to the snapshot on the row).
  let feeCents = src.total_cents ?? 0;
  let includedPeople = src.included_people ?? null;
  if (src.membership_type_id) {
    const { data: type } = await db
      .from("membership_types")
      .select("fee_cents, included_people")
      .eq("id", src.membership_type_id)
      .maybeSingle();
    if (type) {
      feeCents = type.fee_cents ?? feeCents;
      if (type.included_people != null) includedPeople = type.included_people;
    }
  }

  const newRow = {
    season,
    membership_type_id: src.membership_type_id,
    membership_type_name: src.membership_type_name,
    member_name: src.member_name,
    email: src.email,
    phone: src.phone,
    address: src.address,
    aqha_member_number: src.aqha_member_number,
    other_memberships: src.other_memberships,
    emergency_contact_name: src.emergency_contact_name,
    emergency_contact_phone: src.emergency_contact_phone,
    interests: src.interests,
    total_cents: feeCents,
    status: "approved",
    approved_at: new Date().toISOString(),
    ...(includedPeople != null ? { included_people: includedPeople } : {}),
  };

  const { data: member, error: insErr } = await db
    .from("club_members")
    .insert(newRow)
    .select()
    .single();
  if (insErr) throw new Error(insErr.message);

  const { data: people } = await db
    .from("club_member_people")
    .select("name, person_type, sort_order")
    .eq("member_id", src.id);
  if (people?.length) {
    await db.from("club_member_people").insert(
      people.map((p) => ({ member_id: member.id, name: p.name, person_type: p.person_type, sort_order: p.sort_order }))
    );
  }

  const { data: horses } = await db
    .from("club_member_horses")
    .select("horse_name, back_number, breed, registrations, notes")
    .eq("member_id", src.id);
  if (horses?.length) {
    const rows = horses.map((h) => ({
      member_id: member.id,
      horse_name: h.horse_name,
      back_number: h.back_number,
      breed: h.breed,
      registrations: h.registrations,
      notes: h.notes,
      number_fee_cents: 0,
      number_fee_paid: true,
    }));
    let { error: hErr } = await db.from("club_member_horses").insert(rows);
    if (hErr && /number_fee/i.test(`${hErr.message ?? ""} ${hErr.details ?? ""}`)) {
      const bare = rows.map(({ number_fee_cents, number_fee_paid, ...rest }) => rest);
      ({ error: hErr } = await db.from("club_member_horses").insert(bare));
    }
    if (hErr) console.error("Renewal horse copy failed:", hErr.message);
  }

  return { created: member.id };
}

export async function POST(req) {
  try {
    const staff = await verifyStaff(req);
    if (!staff) return NextResponse.json({ error: "Staff sign-in required" }, { status: 401 });

    const { member_id, source_season, season: requestedSeason } = await req.json();

    const db = adminClient();
    // Renew into the current season or the coming one (they only differ during
    // July). Anything else is rejected; default to the coming season.
    const allowedSeasons = [currentSeason(), signupSeason()];
    const season = allowedSeasons.includes(requestedSeason) ? requestedSeason : signupSeason();

    // Bulk: carry every approved member of a source season into the target.
    if (!member_id && source_season) {
      const { data: sources, error: listErr } = await db
        .from("club_members")
        .select("*")
        .eq("season", source_season)
        .eq("status", "approved");
      if (listErr) throw new Error(listErr.message);

      let created = 0, skipped = 0;
      for (const src of sources ?? []) {
        const result = await renewOne(db, src, season);
        if (result.created) created += 1; else skipped += 1;
      }
      return NextResponse.json({ ok: true, bulk: true, created, skipped, total: sources?.length ?? 0, season });
    }

    if (!member_id) return NextResponse.json({ error: "member_id or source_season required" }, { status: 400 });

    const { data: src, error: srcErr } = await db
      .from("club_members")
      .select("*")
      .eq("id", member_id)
      .maybeSingle();
    if (srcErr) throw new Error(srcErr.message);
    if (!src) return NextResponse.json({ error: "Membership not found" }, { status: 404 });

    const result = await renewOne(db, src, season);
    if (result.skipped) {
      const msg = result.reason === "same_season"
        ? `This membership is already for the ${seasonLabel(season)}.`
        : `${src.member_name} already has a ${seasonLabel(season)} membership on file.`;
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ ok: true, member_id: result.created, season });
  } catch (err) {
    console.error("memberships/renew error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
