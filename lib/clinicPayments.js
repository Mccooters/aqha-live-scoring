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

// The deposit OPTION on the entry form is offered while today is on or
// before the due date — inside the last 2 weeks it's full payment up front.
// (This no longer gates paying a balance — see balancePaymentsOpen.)
export function depositWindowOpen(startsOn, now = new Date()) {
  const due = balanceDueDate(startsOn);
  if (!due) return false;
  due.setHours(23, 59, 59, 999);
  return now <= due;
}

// Paying an existing balance stays open for as long as money is owing —
// past the due date it's simply OVERDUE (owner's rule, Oct 2026: the pay
// link used to stop working at the due date, which left staff with no way
// to collect what was still owed). Only a cancelled event shuts it.
export function balancePaymentsOpen(event) {
  return event?.status !== "cancelled";
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

// Withdrawn (schema-v65): the person pulled out after paying the deposit.
// The non-refundable deposit is kept and the balance is written off — so
// nothing is owing, no reminders go out and the pay link is refused.
export function isWithdrawn(reg) {
  return Boolean(reg?.withdrawn_at);
}

// What's still owing on a deposit-plan registration, after part payments.
// Zero once the balance is paid — or once the person has withdrawn.
export function balanceOwingCents(reg) {
  if (!(reg?.deposit_cents > 0)) return 0;
  if (reg.balance_paid_at || reg.withdrawn_at) return 0;
  return Math.max(0, (reg.total_cents ?? 0) - reg.deposit_cents - balancePaidCents(reg));
}

export const formatCents = (cents) => `$${((cents ?? 0) / 100).toFixed(2).replace(/\.00$/, "")}`;
