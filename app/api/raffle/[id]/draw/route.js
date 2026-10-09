import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { adminClient, isCommitteeViewer } from "../../../_lib/registrations";
import { ensureRaffleSeed, drawWinners, sha256 } from "../../../_lib/raffles";

// Staff: draw the winners. Uses the seed committed (hashed) before the draw
// plus fresh randomness at draw time; both are published afterwards so
// anyone can check the result. Draws once — a second call returns the
// stored result.
async function verifyStaff(req) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const authCheck = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await authCheck.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}

export async function POST(req, { params }) {
  try {
    const staff = await verifyStaff(req);
    if (!staff) return NextResponse.json({ error: "Staff sign-in required" }, { status: 401 });
    const db = adminClient();
    if (await isCommitteeViewer(db, staff.id)) {
      return NextResponse.json({ error: "This account has read-only committee access — changes are not permitted." }, { status: 403 });
    }
    const { action } = await req.json().catch(() => ({}));
    const { data: raffle } = await db.from("raffles").select("*").eq("id", params.id).maybeSingle();
    if (!raffle) return NextResponse.json({ error: "Raffle not found" }, { status: 404 });

    // "commit": publish the seed hash (done automatically when a raffle opens).
    if (action === "commit") {
      await ensureRaffleSeed(db, raffle);
      return NextResponse.json({ ok: true });
    }

    if (raffle.status === "drawn" && raffle.draw_results) {
      return NextResponse.json({ ok: true, already: true, results: raffle.draw_results });
    }
    const prizes = Array.isArray(raffle.prizes) ? raffle.prizes : [];
    if (!prizes.length) return NextResponse.json({ error: "Add at least one prize before drawing." }, { status: 400 });

    const { data: sold } = await db
      .from("raffle_tickets").select("number").eq("raffle_id", raffle.id).eq("status", "sold");
    if (!sold?.length) return NextResponse.json({ error: "No tickets have been sold yet." }, { status: 400 });

    const seed = await ensureRaffleSeed(db, raffle);
    const salt = randomBytes(16).toString("hex");
    const picks = drawWinners({ seed, salt, soldNumbers: sold.map((t) => t.number), prizeCount: prizes.length });
    // Prize + ticket number only: draw_results lives on the publicly readable
    // raffles row, and buyer names are staff-only (the staff page looks the
    // winner up from the ticket records).
    const results = picks.map((p) => ({
      prize_index: p.prize_index,
      prize: prizes[p.prize_index]?.title ?? `Prize ${p.prize_index + 1}`,
      number: p.number,
    }));
    const { error } = await db.from("raffles").update({
      status: "drawn",
      drawn_at: new Date().toISOString(),
      draw_salt: salt,
      seed_revealed: seed,
      seed_hash: raffle.seed_hash ?? sha256(seed),
      draw_results: results,
    }).eq("id", raffle.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    console.error("raffle/draw error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
