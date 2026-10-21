// Website fees ledger (schema-v60).
//
// Owner's decision, Oct 2026: the website fee used to be taken out of each
// Square payment as Square's "app fee" (which also made Square hide Apple
// Pay on every checkout) and could never apply to PayPal. Now NO payment
// carries a fee at the provider. Instead, every online payment that settles
// — Square or PayPal — adds one line here with the fee it earned, and the
// staff "Website fees" page (/coordinator/fees) turns a month's lines into
// a statement to bill the club.
//
// Rates come from the environment:
//   WEBSITE_FEE_BPS         percentage of every online payment, e.g. 50 = 0.5%
//   WEBSITE_FEE_FLAT_CENTS  flat amount once per person per event, e.g. 500 = $5
//                           (rides only the checkout that carried the event's
//                           one-off admin fee, and never exceeds that fee —
//                           exactly the rule the old Square app fee used)
// The old names SQUARE_APP_FEE_BPS / SQUARE_APP_FLAT_FEE_CENTS still work as
// fallbacks so nothing changes in Vercel until the owner renames them.
//
// Recording never throws and never blocks a payment from settling: a missing
// table (migration not run), a duplicate (provider retry) or any other error
// is logged and the settlement carries on.

function readRate(names) {
  for (const name of names) {
    const raw = process.env[name];
    if (raw == null || String(raw).trim() === "") continue;
    const value = parseInt(raw, 10);
    if (Number.isFinite(value) && value > 0) return { value, name };
    return { value: 0, name }; // explicitly set to 0 / blank-ish — treat as off
  }
  return { value: 0, name: null };
}

export function websiteFeeRates() {
  const bps = readRate(["WEBSITE_FEE_BPS", "SQUARE_APP_FEE_BPS"]);
  const flat = readRate(["WEBSITE_FEE_FLAT_CENTS", "SQUARE_APP_FLAT_FEE_CENTS"]);
  return {
    bps: bps.value,
    flatCents: flat.value,
    bpsVar: bps.name,
    flatVar: flat.name,
    configured: bps.value > 0 || flat.value > 0,
  };
}

// The fee for one payment. `flatEligibleCents` is the most the flat part may
// be on this payment (the event's admin fee when this checkout carried it,
// otherwise 0). A negative amount (refund / credit) yields a negative fee of
// the same size as the charge would have been.
export function calcWebsiteFee({ amountCents, flatEligibleCents = 0, flatFeeCents = null }, rates = websiteFeeRates()) {
  const amount = Math.round(Number(amountCents) || 0);
  const sign = amount < 0 ? -1 : 1;
  const percentFee = rates.bps > 0 ? sign * Math.round((Math.abs(amount) * rates.bps) / 10000) : 0;
  let flat = 0;
  if (flatFeeCents != null) {
    flat = Math.round(Number(flatFeeCents) || 0);
  } else if (rates.flatCents > 0 && flatEligibleCents > 0) {
    flat = Math.min(rates.flatCents, Math.round(flatEligibleCents));
  }
  return { percentBps: rates.bps, percentFeeCents: percentFee, flatFeeCents: flat, feeCents: percentFee + flat };
}

// Add one line to the ledger. Returns { ok, fee } | { skipped } | { error }.
export async function recordWebsiteFee(db, line) {
  try {
    const rates = websiteFeeRates();
    if (!rates.configured) return { skipped: "no_rates" };
    const fee = calcWebsiteFee(
      { amountCents: line.amountCents, flatEligibleCents: line.flatEligibleCents ?? 0, flatFeeCents: line.flatFeeCents ?? null },
      rates
    );
    const row = {
      paid_at: line.paidAt ?? new Date().toISOString(),
      provider: line.provider ?? "square",
      payment_id: line.paymentId ?? null,
      kind: line.kind ?? "other",
      description: String(line.description ?? "").slice(0, 300),
      payer_name: line.payerName ? String(line.payerName).slice(0, 200) : null,
      event_id: line.eventId ?? null,
      registration_id: line.registrationId ?? null,
      member_id: line.memberId ?? null,
      raffle_order_id: line.raffleOrderId ?? null,
      amount_cents: Math.round(Number(line.amountCents) || 0),
      percent_bps: fee.percentBps,
      percent_fee_cents: fee.percentFeeCents,
      flat_fee_cents: fee.flatFeeCents,
      fee_cents: fee.feeCents,
      note: line.note ? String(line.note).slice(0, 300) : null,
    };
    const { error } = await db.from("website_fees").insert(row);
    if (error) {
      const msg = error.message ?? "";
      if (error.code === "23505" || /duplicate key|unique constraint/i.test(msg)) return { skipped: "duplicate" };
      if (/website_fees|does not exist|schema cache/i.test(msg)) {
        console.error("Website fee not recorded — run schema-v60-website-fees.sql in Supabase:", msg);
        return { skipped: "no_table" };
      }
      console.error("Website fee not recorded:", msg);
      return { error: msg };
    }
    return { ok: true, fee };
  } catch (err) {
    console.error("Website fee not recorded:", err?.message ?? err);
    return { error: err?.message ?? "unknown" };
  }
}
