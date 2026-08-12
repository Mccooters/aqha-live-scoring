// Supabase Edge Function — send web push notifications to all subscribers.
//
// Deploy with:   npx supabase functions deploy send-push
// Set secrets:   npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_EMAIL=admin@yourdomain.com
// Generate keys: npx web-push generate-vapid-keys

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// ---- APNs provider JWT (ES256, signed with the .p8 key) ----
// Same helpers as send-live-activity; lets announcements also reach the
// companion iPhone app as ordinary alert notifications. If the APNs secrets
// aren't set, the app delivery is skipped and web push still works.
function b64url(bytes) {
  let bin = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));

function pemToDer(pem) {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const der = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) der[i] = raw.charCodeAt(i);
  return der.buffer;
}

let cachedJwt = null;
let cachedAt = 0;
async function apnsJwt() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedAt < 1500) return cachedJwt; // APNs tokens last 1h; reuse ~25m
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(Deno.env.get("APNS_KEY_P8")),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const header = b64urlStr(JSON.stringify({ alg: "ES256", kid: Deno.env.get("APNS_KEY_ID") }));
  const claims = b64urlStr(JSON.stringify({ iss: Deno.env.get("APNS_TEAM_ID"), iat: now }));
  const signingInput = `${header}.${claims}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput)
  );
  cachedJwt = `${signingInput}.${b64url(sig)}`;
  cachedAt = now;
  return cachedJwt;
}

// Send the same announcement to every registered iPhone app as a normal
// alert notification. Fire-and-forget per device; prunes dead tokens.
async function sendToDevices(admin, { title, body, tag }) {
  const bundleId = Deno.env.get("APP_BUNDLE_ID");
  if (!bundleId || !Deno.env.get("APNS_KEY_P8")) return { sent: 0, removed: 0 };

  const { data: rows } = await admin.from("device_push_tokens").select("id, device_token");
  if (!rows?.length) return { sent: 0, removed: 0 };

  const jwt = await apnsJwt();
  const host =
    Deno.env.get("APNS_ENVIRONMENT") === "sandbox"
      ? "api.sandbox.push.apple.com"
      : "api.push.apple.com";
  const bodyStr = JSON.stringify({
    aps: { alert: { title, body }, sound: "default" },
  });

  const gone = [];
  await Promise.all(
    rows.map(async (r) => {
      try {
        const headers = {
          authorization: `bearer ${jwt}`,
          "apns-topic": bundleId,
          "apns-push-type": "alert",
          "apns-priority": "10",
        };
        if (tag) headers["apns-collapse-id"] = tag; // dedup, same as web tags
        const res = await fetch(`https://${host}/3/device/${r.device_token}`, {
          method: "POST",
          headers,
          body: bodyStr,
        });
        // 410 = token no longer valid (app removed) → prune it.
        if (res.status === 410) gone.push(r.id);
      } catch (_) {
        /* ignore individual send failures */
      }
    })
  );
  if (gone.length) await admin.from("device_push_tokens").delete().in("id", gone);

  return { sent: rows.length - gone.length, removed: gone.length };
}

// Configure the VAPID keys lazily inside the handler. Doing this at module
// load meant a missing/empty key crashed the whole worker before any request
// ran (an opaque 500). Returning null here lets us reply with a clear message
// instead. Set the three secrets to enable push:
//   npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_EMAIL=admin@yourdomain.com
//   (generate a keypair with: npx web-push generate-vapid-keys)
function configureVapid() {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) return false;
  try {
    webpush.setVapidDetails(
      `mailto:${Deno.env.get("VAPID_EMAIL") ?? "admin@example.com"}`,
      publicKey,
      privateKey
    );
    return true;
  } catch (_) {
    return false;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
  };
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only signed-in show staff may send notifications. The coordinator
  // dashboard sends the staff login token automatically; anything else
  // (including the public anon key on its own) is rejected.
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  // getUser validates the passed token itself (independent of the key the
  // client was built with), so we reuse the admin client rather than depend
  // on SUPABASE_ANON_KEY being present in the runtime. Wrapped so a bad or
  // missing token returns a clean 401 instead of crashing the worker.
  let staffUser = null;
  try {
    const { data } = await supabaseAdmin.auth.getUser(token);
    staffUser = data?.user ?? null;
  } catch (_) {
    staffUser = null;
  }
  if (!staffUser) {
    return new Response(JSON.stringify({ error: "Staff sign-in required" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  // Committee read-only accounts (schema-v48) can't send notifications.
  // A database without the table has no viewers.
  try {
    const { data: viewer } = await supabaseAdmin
      .from("staff_viewers")
      .select("user_id")
      .eq("user_id", staffUser.id)
      .maybeSingle();
    if (viewer) {
      return new Response(JSON.stringify({ error: "This account has read-only committee access — changes are not permitted." }), {
        status: 403,
        headers: jsonHeaders,
      });
    }
  } catch (_) { /* pre-v48 database — no viewers */ }

  const { title, body, tag } = await req.json();
  const clip = (value, max) => String(value ?? "").slice(0, max);
  const message = {
    title: clip(title, 120),
    body: clip(body, 300),
    tag: clip(tag, 40),
  };

  const vapidReady = configureVapid();
  const apnsReady = !!(Deno.env.get("APP_BUNDLE_ID") && Deno.env.get("APNS_KEY_P8"));
  if (!vapidReady && !apnsReady) {
    return new Response(
      JSON.stringify({ error: "Push notifications are not configured (VAPID keys missing)." }),
      { status: 503, headers: jsonHeaders }
    );
  }

  // Deliver to both audiences in parallel: browsers (web push) and the
  // companion iPhone app (APNs alert). Either leg may be unconfigured.
  const webSend = (async () => {
    if (!vapidReady) return { sent: 0, expired: 0 };
    const payload = JSON.stringify(message);
    const { data: subs } = await supabaseAdmin.from("push_subscriptions").select("*");
    if (!subs?.length) return { sent: 0, expired: 0 };

    const expired = [];
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
            payload
          );
        } catch (err) {
          if (err.statusCode === 410 || err.statusCode === 404) expired.push(sub.id);
        }
      })
    );

    if (expired.length > 0) {
      await supabaseAdmin.from("push_subscriptions").delete().in("id", expired);
    }
    return { sent: subs.length - expired.length, expired: expired.length };
  })();

  const [web, devices] = await Promise.all([webSend, sendToDevices(supabaseAdmin, message)]);

  return new Response(
    JSON.stringify({
      sent: web.sent + devices.sent,
      expired: web.expired + devices.removed,
      web,
      devices,
    }),
    { headers: jsonHeaders }
  );
});
