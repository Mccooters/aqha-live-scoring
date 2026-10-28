import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminClient, isCommitteeViewer } from "../../_lib/registrations";

// Staff access management (the coordinator "Staff access" page): list staff
// logins, create one (full or read-only), flip access, remove one — all via
// the service-role auth admin API, so no one needs the Supabase dashboard.
//
// Any signed-in staff account may LIST (viewers included — it's the same
// read-only rule as everywhere else); every write requires a full-access
// staff login. Guard rails: you can't remove or downgrade YOUR OWN account,
// so there is always at least one full-access admin left (the one acting).

async function verifyStaff(req) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const authCheck = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const { data, error } = await authCheck.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function requireFullStaff(req) {
  const staff = await verifyStaff(req);
  if (!staff) {
    return { fail: NextResponse.json({ error: "Staff sign-in required" }, { status: 401 }) };
  }
  const db = adminClient();
  if (await isCommitteeViewer(db, staff.id)) {
    return { fail: NextResponse.json({ error: "This account has read-only committee access — changes are not permitted." }, { status: 403 }) };
  }
  return { staff, db };
}

const tableMissing = (err) => /does not exist|schema cache/i.test(err?.message ?? "");
const permissionDenied = (err) => /permission denied/i.test(err?.message ?? "");

const V48_MSG = 'Read-only accounts need a database update — run "schema-v48-committee-viewers.sql" in the Supabase SQL Editor first.';
const V66_MSG = 'The server isn\'t allowed to change the read-only list yet — run "schema-v66-staff-viewers-service-role-grants.sql" in the Supabase SQL Editor, then try again.';

function viewerWriteError(err) {
  if (tableMissing(err)) return V48_MSG;
  if (permissionDenied(err)) return V66_MSG;
  return err?.message ?? "Couldn't update the read-only list.";
}

async function viewerIds(db) {
  try {
    const { data, error } = await db.from("staff_viewers").select("user_id");
    if (error) return { ids: new Set(), missing: tableMissing(error) };
    return { ids: new Set((data ?? []).map((r) => r.user_id)), missing: false };
  } catch {
    return { ids: new Set(), missing: true };
  }
}

// Can the server actually WRITE the read-only list? v48 granted service_role
// SELECT only, so the page used to look ready while every read-only create /
// toggle silently failed. A delete of a row that can't exist is a harmless
// probe: it succeeds (0 rows) with the v66 grant and is refused without it.
async function viewersWritable(db) {
  try {
    const { error } = await db
      .from("staff_viewers")
      .delete()
      .eq("user_id", "00000000-0000-0000-0000-000000000000");
    return !error;
  } catch {
    return false;
  }
}

export async function GET(req) {
  try {
    const staff = await verifyStaff(req);
    if (!staff) return NextResponse.json({ error: "Staff sign-in required" }, { status: 401 });
    const db = adminClient();
    const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { ids: viewers, missing } = await viewerIds(db);
    const writable = missing ? false : await viewersWritable(db);
    const users = (data?.users ?? [])
      .map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        viewer: viewers.has(u.id),
        is_you: u.id === staff.id,
      }))
      .sort((a, b) => String(a.email ?? "").localeCompare(String(b.email ?? "")));
    return NextResponse.json({ users, viewers_ready: !missing, viewers_writable: writable });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { fail, db } = await requireFullStaff(req);
    if (fail) return fail;
    const { email, password, access } = await req.json();
    const cleanEmail = String(email ?? "").trim().toLowerCase();
    if (!cleanEmail.includes("@")) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (String(password ?? "").length < 8) {
      return NextResponse.json({ error: "The temporary password needs at least 8 characters." }, { status: 400 });
    }
    const { data, error } = await db.auth.admin.createUser({
      email: cleanEmail,
      password: String(password),
      email_confirm: true, // staff accounts are hand-made and trusted
    });
    if (error) {
      const msg = /already.*registered|already.*exists/i.test(error.message ?? "")
        ? "A login with that email already exists."
        : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (access === "viewer") {
      const { error: vErr } = await db
        .from("staff_viewers")
        .upsert({ user_id: data.user.id, email: cleanEmail }, { onConflict: "user_id" });
      if (vErr) {
        // Never leave a committee member holding full access by accident:
        // undo the login and say exactly what's needed.
        try { await db.auth.admin.deleteUser(data.user.id); } catch {}
        return NextResponse.json(
          { error: `Couldn't make that login read-only, so it wasn't created. ${viewerWriteError(vErr)}` },
          { status: 500 }
        );
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const { fail, staff, db } = await requireFullStaff(req);
    if (fail) return fail;
    const { user_id, access } = await req.json();
    if (!user_id || !["full", "viewer"].includes(access)) {
      return NextResponse.json({ error: "user_id and access (full|viewer) required" }, { status: 400 });
    }
    if (user_id === staff.id && access === "viewer") {
      return NextResponse.json({ error: "You can't make your own account read-only — ask another full-access admin to do it." }, { status: 400 });
    }
    if (access === "viewer") {
      const { data: target } = await db.auth.admin.getUserById(user_id);
      const { error } = await db
        .from("staff_viewers")
        .upsert({ user_id, email: target?.user?.email ?? null }, { onConflict: "user_id" });
      if (error) {
        return NextResponse.json({ error: viewerWriteError(error) }, { status: 500 });
      }
    } else {
      const { error } = await db.from("staff_viewers").delete().eq("user_id", user_id);
      if (error && !tableMissing(error)) {
        return NextResponse.json({ error: viewerWriteError(error) }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { fail, staff, db } = await requireFullStaff(req);
    if (fail) return fail;
    const { user_id } = await req.json();
    if (!user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });
    if (user_id === staff.id) {
      return NextResponse.json({ error: "You can't remove your own login — ask another full-access admin to do it." }, { status: 400 });
    }
    const { error } = await db.auth.admin.deleteUser(user_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    try {
      await db.from("staff_viewers").delete().eq("user_id", user_id);
    } catch {}
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
