import { NextResponse } from "next/server";
import { adminClient } from "../_lib/registrations";

// Gate marshal actions (schema-v44). The marshal opens the gate link the
// coordinator shared; its per-event code unlocks ONLY these actions on that
// one event: mark the current TBC-draw horse as gone in, and scratch/restore
// an entry at the gate. It is not a staff login — no dashboard, no scores,
// no money, no member data. Writes go through the service role here because
// the marshal has no Supabase session (RLS allows staff only).
//
// The code lives in the locked-down gate_codes table (service role + staff
// only — never publicly readable) and is a long random token, so it can't be
// read out of the database by spectators or guessed by brute force.
export async function POST(req) {
  try {
    const { event_id, code, action, entry_id } = await req.json();
    if (!event_id || !code || !action) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    const db = adminClient();

    const { data: codeRow, error: cErr } = await db
      .from("gate_codes")
      .select("code")
      .eq("event_id", event_id)
      .maybeSingle();
    if (cErr) {
      const missing = /gate_codes|schema cache|does not exist/i.test(cErr.message ?? "");
      return NextResponse.json(
        { error: missing ? 'Gate access needs a database update — the coordinator must run "schema-v44-gate-access.sql".' : cErr.message },
        { status: 500 }
      );
    }
    if (!codeRow?.code || String(code) !== String(codeRow.code)) {
      return NextResponse.json({ error: "That gate code isn't valid for this event — ask the coordinator for the current link." }, { status: 403 });
    }

    // The gate page uses this to verify the code before showing controls.
    if (action === "check") return NextResponse.json({ ok: true });

    if (!entry_id) return NextResponse.json({ error: "entry_id required" }, { status: 400 });
    // The entry must belong to a class of THIS event — the code never
    // reaches into any other event's data — and completed classes are final:
    // the gate can't touch results that have already been decided.
    const { data: entry } = await db
      .from("entries")
      .select("id, called, scratched, classes!inner(event_id, scoring_mode, status)")
      .eq("id", entry_id)
      .maybeSingle();
    if (!entry || entry.classes?.event_id !== event_id) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
    if (entry.classes?.status === "completed") {
      return NextResponse.json({ error: "That class is already completed — results can only be changed by the coordinator." }, { status: 400 });
    }

    if (action === "called") {
      if ((entry.classes?.scoring_mode ?? "score") !== "tbc") {
        return NextResponse.json({ error: "Only TBC-draw classes advance from the gate." }, { status: 400 });
      }
      const { error } = await db.from("entries").update({ called: true }).eq("id", entry_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else if (action === "scratch" || action === "restore") {
      const { error } = await db.from("entries").update({ scratched: action === "scratch" }).eq("id", entry_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("gate action error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
