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
    // Multi-club registrations (schema-v42): a jsonb {club, number} list.
    let regsIncluded = false;
    if ("association_registrations" in body && Array.isArray(body.association_registrations)) {
      const rows = body.association_registrations
        .map((r) => ({ club: String(r?.club ?? "").trim(), number: String(r?.number ?? "").trim() }))
        .filter((r) => r.club || r.number);
      patch.association_registrations = rows.length ? rows : null;
      regsIncluded = true;
    }
    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    let { data: updated, error } = await db
      .from("club_members")
      .update(patch)
      .eq("id", member.id)
      .select(EDITABLE.join(", "))
      .single();
    if (error && regsIncluded && /association_registrations/i.test(`${error.message ?? ""} ${error.details ?? ""}`)) {
      const { association_registrations: _r, ...bare } = patch; // schema-v42 not run yet
      if (Object.keys(bare).length) {
        ({ data: updated, error } = await db.from("club_members").update(bare).eq("id", member.id).select(EDITABLE.join(", ")).single());
      } else { error = null; }
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, details: updated });
  } catch (err) {
    console.error("account/details error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
