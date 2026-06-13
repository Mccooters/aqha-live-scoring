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

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const { title, body, tag } = await req.json();

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );

  const { data: subs } = await supabaseAdmin.from("push_subscriptions").select("*");
  if (!subs?.length) {
    return new Response(JSON.stringify({ sent: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const expired = [];
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          JSON.stringify({ title, body, tag })
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
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
