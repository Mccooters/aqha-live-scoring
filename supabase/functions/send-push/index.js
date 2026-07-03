// Supabase Edge Function — send web push notifications to all subscribers.
//
// Deploy with:   npx supabase functions deploy send-push
// Set secrets:   npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_EMAIL=admin@yourdomain.com
// Generate keys: npx web-push generate-vapid-keys

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

webpush.setVapidDetails(
  `mailto:${Deno.env.get("VAPID_EMAIL") ?? "admin@example.com"}`,
  Deno.env.get("VAPID_PUBLIC_KEY") ?? "",
  Deno.env.get("VAPID_PRIVATE_KEY") ?? ""
);

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
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const authCheck = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_ANON_KEY")
  );
  const { data: userData, error: userErr } = await authCheck.auth.getUser(token);
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Staff sign-in required" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const { title, body, tag } = await req.json();
  const clip = (value, max) => String(value ?? "").slice(0, max);
  const payload = JSON.stringify({
    title: clip(title, 120),
    body: clip(body, 300),
    tag: clip(tag, 40),
  });

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );

  const { data: subs } = await supabaseAdmin.from("push_subscriptions").select("*");
  if (!subs?.length) {
    return new Response(JSON.stringify({ sent: 0 }), { headers: jsonHeaders });
  }

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

  return new Response(
    JSON.stringify({ sent: subs.length - expired.length, expired: expired.length }),
    { headers: jsonHeaders }
  );
});
