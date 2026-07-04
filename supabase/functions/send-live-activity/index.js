// Supabase Edge Function — push live updates to iPhone Live Activities via APNs.
//
// The companion iPhone app shows a Live Activity (Lock Screen + Dynamic Island)
// for a live class. This function is called by the coordinator dashboard on
// score/draw/status changes; it signs an APNs provider token and pushes the new
// "content state" to every phone following that event.
//
// Requires these secrets (set once the Apple account + push key exist):
//   npx supabase secrets set \
//     APP_BUNDLE_ID=au.org.hcqha.livescoring \
//     APNS_TEAM_ID=XXXXXXXXXX \
//     APNS_KEY_ID=YYYYYYYYYY \
//     APNS_ENVIRONMENT=production \
//     APNS_KEY_P8="$(cat AuthKey_YYYYYYYYYY.p8)"
// TestFlight and App Store builds use APNS_ENVIRONMENT=production; apps run
// straight from Xcode onto a device use =sandbox.

import { createClient } from "npm:@supabase/supabase-js@2";

// ---- APNs provider JWT (ES256, signed with the .p8 key) ----
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

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
  };
  const jh = { ...cors, "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );

  // Staff only — same gate as send-push.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let staff = null;
  try {
    const { data } = await admin.auth.getUser(token);
    staff = data?.user ?? null;
  } catch (_) {
    staff = null;
  }
  if (!staff) {
    return new Response(JSON.stringify({ error: "Staff sign-in required" }), { status: 401, headers: jh });
  }

  const bundleId = Deno.env.get("APP_BUNDLE_ID");
  if (!bundleId || !Deno.env.get("APNS_KEY_P8")) {
    return new Response(
      JSON.stringify({ error: "Live Activities are not configured yet (APNs secrets missing)." }),
      { status: 503, headers: jh }
    );
  }

  // content_state must match the app's ActivityAttributes.ContentState shape.
  const { event_id, content_state, alert, event = "update", dismiss } = await req.json();
  if (!event_id || !content_state) {
    return new Response(JSON.stringify({ error: "event_id and content_state required" }), { status: 400, headers: jh });
  }

  const { data: rows } = await admin
    .from("live_activity_tokens")
    .select("id, push_token")
    .eq("event_id", event_id)
    .eq("activity_kind", "update");
  if (!rows?.length) return new Response(JSON.stringify({ sent: 0 }), { headers: jh });

  const jwt = await apnsJwt();
  const host =
    Deno.env.get("APNS_ENVIRONMENT") === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const payload = {
    aps: {
      timestamp: Math.floor(Date.now() / 1000),
      event, // "update" | "end"
      "content-state": content_state,
    },
  };
  if (alert) payload.aps.alert = alert; // optional: also raise a banner
  if (event === "end" && dismiss) payload.aps["dismissal-date"] = dismiss;
  const bodyStr = JSON.stringify(payload);

  const gone = [];
  await Promise.all(
    rows.map(async (r) => {
      try {
        const res = await fetch(`https://${host}/3/device/${r.push_token}`, {
          method: "POST",
          headers: {
            authorization: `bearer ${jwt}`,
            "apns-topic": `${bundleId}.push-type.liveactivity`,
            "apns-push-type": "liveactivity",
            "apns-priority": "10",
          },
          body: bodyStr,
        });
        // 410 = the activity ended / token no longer valid → prune it.
        if (res.status === 410) gone.push(r.id);
      } catch (_) {
        /* ignore individual send failures */
      }
    })
  );
  if (gone.length) await admin.from("live_activity_tokens").delete().in("id", gone);

  return new Response(
    JSON.stringify({ sent: rows.length - gone.length, removed: gone.length }),
    { headers: jh }
  );
});
