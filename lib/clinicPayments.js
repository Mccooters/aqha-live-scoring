// Clinic deposits (schema-v47): a non-refundable deposit at registration,
// with the balance payable separately any time up to 2 weeks before the
// clinic. Shared between the entry form, the API routes and the staff pages.

export const BALANCE_DAYS_BEFORE = 14;

export function balanceDueDate(startsOn) {
  if (!startsOn) return null;
  const d = new Date(`${startsOn}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() - BALANCE_DAYS_BEFORE);
  return d;
}

export function balanceDueLabel(startsOn) {
  const d = balanceDueDate(startsOn);
  return d ? d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }) : "";
}

// The deposit option (and balance payment) is open while today is on or
// before the due date — after that it's full payment / contact the organiser.
export function depositWindowOpen(startsOn, now = new Date()) {
  const due = balanceDueDate(startsOn);
  if (!due) return false;
  due.setHours(23, 59, 59, 999);
  return now <= due;
}

// A spot type's full price: its own fee when set (schema-v47), else the
// event-wide entry fee — exactly what clinics charged before.
export function classFeeCents(cls, event) {
  return cls?.fee_cents ?? event?.entry_fee_cents ?? 0;
}

// Partial balance payments (schema-v50). The smallest part payment we'll
// take online — avoids a trickle of $1 Square transactions and their fees.
export const MIN_PART_PAYMENT_CENTS = 1000; // $10

// Total of the part payments recorded so far (Square + staff-recorded).
export function balancePaidCents(reg) {
  const list = Array.isArray(reg?.balance_payments) ? reg.balance_payments : [];
  return list.reduce((sum, p) => sum + (Number(p?.amount_cents) || 0), 0);
}

// What's still owing on a deposit-plan registration, after part payments.
export function balanceOwingCents(reg) {
  if (!(reg?.deposit_cents > 0)) return 0;
  if (reg.balance_paid_at) return 0;
  return Math.max(0, (reg.total_cents ?? 0) - reg.deposit_cents - balancePaidCents(reg));
}

export const formatCents = (cents) => `$${((cents ?? 0) / 100).toFixed(2).replace(/\.00$/, "")}`;
