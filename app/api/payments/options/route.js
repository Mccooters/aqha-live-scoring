import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { paypalConfigured, paypalEnvironment } from "../../_lib/paypal";

// Which ways to pay are switched on — the checkout forms ask this to decide
// whether to show the "Card (Square) / PayPal" choice. PayPal needs its env
// vars AND schema-v58 (the payment_provider columns); otherwise it's hidden.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  let paypal = paypalConfigured();
  let note = null;
  if (paypal) {
    const { error } = await adminClient().from("registrations").select("payment_provider").limit(1);
    if (error) { paypal = false; note = "schema-v58 not run"; }
  }
  return NextResponse.json(
    { square: true, paypal, paypal_environment: paypal ? paypalEnvironment() : null, note },
    { headers: { "Cache-Control": "no-store" } }
  );
}
