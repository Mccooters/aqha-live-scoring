import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Staff-only config health check: reports WHICH server settings are present
// (booleans only — never the values). The database-migration checks happen
// client-side on the Health page under the staff session; this route covers
// the parts only the server can see (environment variables).
async function verifyStaff(req) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const authCheck = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const { data, error } = await authCheck.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function GET(req) {
  const staff = await verifyStaff(req);
  if (!staff) return NextResponse.json({ error: "Staff sign-in required" }, { status: 401 });

  const has = (name) => Boolean(process.env[name] && String(process.env[name]).trim());
  return NextResponse.json({
    ok: true,
    config: {
      square_access_token: has("SQUARE_ACCESS_TOKEN"),
      square_location: has("SQUARE_LOCATION_ID"),
      square_webhook_key: has("SQUARE_WEBHOOK_SIGNATURE_KEY"),
      square_oauth_app: has("SQUARE_APP_ID") && has("SQUARE_APP_SECRET"),
      square_environment: has("SQUARE_ENVIRONMENT"),
      resend: has("RESEND_API_KEY"),
      booking_email_from: has("BOOKING_EMAIL_FROM"),
      base_url: has("NEXT_PUBLIC_BASE_URL"),
      push_vapid: has("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
      service_role: has("SUPABASE_SERVICE_ROLE_KEY"),
    },
  });
}
