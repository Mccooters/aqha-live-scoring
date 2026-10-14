import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { capturePayPalOrder, paymentFromCapture } from "../../_lib/paypal";
import { settleCompletedPayment } from "../../_lib/settlement";

// Where PayPal sends the buyer after they approve (or cancel) a payment.
// PayPal appends ?token=<order id>&PayerID=… to the return URL we gave it;
// `next` is the page on OUR site to carry on to (the success page, which
// then polls the order's status as it does for Square). We capture the
// order here — that's the moment the money actually moves — and settle it
// through the same code the Square webhook uses. If anything here fails,
// PayPal's webhook (/api/webhooks/paypal) finishes the job later.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const safeNext = (n) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/");

export async function GET(req) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const next = safeNext(url.searchParams.get("next"));
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "") || url.origin;
  const go = (flag) => NextResponse.redirect(`${base}${next}${flag ? (next.includes("?") ? "&" : "?") + "paypal=" + flag : ""}`, 303);

  if (!token) return go("missing");
  try {
    const db = adminClient();
    const cap = await capturePayPalOrder(token);
    if (cap.error) {
      if (!cap.not_approved) console.error(`PayPal return: capture of ${token} failed:`, cap.error);
      return go(cap.not_approved ? "cancelled" : "error");
    }
    const res = await settleCompletedPayment(db, paymentFromCapture(cap.capture, token), token, { provider: "paypal" });
    if (res.status >= 500) console.error(`PayPal return: settlement of ${token} hit a transient error — the webhook will retry it`);
  } catch (err) {
    console.error("PayPal return error:", err);
  }
  return go("");
}
