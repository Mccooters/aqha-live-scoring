import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { getMemberAccount, escapeIlike, notSignedIn } from "../../_lib/memberAuth";
import { RESERVATION_MINUTES } from "../../_lib/raffles";

// The signed-in member's raffle tickets: every paid (or still-being-paid)
// raffle order made with this account's email, grouped by raffle, with any
// prizes those numbers won once the draw has happened. Feeds the "My raffle
// tickets" card in the portal and lets the public raffle page mark "yours"
// on any device. Same email-as-identity rule as every other account route.
export async function GET() {
  try {
    const db = adminClient();
    const account = await getMemberAccount(db);
    if (!account) return NextResponse.json(notSignedIn(), { status: 401 });

    const { data, error } = await db
      .from("raffle_orders")
      .select("id, raffle_id, numbers, status, total_cents, paid_at, created_at, raffle:raffles(id, name, status, draw_date, draw_results, prizes)")
      .in("status", ["paid", "pending"])
      .ilike("buyer_email", escapeIlike(account.email))
      .order("created_at", { ascending: false });
    if (error) {
      // Pre-v56 database — there are no raffles yet.
      if (/raffle_orders|does not exist|schema cache/i.test(error.message ?? "")) {
        return NextResponse.json({ ok: true, raffles: [] });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const holdCutoff = Date.now() - RESERVATION_MINUTES * 60000;
    const byRaffle = new Map();
    for (const o of data ?? []) {
      const r = o.raffle;
      if (!r) continue;
      // An unpaid order whose 15-minute hold has lapsed is as good as gone.
      if (o.status === "pending" && new Date(o.created_at).getTime() < holdCutoff) continue;
      const g = byRaffle.get(r.id) ?? {
        id: r.id, name: r.name, status: r.status, draw_date: r.draw_date,
        draw_results: Array.isArray(r.draw_results) ? r.draw_results : [],
        numbers: [], pending_numbers: [], finish_payment_url: null, paid_cents: 0,
      };
      const nums = (o.numbers ?? []).map((n) => parseInt(n, 10)).filter(Number.isInteger);
      if (o.status === "paid") { g.numbers.push(...nums); g.paid_cents += o.total_cents ?? 0; }
      else { g.pending_numbers.push(...nums); g.finish_payment_url ??= `/raffle/${r.id}/success?order=${o.id}`; }
      byRaffle.set(r.id, g);
    }

    const raffles = [...byRaffle.values()].map(({ draw_results, ...g }) => {
      const numbers = [...new Set(g.numbers)].sort((a, b) => a - b);
      const pending = [...new Set(g.pending_numbers)].filter((n) => !numbers.includes(n)).sort((a, b) => a - b);
      const wins = draw_results
        .filter((w) => numbers.includes(w.number))
        .map((w) => ({ prize_index: w.prize_index, prize: w.prize, number: w.number }));
      return { ...g, numbers, pending_numbers: pending, wins };
    });

    return NextResponse.json({ ok: true, raffles });
  } catch (err) {
    console.error("account/raffles GET error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
