import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { getMemberAccount, assertOwnsMember, notSignedIn } from "../../_lib/memberAuth";

// A member updating their own contact details. Only these fields — never the
// name (it's what the committee approved), never the email (it IS the login),
// and never season/status/money fields.
const EDITABLE = [
  "phone", "address", "aqha_member_number", "other_memberships",
  "emergency_contact_name", "emergency_contact_phone", "interests",
];
// These were required on the application form, so they can change but not
// be blanked out.
const REQUIRED = ["phone", "address", "emergency_contact_name", "emergency_contact_phone"];

export async function PATCH(req) {
  try {
    const body = await req.json();
    const db = adminClient();
    const account = await getMemberAccount(db);
    if (!account) return NextResponse.json(notSignedIn(), { status: 401 });

    const member = await assertOwnsMember(db, account, body?.member_id);
    if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (member.status === "rejected") {
      return NextResponse.json(
        { error: "This application was not approved — contact the club to update it." },
        { status: 409 }
      );
    }

    const patch = {};
    for (const field of EDITABLE) {
      if (!(field in body)) continue;
      const value = String(body[field] ?? "").trim();
      if (!value && REQUIRED.includes(field)) {
        return NextResponse.json({ error: "That field can't be left empty." }, { status: 400 });
      }
      patch[field] = value || null;
    }
    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const { data: updated, error } = await db
      .from("club_members")
      .update(patch)
      .eq("id", member.id)
      .select(EDITABLE.join(", "))
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, details: updated });
  } catch (err) {
    console.error("account/details error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
