// Camping & yards (schema-v61) — server-side helpers.

// How many of each extra are already booked for an event, counting PAID
// registrations only (like clinic spots: an unpaid checkout holds nothing).
// Shape: { [extraId]: { nights: { "2026-11-14": 3 }, total: 5 } }. Never
// throws — on a database without the tables it simply reports nothing booked.
export async function bookedExtraCounts(db, eventId) {
  const out = {};
  try {
    const { data, error } = await db
      .from("registration_extras")
      .select("extra_id, quantity, nights, registrations!inner(event_id, status)")
      .eq("registrations.event_id", eventId)
      .eq("registrations.status", "paid");
    if (error) {
      if (!/does not exist|schema cache/i.test(error.message ?? "")) console.error("Extras count failed:", error.message);
      return out;
    }
    for (const row of data ?? []) {
      const slot = out[row.extra_id] ?? (out[row.extra_id] = { nights: {}, total: 0 });
      const q = Number(row.quantity) || 0;
      slot.total += q;
      for (const n of Array.isArray(row.nights) ? row.nights : []) {
        slot.nights[n] = (slot.nights[n] ?? 0) + q;
      }
    }
  } catch (err) {
    console.error("Extras count failed:", err?.message ?? err);
  }
  return out;
}
