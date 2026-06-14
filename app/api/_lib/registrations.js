import { createClient } from "@supabase/supabase-js";

export function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export async function approveRegistration(db, registrationId) {
  const { data: regEntries } = await db
    .from("registration_entries")
    .select("*")
    .eq("registration_id", registrationId);

  if (!regEntries?.length) return;

  // Get the current max draw_order for each class so new entries slot in at the end
  const classIds = [...new Set(regEntries.map((e) => e.class_id))];
  const maxDraws = {};

  for (const classId of classIds) {
    const { data: existing } = await db
      .from("entries")
      .select("draw_order")
      .eq("class_id", classId)
      .order("draw_order", { ascending: false })
      .limit(1);
    maxDraws[classId] = existing?.[0]?.draw_order ?? 0;
  }

  const entryRows = regEntries.map((e) => {
    maxDraws[e.class_id] = (maxDraws[e.class_id] ?? 0) + 1;
    return {
      class_id: e.class_id,
      back_number: e.back_number,
      horse: e.horse_name,
      exhibitor: e.exhibitor,
      draw_order: maxDraws[e.class_id],
    };
  });

  await db.from("entries").insert(entryRows);
  await db.from("registrations").update({ status: "paid" }).eq("id", registrationId);
}
