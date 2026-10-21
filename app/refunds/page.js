import RefundPolicy from "./RefundPolicy";

// Public refund policy (owner's instruction, Oct 2026: "add to website as
// is"). The text lives in RefundPolicy.js; the club's refund email address
// comes from site_settings key "refund_email" so staff can set it without a
// code change (Memberships page → "Refund requests email").
export const metadata = {
  title: "Refund policy — HCQHA",
  description: "When Hunter Coast Quarter Horse Association gives refunds on show entries, clinic bookings, memberships and raffle tickets, and how to ask.",
};

export default function RefundsPage() {
  return <RefundPolicy />;
}
