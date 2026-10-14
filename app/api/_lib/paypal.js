import { randomUUID } from "crypto";

// PayPal (Orders v2) — the second way to pay, alongside Square (owner's
// decision, Oct 2026). Buyers pick "Card (Square)" or "PayPal" at checkout.
// Flow: create an order here → send the buyer to PayPal's approve link →
// they come back to /api/paypal/return → we CAPTURE the order server-side →
// the shared settlement (app/api/_lib/settlement.js) does exactly what the
// Square webhook does. /api/webhooks/paypal is the safety net for buyers who
// approve but never come back.
//
// Env vars: PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET (a REST app on
// developer.paypal.com), PAYPAL_ENVIRONMENT (live | sandbox; default
// sandbox), PAYPAL_WEBHOOK_ID (the webhook's id — required by the webhook
// route; without it the webhook refuses everything). PAYPAL_API_BASE
// overrides the API host (tests only).

export const paypalConfigured = () =>
  Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
export const paypalEnvironment = () => (process.env.PAYPAL_ENVIRONMENT === "live" ? "live" : "sandbox");
export const paypalBase = () =>
  process.env.PAYPAL_API_BASE ||
  (paypalEnvironment() === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");

export const centsToValue = (cents) => (Math.round(Number(cents) || 0) / 100).toFixed(2);
export const valueToCents = (value) => {
  const n = Math.round(parseFloat(value) * 100);
  return Number.isFinite(n) ? n : null;
};

const errorText = (data) =>
  data?.details?.[0]?.description ?? data?.message ?? data?.error_description ?? null;

// One access token per server process, refreshed a minute before it expires.
let cachedToken = { token: null, expiresAt: 0 };
async function accessToken() {
  if (cachedToken.token && Date.now() < cachedToken.expiresAt - 60000) return cachedToken.token;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(errorText(data) ?? "PayPal sign-in failed — check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET");
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedToken.token;
}

async function paypalFetch(path, { method = "GET", body, headers = {} } = {}) {
  const token = await accessToken();
  const res = await fetch(`${paypalBase()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

// The completed capture inside an order, in the shape the settlement wants.
function captureFromOrder(order) {
  const captures = order?.purchase_units?.[0]?.payments?.captures ?? [];
  const cap = captures.find((c) => c.status === "COMPLETED") ?? captures[0];
  if (!cap) return null;
  return {
    id: cap.id,
    status: cap.status,
    amount_cents: valueToCents(cap.amount?.value),
    currency: cap.amount?.currency_code ?? "AUD",
    order_id: order.id,
    custom_id: order.purchase_units?.[0]?.custom_id ?? cap.custom_id ?? null,
  };
}

// Create an order. Returns { order_id, url } (the PayPal page to send the
// buyer to) or { error, status }. PayPal appends ?token=<order id>&PayerID=
// to returnUrl when the buyer comes back.
export async function createPayPalOrder({ amountCents, description, referenceId, customId, returnUrl, cancelUrl, buyerEmail }) {
  if (!paypalConfigured()) return { error: "PayPal isn't set up yet — please pay by card instead.", status: 503 };
  if (!(amountCents > 0)) return { error: "There's nothing to pay.", status: 400 };
  try {
    const email = String(buyerEmail ?? "").trim();
    const { ok, data } = await paypalFetch("/v2/checkout/orders", {
      method: "POST",
      headers: { "PayPal-Request-Id": randomUUID() },
      body: {
        intent: "CAPTURE",
        purchase_units: [{
          ...(referenceId ? { reference_id: String(referenceId).slice(0, 256) } : {}),
          ...(customId ? { custom_id: String(customId).slice(0, 127) } : {}),
          ...(description ? { description: String(description).slice(0, 127) } : {}),
          amount: { currency_code: "AUD", value: centsToValue(amountCents) },
        }],
        payment_source: {
          paypal: {
            ...(email.includes("@") ? { email_address: email } : {}),
            experience_context: {
              brand_name: "HCQHA",
              shipping_preference: "NO_SHIPPING",
              user_action: "PAY_NOW",
              landing_page: "NO_PREFERENCE",
              return_url: returnUrl,
              cancel_url: cancelUrl,
            },
          },
        },
      },
    });
    if (!ok || !data.id) return { error: errorText(data) ?? "PayPal couldn't start the payment.", status: 502 };
    const links = data.links ?? [];
    const link = links.find((l) => l.rel === "payer-action") ?? links.find((l) => l.rel === "approve");
    if (!link?.href) return { error: "PayPal didn't return a checkout link.", status: 502 };
    return { order_id: data.id, url: link.href };
  } catch (err) {
    return { error: err.message ?? "PayPal is unavailable right now.", status: 502 };
  }
}

export async function getPayPalOrder(orderId) {
  try {
    const { ok, data } = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    if (!ok) return { error: errorText(data) ?? "PayPal order lookup failed", status: 502 };
    return { order: data, capture: captureFromOrder(data) };
  } catch (err) {
    return { error: err.message ?? "PayPal is unavailable right now.", status: 502 };
  }
}

// Take the money for an approved order. Safe to call twice: an order that's
// already been captured comes back with its existing capture.
export async function capturePayPalOrder(orderId) {
  if (!orderId) return { error: "No PayPal order id.", status: 400 };
  try {
    const { ok, data } = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      headers: { "PayPal-Request-Id": `capture-${orderId}` },
      body: {},
    });
    if (ok) {
      const capture = captureFromOrder(data);
      return capture ? { capture, order: data } : { error: "PayPal completed the order without a payment record.", status: 502 };
    }
    const issue = data?.details?.[0]?.issue ?? null;
    if (issue === "ORDER_ALREADY_CAPTURED") {
      const got = await getPayPalOrder(orderId);
      if (got.capture) return got;
    }
    if (issue === "ORDER_NOT_APPROVED" || issue === "PAYER_ACTION_REQUIRED" || issue === "ORDER_EXPIRED") {
      return { error: "The PayPal payment wasn't completed.", status: 409, not_approved: true, issue };
    }
    return { error: errorText(data) ?? "PayPal couldn't complete the payment.", status: 502, issue };
  } catch (err) {
    return { error: err.message ?? "PayPal is unavailable right now.", status: 502 };
  }
}

// Refund part or all of a capture. Returns { refund: { id, status } }.
export async function refundPayPalCapture({ captureId, amountCents, note }) {
  if (!paypalConfigured()) return { error: "PayPal isn't set up, so refunds can't be issued from here. Refund it in your PayPal account instead.", status: 503 };
  if (!captureId) return { error: "This registration has no PayPal payment on file — refund it in your PayPal account instead.", status: 400 };
  try {
    const { ok, data } = await paypalFetch(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
      method: "POST",
      headers: { "PayPal-Request-Id": randomUUID() },
      body: {
        ...(amountCents > 0 ? { amount: { currency_code: "AUD", value: centsToValue(amountCents) } } : {}),
        ...(note ? { note_to_payer: String(note).slice(0, 255) } : {}),
      },
    });
    if (!ok) return { error: errorText(data) ?? "PayPal refund failed", status: 502 };
    return { refund: { id: data.id, status: data.status } };
  } catch (err) {
    return { error: err.message ?? "PayPal is unavailable right now.", status: 502 };
  }
}

export async function getPayPalRefund(refundId) {
  if (!paypalConfigured()) return { error: "PayPal isn't set up.", status: 503 };
  if (!refundId) return { error: "No PayPal refund id.", status: 400 };
  try {
    const { ok, data } = await paypalFetch(`/v2/payments/refunds/${encodeURIComponent(refundId)}`);
    if (!ok) return { error: errorText(data) ?? "PayPal lookup failed", status: 502 };
    return { refund: { id: data.id, status: data.status } };
  } catch (err) {
    return { error: err.message ?? "PayPal is unavailable right now.", status: 502 };
  }
}

// Webhook signature check — asks PayPal to confirm the delivery is genuine.
// Fail closed: no PAYPAL_WEBHOOK_ID, no webhook.
export async function verifyPayPalWebhook(headers, rawBody) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return { ok: false, reason: "PAYPAL_WEBHOOK_ID is not set", status: 503 };
  let event;
  try { event = JSON.parse(rawBody); } catch { return { ok: false, reason: "Bad JSON", status: 400 }; }
  const h = (name) => headers.get(name) ?? "";
  if (!h("paypal-transmission-id") || !h("paypal-transmission-sig")) return { ok: false, reason: "Missing signature headers", status: 401 };
  try {
    const { ok, data } = await paypalFetch("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      body: {
        auth_algo: h("paypal-auth-algo"),
        cert_url: h("paypal-cert-url"),
        transmission_id: h("paypal-transmission-id"),
        transmission_sig: h("paypal-transmission-sig"),
        transmission_time: h("paypal-transmission-time"),
        webhook_id: webhookId,
        webhook_event: event,
      },
    });
    if (!ok || data.verification_status !== "SUCCESS") return { ok: false, reason: "Signature check failed", status: 401 };
    return { ok: true, event };
  } catch (err) {
    return { ok: false, reason: err.message ?? "Could not verify", status: 502 };
  }
}

// A PayPal capture in the shape the shared settlement expects (it was written
// for Square's payment object: id, order_id, status, amount_money).
export const paymentFromCapture = (capture, orderId) => ({
  id: capture.id,
  order_id: orderId ?? capture.order_id,
  status: capture.status === "COMPLETED" ? "COMPLETED" : capture.status,
  amount_money: { amount: capture.amount_cents, currency: capture.currency ?? "AUD" },
});

export function paypalStatus() {
  return { configured: paypalConfigured(), environment: paypalEnvironment(), webhook: Boolean(process.env.PAYPAL_WEBHOOK_ID) };
}

// Store a checkout's ids on a row together with which provider issued them.
// On a database without schema-v58 the provider column doesn't exist — the
// ids are saved anyway (the row is then treated as Square, the default).
export async function saveCheckout(db, table, id, patch, provider) {
  let { error } = await db.from(table).update({ ...patch, payment_provider: provider }).eq("id", id);
  if (error && /payment_provider/i.test(error.message ?? "")) {
    if (provider === "paypal") return { error: "PayPal isn't switched on yet — the database needs schema-v58. Please pay by card instead.", status: 503 };
    ({ error } = await db.from(table).update(patch).eq("id", id));
  }
  return { error: error ? (error.message ?? "Could not save the checkout") : null };
}
