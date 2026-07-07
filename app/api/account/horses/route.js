import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { getMemberAccount, assertOwnsMember, ownedChildRow, notSignedIn } from "../../_lib/memberAuth";

// A member's horses (the same club_member_horses rows the committee sees on
// their application). Adding here doesn't touch the official registry —
// staff still add horses to the Registry page themselves.

const MAX_HORSES = 20;
const REJECTED_MSG = "This application was not approved — contact the club.";

function cleanHorse(body) {
  return {
    horse_name: String(body?.horse_name ?? "").trim(),
    back_number:
      body?.back_number == null || body.back_number === ""
        ? null
        : parseInt(body.back_number, 10) || null,
    breed: String(body?.breed ?? "").trim() || null,
    registrations: String(body?.registrations ?? "").trim() || null,
    notes: String(body?.notes ?? "").trim() || null,
  };
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

    const { data: horse, error } = await db
      .from("club_member_horses")
      .insert({ member_id: member.id, ...fields })
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

    const { data: horse, error } = await db
      .from("club_member_horses")
      .update(fields)
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
