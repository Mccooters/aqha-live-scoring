import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { getMemberAccount, assertOwnsMember, ownedChildRow, escapeIlike, notSignedIn } from "../../_lib/memberAuth";

// A member's horses (the same club_member_horses rows the committee sees on
// their application). Adding here doesn't touch the official registry —
// staff still add horses to the Registry page themselves.

const MAX_HORSES = 20;
const REJECTED_MSG = "This application was not approved — contact the club.";

function cleanHorse(body) {
  return {
    horse_name: String(body?.horse_name ?? "").trim().replace(/\s+/g, " "),
    breed: String(body?.breed ?? "").trim() || null,
    registrations: String(body?.registrations ?? "").trim() || null,
    notes: String(body?.notes ?? "").trim() || null,
  };
}

function normalizeHorseName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function formatRegistryRegistrations(rows) {
  return (rows ?? [])
    .map((row) => [row.club, row.registration_number].filter(Boolean).join(" ").trim())
    .filter(Boolean)
    .join(", ") || null;
}

function registryAccessMessage(error) {
  const haystack = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  if (haystack.includes("permission denied") || haystack.includes("42501")) {
    return "Member horse numbering couldn't access the horse registry. Run the schema-v28 database update.";
  }
  return error?.message ?? "Could not check the horse registry.";
}

async function findRegistryHorse(db, horseName) {
  const normalized = normalizeHorseName(horseName);
  if (!normalized) return null;
  const cleanedName = String(horseName ?? "").trim().replace(/\s+/g, " ");

  const { data, error } = await db
    .from("horses")
    .select("id, back_number, name, horse_registrations(club, registration_number)")
    .ilike("name", escapeIlike(cleanedName))
    .order("back_number")
    .limit(10);
  if (error) throw new Error(registryAccessMessage(error));

  return (data ?? []).find((horse) => normalizeHorseName(horse.name) === normalized) ?? null;
}

async function nextAvailableBackNumber(db, ignoreMemberHorseId = null) {
  const [registryResult, memberResult] = await Promise.all([
    db.from("horses").select("back_number").order("back_number"),
    db.from("club_member_horses").select("id, back_number").not("back_number", "is", null),
  ]);
  if (registryResult.error) throw new Error(registryAccessMessage(registryResult.error));
  if (memberResult.error) throw new Error(memberResult.error.message);

  // Back numbers are permanent, so issue the next number after the highest
  // known one instead of recycling gaps in old registry data.
  let highest = 0;
  (registryResult.data ?? []).forEach((row) => {
    if (Number.isInteger(row.back_number) && row.back_number > highest) highest = row.back_number;
  });
  (memberResult.data ?? []).forEach((row) => {
    if (row.id === ignoreMemberHorseId) return;
    if (Number.isInteger(row.back_number) && row.back_number > highest) highest = row.back_number;
  });

  return highest + 1;
}

async function assignHorseNumber(db, fields, existingRow = null) {
  const registryHorse = await findRegistryHorse(db, fields.horse_name);
  const registryRegistrations = formatRegistryRegistrations(registryHorse?.horse_registrations);
  let backNumber = registryHorse?.back_number ?? existingRow?.back_number ?? null;
  if (backNumber == null) {
    backNumber = await nextAvailableBackNumber(db, existingRow?.id);
  }

  return {
    fields: {
      ...fields,
      horse_name: registryHorse?.name ?? fields.horse_name,
      back_number: backNumber,
      registrations: fields.registrations || registryRegistrations,
    },
    suggestion: {
      matched_registry: !!registryHorse,
      back_number: backNumber,
      horse_name: registryHorse?.name ?? fields.horse_name,
      registrations: registryRegistrations,
    },
  };
}

export async function GET(req) {
  try {
    const db = adminClient();
    const account = await getMemberAccount(db);
    if (!account) return NextResponse.json(notSignedIn(), { status: 401 });

    const { searchParams } = new URL(req.url);
    const horseName = String(searchParams.get("name") ?? "").trim();
    if (!horseName) {
      return NextResponse.json({ ok: true, suggestion: null });
    }

    let existingRow = null;
    const horseId = searchParams.get("id");
    if (horseId) {
      const owned = await ownedChildRow(db, account, "club_member_horses", horseId);
      if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
      existingRow = owned.row;
    }

    const { suggestion } = await assignHorseNumber(db, { horse_name: horseName }, existingRow);
    return NextResponse.json({ ok: true, suggestion });
  } catch (err) {
    console.error("account/horses GET error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const db = adminClient();
    const account = await getMemberAccount(db);
    if (!account) return NextResponse.json(notSignedIn(), { status: 401 });

    const member = await assertOwnsMember(db, account, body?.member_id);
    if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (member.status === "rejected") {
      return NextResponse.json({ error: REJECTED_MSG }, { status: 409 });
    }

    const fields = cleanHorse(body);
    if (!fields.horse_name) {
      return NextResponse.json({ error: "Enter the horse's name." }, { status: 400 });
    }

    const { count } = await db
      .from("club_member_horses")
      .select("id", { count: "exact", head: true })
      .eq("member_id", member.id);
    if ((count ?? 0) >= MAX_HORSES) {
      return NextResponse.json(
        { error: `You can list up to ${MAX_HORSES} horses — contact the club if you need more.` },
        { status: 409 }
      );
    }

    const { fields: assignedFields } = await assignHorseNumber(db, fields);

    const { data: horse, error } = await db
      .from("club_member_horses")
      .insert({ member_id: member.id, ...assignedFields })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, horse });
  } catch (err) {
    console.error("account/horses POST error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const body = await req.json();
    const db = adminClient();
    const account = await getMemberAccount(db);
    if (!account) return NextResponse.json(notSignedIn(), { status: 401 });

    const owned = await ownedChildRow(db, account, "club_member_horses", body?.id);
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (owned.member.status === "rejected") {
      return NextResponse.json({ error: REJECTED_MSG }, { status: 409 });
    }

    const fields = cleanHorse(body);
    if (!fields.horse_name) {
      return NextResponse.json({ error: "Enter the horse's name." }, { status: 400 });
    }

    const { fields: assignedFields } = await assignHorseNumber(db, fields, owned.row);

    const { data: horse, error } = await db
      .from("club_member_horses")
      .update(assignedFields)
      .eq("id", owned.row.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, horse });
  } catch (err) {
    console.error("account/horses PATCH error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const body = await req.json();
    const db = adminClient();
    const account = await getMemberAccount(db);
    if (!account) return NextResponse.json(notSignedIn(), { status: 401 });

    const owned = await ownedChildRow(db, account, "club_member_horses", body?.id);
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (owned.member.status === "rejected") {
      return NextResponse.json({ error: REJECTED_MSG }, { status: 409 });
    }

    const { error } = await db.from("club_member_horses").delete().eq("id", owned.row.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("account/horses DELETE error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
