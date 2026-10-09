import { createHash, createHmac, randomBytes } from "crypto";
import { createSquarePaymentLink, deleteSquarePaymentLink } from "./squarePayments";

// Raffles (schema-v56). Server-side pieces shared by the public order route,
// the Square webhook, and the staff draw route.

export const RESERVATION_MINUTES = 15;

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// Nudge every open raffle page: the public page can read `raffles` but not
// the ticket rows (they hold names/emails), so it listens for changes to its
// raffle row and re-fetches the taken numbers whenever this stamp moves.
// Column arrives with schema-v57 — on an older database this is a silent
// no-op (the page still polls).
export async function touchRaffle(db, raffleId) {
  if (!raffleId) return;
  try {
    await db.from("raffles").update({ tickets_changed_at: new Date().toISOString() }).eq("id", raffleId);
  } catch { /* pre-v57 database */ }
}

// Numbers that can't be chosen right now: sold, or reserved within the last
// RESERVATION_MINUTES by someone who hasn't finished paying yet. Expired
// reservations are released on the way through.
export async function takenNumbers(db, raffleId) {
  const cutoff = new Date(Date.now() - RESERVATION_MINUTES * 60000).toISOString();
  const { data: tickets, error } = await db
    .from("raffle_tickets")
    .select("id, number, status, buyer_name, reserved_at, order_id")
    .eq("raffle_id", raffleId);
  if (error) throw new Error(error.message);
  const expired = (tickets ?? []).filter((t) => t.status === "reserved" && t.reserved_at < cutoff);
  if (expired.length) {
    await db.from("raffle_tickets").delete().in("id", expired.map((t) => t.id));
    const orderIds = [...new Set(expired.map((t) => t.order_id).filter(Boolean))];
    if (orderIds.length) {
      await db.from("raffle_orders").update({ status: "expired" }).in("id", orderIds).eq("status", "pending");
    }
    await touchRaffle(db, raffleId);
  }
  return (tickets ?? []).filter((t) => !expired.some((e) => e.id === t.id));
}

// Mark an order paid and its tickets sold. Idempotent.
export async function settleRaffleOrder(db, orderId, { paymentId = null } = {}) {
  const { data: order } = await db.from("raffle_orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) return null;
  if (order.status !== "paid") {
    await db.from("raffle_orders")
      .update({ status: "paid", paid_at: new Date().toISOString(), ...(paymentId ? { square_payment_id: paymentId } : {}) })
      .eq("id", orderId);
  }
  await db.from("raffle_tickets").update({ status: "sold" }).eq("order_id", orderId);
  await touchRaffle(db, order.raffle_id);
  return order;
}

// Create (or fetch) the raffle's secret seed and publish its hash. The hash
// goes on the public page BEFORE any draw, so nobody can later claim the
// seed was chosen to suit a result.
export async function ensureRaffleSeed(db, raffle) {
  const { data: existing } = await db.from("raffle_secrets").select("seed").eq("raffle_id", raffle.id).maybeSingle();
  if (existing?.seed) {
    if (!raffle.seed_hash) await db.from("raffles").update({ seed_hash: sha256(existing.seed) }).eq("id", raffle.id);
    return existing.seed;
  }
  const seed = randomBytes(32).toString("hex");
  await db.from("raffle_secrets").insert({ raffle_id: raffle.id, seed });
  await db.from("raffles").update({ seed_hash: sha256(seed) }).eq("id", raffle.id);
  return seed;
}

// The draw. Verifiable by anyone afterwards:
//   1. seed_hash was published before the draw; the revealed seed must hash to it.
//   2. draw_salt is fresh randomness generated at the moment of the draw and
//      published too — so knowing the seed early can't tell anyone the result.
//   3. For prize k (0-based), with the SOLD ticket numbers sorted ascending:
//        r = HMAC-SHA256(seed, `${salt}:${k}`) as a big-endian integer
//        winner = sorted[r mod sorted.length], then removed for the next prize.
// Every step uses cryptographic randomness / hashing — no Math.random.
export function drawWinners({ seed, salt, soldNumbers, prizeCount }) {
  let pool = [...new Set(soldNumbers)].sort((a, b) => a - b);
  const results = [];
  for (let k = 0; k < prizeCount && pool.length; k += 1) {
    const digest = createHmac("sha256", seed).update(`${salt}:${k}`).digest();
    const r = BigInt("0x" + digest.toString("hex"));
    const idx = Number(r % BigInt(pool.length));
    results.push({ prize_index: k, number: pool[idx] });
    pool = pool.filter((n) => n !== pool[idx]);
  }
  return results;
}

export async function createRaffleCheckout(db, { raffle, order, baseUrl }) {
  const numbers = order.numbers;
  const payload = {
    idempotency_key: order.id,
    order: {
      location_id: process.env.SQUARE_LOCATION_ID,
      reference_id: order.id,
      line_items: [{
        name: `${raffle.name} — raffle ticket${numbers.length === 1 ? "" : "s"} ${numbers.join(", ")}`,
        quantity: String(numbers.length),
        base_price_money: { amount: raffle.ticket_price_cents, currency: "AUD" },
        note: order.buyer_name,
      }],
    },
    checkout_options: {
      redirect_url: `${baseUrl}/raffle/${raffle.id}/success?order=${order.id}`,
      ask_for_shipping_address: false,
    },
    ...(order.buyer_email ? { pre_populated_data: { buyer_email: order.buyer_email } } : {}),
  };
  return createSquarePaymentLink(db, payload);
}

export { deleteSquarePaymentLink };
