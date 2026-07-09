// One place for talking to Square. Both checkout routes (event entries and
// membership joins) create their payment links through here.
//
// Two ways of being connected to Square, in order of preference:
//   1. OAuth (schema-v31): the club has authorised the developer's Square
//      application from the coordinator Registrations page. Payments run on
//      the OAuth token, and each checkout can carry an application fee
//      (SQUARE_APP_FEE_BPS, e.g. 50 = 0.5%) that Square automatically pays
//      to the account that owns the application.
//   2. The club's own access token in SQUARE_ACCESS_TOKEN — the original
//      setup, still the fallback whenever no OAuth connection exists. No
//      application fee is possible this way (Square requires OAuth for it).

export function squareBase() {
  return process.env.SQUARE_ENVIRONMENT === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

export const SQUARE_VERSION = "2024-01-18";

// OAuth scopes the club grants. PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS is the
// one that permits the application fee.
export const OAUTH_SCOPES = [
  "PAYMENTS_WRITE",
  "PAYMENTS_READ",
  "PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS",
  "ORDERS_READ",
  "ORDERS_WRITE",
  "MERCHANT_PROFILE_READ",
];

export function appFeeBps() {
  const bps = parseInt(process.env.SQUARE_APP_FEE_BPS ?? "", 10);
  return Number.isFinite(bps) && bps > 0 ? bps : 0;
}

// Exchange or refresh an OAuth token. Returns Square's JSON (throws on error).
async function obtainToken(body) {
  const res = await fetch(`${squareBase()}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Square-Version": SQUARE_VERSION },
    body: JSON.stringify({
      client_id: process.env.SQUARE_APP_ID,
      client_secret: process.env.SQUARE_APP_SECRET,
      ...body,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.errors?.[0]?.detail ?? data.message ?? "Square OAuth failed");
  }
  return data;
}

export async function exchangeOAuthCode(code) {
  return obtainToken({ grant_type: "authorization_code", code });
}

// The stored OAuth connection, with the access token refreshed when it's
// within a few days of expiring. Returns null when there's no connection
// (or the table doesn't exist yet — migration not run).
export async function getSquareConnection(db) {
  let row = null;
  try {
    const { data, error } = await db
      .from("square_connection")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    row = data;
  } catch {
    return null;
  }
  if (!row) return null;

  const expiresSoon =
    row.expires_at && new Date(row.expires_at).getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000;
  if (expiresSoon && row.refresh_token && process.env.SQUARE_APP_ID && process.env.SQUARE_APP_SECRET) {
    try {
      const fresh = await obtainToken({
        grant_type: "refresh_token",
        refresh_token: row.refresh_token,
      });
      const patch = {
        access_token: fresh.access_token,
        refresh_token: fresh.refresh_token ?? row.refresh_token,
        expires_at: fresh.expires_at ?? null,
        updated_at: new Date().toISOString(),
      };
      await db.from("square_connection").update(patch).eq("id", row.id);
      row = { ...row, ...patch };
    } catch (err) {
      // Keep using the stored token while it's still valid; if it has fully
      // expired the payment call below will fail with Square's own message.
      console.error("Square token refresh failed:", err.message);
    }
  }
  return row;
}

// Ground truth for the coordinator's Square card: which credentials are
// live, and — straight from Square — which locations they can actually see.
// This is what turns "Invalid location id" from a mystery into a reading.
// Pass the already-loaded connection so caller and diagnostics can never
// disagree about whether one exists.
export async function squareDiagnostics(db, connectionArg) {
  const connection = connectionArg !== undefined ? connectionArg : await getSquareConnection(db);
  const token = connection?.access_token ?? process.env.SQUARE_ACCESS_TOKEN;
  const configuredLocation = process.env.SQUARE_LOCATION_ID ?? null;
  const result = {
    source: connection ? "oauth" : process.env.SQUARE_ACCESS_TOKEN ? "fallback_token" : "none",
    environment: process.env.SQUARE_ENVIRONMENT === "sandbox" ? "sandbox" : "production",
    configured_location: configuredLocation,
    locations: [],
    location_ok: null,
    square_error: null,
  };
  if (!token) return result;

  try {
    const res = await fetch(`${squareBase()}/v2/locations`, {
      headers: { Authorization: `Bearer ${token}`, "Square-Version": SQUARE_VERSION },
    });
    const data = await res.json();
    if (!res.ok) {
      result.square_error = data.errors?.[0]?.detail ?? data.errors?.[0]?.code ?? "Square rejected the credentials";
      return result;
    }
    result.locations = (data.locations ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      merchant_id: l.merchant_id,
      status: l.status,
    }));
    result.location_ok = configuredLocation
      ? result.locations.some((l) => l.id === configuredLocation)
      : null;
  } catch (err) {
    result.square_error = err.message;
  }
  return result;
}

// The credentials every Square call should use right now: the OAuth
// connection when the club has linked Square, else the club's own token.
export async function resolveSquareToken(db) {
  const connection = await getSquareConnection(db);
  return {
    connection,
    token: connection?.access_token ?? process.env.SQUARE_ACCESS_TOKEN ?? null,
  };
}

// Delete a payment link so an abandoned/cancelled checkout can no longer be
// paid. A 404 counts as success — the link is equally dead either way.
export async function deleteSquarePaymentLink(db, linkId) {
  if (!linkId) return false;
  const { token } = await resolveSquareToken(db);
  if (!token) return false;
  const res = await fetch(
    `${squareBase()}/v2/online-checkout/payment-links/${encodeURIComponent(linkId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Square-Version": SQUARE_VERSION },
    }
  );
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errors?.[0]?.detail ?? `Square link delete failed (${res.status})`);
  }
  return true;
}

// Create a Square Payment Link for an order. Applies the developer fee when
// the OAuth connection is in use. `payload` is the normal CreatePaymentLink
// body minus authentication. Returns { link } or { error, status }.
export async function createSquarePaymentLink(db, payload) {
  const { connection, token } = await resolveSquareToken(db);
  if (!token || !process.env.SQUARE_LOCATION_ID) {
    return {
      error: "Payment is not configured yet. Please contact the club.",
      status: 503,
    };
  }

  const body = { ...payload };
  // The developer fee rides on OAuth payments only (Square's rule), as a
  // fixed amount computed from the order total, rounded to the cent.
  const bps = appFeeBps();
  if (connection && bps > 0) {
    const orderTotal = (payload.order?.line_items ?? []).reduce(
      (sum, item) => sum + (item.base_price_money?.amount ?? 0) * parseInt(item.quantity ?? "1", 10),
      0
    );
    const fee = Math.round((orderTotal * bps) / 10000);
    if (fee > 0) {
      body.checkout_options = {
        ...(payload.checkout_options ?? {}),
        app_fee_money: { amount: fee, currency: "AUD" },
      };
    }
  }

  const res = await fetch(`${squareBase()}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    return {
      error: data.errors?.[0]?.detail ?? "Square payment setup failed",
      status: 500,
    };
  }
  return { link: data.payment_link };
}
