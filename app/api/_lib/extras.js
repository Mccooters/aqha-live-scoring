// Camping & yards (schema-v61/v62) — server-side helpers.
//
// Items on different events can share one physical pool of yards or sites
// (schema-v62 `event_extras.pool`, the "shared name" staff give the matching
// item on each event). Everything here counts bookings per POOL when an item
// has one, and per item otherwise, so two events on the same weekend can't
// both sell the last yard for Saturday night.

const poolOf = (value) => {
  const s = String(value ?? "").trim();
  return s ? s : null;
};
const keyFor = (pool, id) => (poolOf(pool) ? `pool:${poolOf(pool)}` : `id:${id}`);

// This event's items as { id, pool } — tolerating a database without the
// v62 column (pool = null everywhere) or without the v61 tables (none).
export async function eventExtraItems(db, eventId) {
  let { data, error } = await db.from("event_extras").select("id, pool").eq("event_id", eventId);
  let hasPool = true;
  if (error && /pool/i.test(error.message ?? "")) {
    hasPool = false;
    ({ data, error } = await db.from("event_extras").select("id").eq("event_id", eventId));
  }
  if (error) {
    if (!/does not exist|schema cache/i.test(error.message ?? "")) console.error("Extras lookup failed:", error.message);
    return { items: [], hasPool: false };
  }
  return { items: (data ?? []).map((i) => ({ id: i.id, pool: hasPool ? poolOf(i.pool) : null })), hasPool };
}

// Paid booking rows for these items, plus every paid booking of items in the
// same pools (other events). Deduped by row id. Each row: { id, extra_id,
// quantity, nights, amount_cents, notes, pool, item_name, unit, event_id,
// registration: { id, status, event_id, contact_name?, contact_email? } }.
export async function poolBookingRows(db, ids, pools, { hasPool = true, withContact = false } = {}) {
  const extrasCols = hasPool ? "id, name, kind, unit, pool, event_id" : "id, name, kind, unit, event_id";
  const regCols = withContact ? "id, status, event_id, contact_name, contact_email" : "id, status, event_id";
  const sel = `id, extra_id, quantity, nights, amount_cents, notes, event_extras!inner(${extrasCols}), registrations!inner(${regCols})`;
  const byId = new Map();
  const add = (rows) => {
    for (const r of rows ?? []) {
      if (byId.has(r.id)) continue;
      byId.set(r.id, {
        id: r.id,
        extra_id: r.extra_id,
        quantity: Number(r.quantity) || 0,
        nights: Array.isArray(r.nights) ? r.nights : [],
        amount_cents: r.amount_cents ?? 0,
        notes: r.notes ?? null,
        pool: hasPool ? poolOf(r.event_extras?.pool) : null,
        item_name: r.event_extras?.name ?? "Extra",
        kind: r.event_extras?.kind ?? "other",
        unit: r.event_extras?.unit ?? "night",
        event_id: r.event_extras?.event_id ?? null,
        registration: r.registrations ?? null,
      });
    }
  };
  if (ids.length) {
    const { data, error } = await db.from("registration_extras").select(sel).in("extra_id", ids).eq("registrations.status", "paid");
    if (error) throw new Error(error.message);
    add(data);
  }
  if (hasPool && pools.length) {
    const { data, error } = await db.from("registration_extras").select(sel).in("event_extras.pool", pools).eq("registrations.status", "paid");
    if (error) throw new Error(error.message);
    add(data);
  }
  return [...byId.values()];
}

// How many of each of this event's items are already booked, counting PAID
// registrations only (like clinic spots) and, for an item with a shared
// name, every event in the pool. Shape: { [extraId]: { nights: { iso: n },
// total: n } }. Never throws — on a database without the tables it simply
// reports nothing booked.
export async function bookedExtraCounts(db, eventId) {
  const out = {};
  try {
    const { items, hasPool } = await eventExtraItems(db, eventId);
    if (!items.length) return out;
    const ids = items.map((i) => i.id);
    const pools = [...new Set(items.map((i) => i.pool).filter(Boolean))];
    const rows = await poolBookingRows(db, ids, pools, { hasPool });
    const counts = {};
    for (const row of rows) {
      const k = keyFor(row.pool, row.extra_id);
      const slot = counts[k] ?? (counts[k] = { nights: {}, total: 0 });
      slot.total += row.quantity;
      for (const n of row.nights) slot.nights[n] = (slot.nights[n] ?? 0) + row.quantity;
    }
    for (const item of items) out[item.id] = counts[keyFor(item.pool, item.id)] ?? { nights: {}, total: 0 };
  } catch (err) {
    if (!/does not exist|schema cache/i.test(err?.message ?? "")) console.error("Extras count failed:", err?.message ?? err);
  }
  return out;
}

// Which OTHER events share each of this event's pooled items:
// { [extraId]: ["Winter Show", ...] }. Empty on a pre-v62 database.
export async function poolSharing(db, eventId) {
  const out = {};
  try {
    const { items, hasPool } = await eventExtraItems(db, eventId);
    const pools = [...new Set(items.map((i) => i.pool).filter(Boolean))];
    if (!hasPool || !pools.length) return out;
    const { data, error } = await db
      .from("event_extras")
      .select("pool, event_id, events(name)")
      .in("pool", pools)
      .neq("event_id", eventId);
    if (error) return out;
    const namesByPool = {};
    for (const r of data ?? []) {
      const p = poolOf(r.pool);
      const name = r.events?.name;
      if (!p || !name) continue;
      (namesByPool[p] ?? (namesByPool[p] = new Set())).add(name);
    }
    for (const item of items) {
      if (item.pool && namesByPool[item.pool]) out[item.id] = [...namesByPool[item.pool]];
    }
  } catch (err) {
    console.error("Pool sharing lookup failed:", err?.message ?? err);
  }
  return out;
}

// What one email address has already booked (paid) among this event's items
// and their pools — so the entry form can say "you already have a yard on
// Friday" when someone enters the second event of a weekend.
export async function bookingsForEmail(db, eventId, email) {
  const wanted = String(email ?? "").trim().toLowerCase();
  if (!wanted.includes("@")) return [];
  try {
    const { items, hasPool } = await eventExtraItems(db, eventId);
    if (!items.length) return [];
    const ids = items.map((i) => i.id);
    const pools = [...new Set(items.map((i) => i.pool).filter(Boolean))];
    const rows = (await poolBookingRows(db, ids, pools, { hasPool, withContact: true }))
      .filter((r) => String(r.registration?.contact_email ?? "").trim().toLowerCase() === wanted);
    if (!rows.length) return [];
    const eventIds = [...new Set(rows.map((r) => r.event_id).filter(Boolean))];
    const { data: evs } = await db.from("events").select("id, name").in("id", eventIds);
    const nameById = Object.fromEntries((evs ?? []).map((e) => [e.id, e.name]));
    return rows.map((r) => ({
      extra_id: r.extra_id,
      pool: r.pool,
      event_id: r.event_id,
      event_name: nameById[r.event_id] ?? null,
      name: r.item_name,
      kind: r.kind,
      unit: r.unit,
      quantity: r.quantity,
      nights: r.nights,
    }));
  } catch (err) {
    console.error("Bookings-for-email lookup failed:", err?.message ?? err);
    return [];
  }
}
