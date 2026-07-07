import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { getMemberAccount, assertOwnsMember, ownedChildRow, notSignedIn } from "../../_lib/memberAuth";

// The extra people covered by a membership (the applicant themselves is the
// member_name on the application and isn't a row here). Members manage their
// own, up to what their membership type covers.

const REJECTED_MSG = "This application was not approved — contact the club.";

// How many people this membership covers, including the applicant. Older
// applications (before v25) have no snapshot — fall back to the type's
// current setting so existing Family members aren't locked out.
async function includedPeople(db, member) {
  if (member.included_people != null) return member.included_people;
  if (!member.membership_type_id) return 1;
  const { data: type } = await db
    .from("membership_types")
    .select("included_people")
    .eq("id", member.membership_type_id)
    .maybeSingle();
  return type?.included_people ?? 1;
}

function cleanPersonType(value) {
  return value === "child" ? "child" : "adult";
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

    const name = String(body?.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Enter the person's name." }, { status: 400 });

    const { data: existing } = await db
      .from("club_member_people")
      .select("id, sort_order")
      .eq("member_id", member.id);
    const covered = await includedPeople(db, member);
    if ((existing?.length ?? 0) >= Math.max(0, covered - 1)) {
      return NextResponse.json(
        { error: `Your membership covers ${covered} ${covered === 1 ? "person" : "people"} including you — remove someone first or contact the club.` },
        { status: 409 }
      );
    }

    const { data: person, error } = await db
      .from("club_member_people")
      .insert({
        member_id: member.id,
        name,
        person_type: cleanPersonType(body?.person_type),
        sort_order: Math.max(0, ...(existing ?? []).map((p) => p.sort_order ?? 0)) + 1,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, person });
  } catch (err) {
    console.error("account/people POST error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const body = await req.json();
    const db = adminClient();
    const account = await getMemberAccount(db);
    if (!account) return NextResponse.json(notSignedIn(), { status: 401 });

    const owned = await ownedChildRow(db, account, "club_member_people", body?.id);
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (owned.member.status === "rejected") {
      return NextResponse.json({ error: REJECTED_MSG }, { status: 409 });
    }

    const patch = {};
    if ("name" in body) {
      const name = String(body.name ?? "").trim();
      if (!name) return NextResponse.json({ error: "Enter the person's name." }, { status: 400 });
      patch.name = name;
    }
    if ("person_type" in body) patch.person_type = cleanPersonType(body.person_type);
    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const { data: person, error } = await db
      .from("club_member_people")
      .update(patch)
      .eq("id", owned.row.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, person });
  } catch (err) {
    console.error("account/people PATCH error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const body = await req.json();
    const db = adminClient();
    const account = await getMemberAccount(db);
    if (!account) return NextResponse.json(notSignedIn(), { status: 401 });

    const owned = await ownedChildRow(db, account, "club_member_people", body?.id);
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (owned.member.status === "rejected") {
      return NextResponse.json({ error: REJECTED_MSG }, { status: 409 });
    }

    const { error } = await db.from("club_member_people").delete().eq("id", owned.row.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("account/people DELETE error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
